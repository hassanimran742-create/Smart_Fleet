/**
 * REV23 robustness-jobs-09: the customer's link page used to answer raw JSON ({"statusCode":400,
 * "code":"VALIDATION_FAILED",…}) when the body parser or the URI decoder refused a request, because those
 * run before the page's own filter (PublicPageExceptionFilter). CUSTOMER_PAGE §5: every error becomes an
 * HTML page with the page's headers, never JSON, and never echoes the URL. The page's bodies also get
 * their own small limit (its form posts a few hundred bytes).
 */
import type { INestApplication } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { createConfirmation } from '../../helpers/customer-links';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createOrder } from '../../helpers/runs';
import { createStandardData } from '../../helpers/standard-data';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';

jest.setTimeout(120_000);

describeDb('REV23 robustness-jobs-09 the link page answers parser and decoder errors as a page', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('REV23 robustness-jobs-09 broken bodies and an unreadable path get the page with its headers, never JSON', async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    const std = await createStandardData();
    await app.get(SettingsService).set('confirmation.enabled', true, systemActor('cli:settings'), 'Review 23 page errors');
    const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED });
    const link = await createConfirmation({ order });
    let ip = 10;
    const post = (type: string, body: string) =>
      http(app).post(link.path).set('Content-Type', type).set('X-Forwarded-For', `198.51.100.${ip++}`).send(body);
    const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

    const cases: Record<string, () => PromiseLike<{ status: number; headers: Record<string, string>; text: string }>> = {
      'broken JSON': () => post('application/json', '{"answer":'),
      'an unknown charset': () => post('application/x-www-form-urlencoded; charset=foo', form({ answer: 'NO' })),
      'a 200 KB urlencoded comment': () => post('application/x-www-form-urlencoded', form({ answer: 'OTHER', comment: 'x'.repeat(200_000) })),
      'a 20 KB JSON comment': () => post('application/json', JSON.stringify({ answer: 'OTHER', comment: 'x'.repeat(20_000) })),
      '10,000 fields': () => post('application/x-www-form-urlencoded', `${Array.from({ length: 10_000 }, (_, i) => `p${i}=1`).join('&')}&answer=NO`),
      'a path the decoder cannot read': () => http(app).get('/c/%E0%A4%A'),
      'the bare /c path': () => http(app).get('/c'),
      'an upper-case /C/ path the decoder cannot read': () => http(app).get('/C/%E0%A4%A'),
    };
    for (const [name, send] of Object.entries(cases)) {
      const res = await send();
      expect({
        name,
        clientError: res.status >= 400 && res.status < 500,
        html: /^text\/html/.test(res.headers['content-type'] ?? ''),
        json: res.text.trim().startsWith('{'),
        cacheControl: res.headers['cache-control'],
        robots: res.headers['x-robots-tag'],
        csp: /frame-ancestors 'none'/.test(res.headers['content-security-policy'] ?? ''),
        echoesUrl: res.text.includes(link.token) || res.text.includes('%E0%A4%A'),
      }).toEqual({ name, clientError: true, html: true, json: false, cacheControl: 'no-store', robots: 'noindex, nofollow, noarchive', csp: true, echoesUrl: false });
    }

    // The page's own form still works, and nothing above recorded an answer.
    expect((await getConfirmationStatus(order.id)).status).toBe('PENDING');
    const answered = await post('application/x-www-form-urlencoded', form({ v: '1', answer: 'YES' }));
    expect(answered.status).toBe(303);
    // An unknown API path keeps its JSON answer (only the page's paths are pages).
    const api = await http(app).get('/api/v1/no-such-route');
    expect(api.status).toBe(404);
    expect(api.body.code).toBe('NOT_FOUND');
    // The page's own parsers leave the API's alone: a JSON body elsewhere is still read (a wrong password,
    // not "Fill this in").
    const login = await http(app).post('/api/v1/auth/login').set('X-Forwarded-For', '198.51.100.250').send({ phone: '+923211234567', password: 'not-the-password' });
    expect({ status: login.status, code: login.body.code }).toEqual({ status: 401, code: 'AUTH_INVALID_CREDENTIALS' });
  });
});

async function getConfirmationStatus(orderId: string) {
  const { getTestPrisma } = await import('../../helpers/db');
  return getTestPrisma().deliveryConfirmation.findUniqueOrThrow({ where: { orderId }, select: { status: true } });
}
