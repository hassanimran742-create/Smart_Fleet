/**
 * CNF-026: the link page's rate limits (CUSTOMER_PAGE §5, API_CONTRACT §3.6) on fixed windows in Redis:
 * 60 GETs a minute per IP; 20 POSTs a minute per IP and 6 per 10 minutes per link; 30 unknown tokens per
 * 10 minutes per IP, after which that IP is refused on every /c/ request without a lookup. They fail open
 * when Redis is down. Every 429 is the HTML page with the page headers.
 */
import type { INestApplication } from '@nestjs/common';
import { RateLimitService, type RateLimitStore } from '../../../src/common/rate-limit/rate-limit.service';
import { ConfirmationServiceImpl } from '../../../src/modules/confirmation/confirmation.interface';
import { windowSecondsLeft } from '../../../src/modules/confirmation/public/page-limits';
import { createConfirmation } from '../../helpers/customer-links';
import { describeDb } from '../../helpers/describe-db';
import { createOrder } from '../../helpers/runs';
import type { StandardData } from '../../helpers/standard-data';
import { BOOT_TIMEOUT_MS, confirmationOf, createConfirmApp, deliverX1, freshStandard, pageCalls, textOf, waitForSends } from './support';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** Waits for a fresh fixed window when fewer than `needSeconds` are left in the current one. */
async function roomInWindow(windowSeconds: number, needSeconds: number): Promise<void> {
  const left = windowSecondsLeft(windowSeconds);
  if (left < needSeconds) await new Promise((resolve) => setTimeout(resolve, left * 1000 + 250));
}

function expectTooManyPage(res: { status: number; text: string; headers: Record<string, string> }): void {
  expect(res.status).toBe(429);
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['retry-after']).toMatch(/^\d+$/);
  expect(textOf(res.text)).toContain('Too many tries');
  expect(res.text.trim().startsWith('{')).toBe(false);
}

describeDb('CNF-026 the link page rate limits', () => {
  let app: INestApplication;
  let std: StandardData;
  const page = () => pageCalls(app);

  beforeAll(async () => {
    app = await createConfirmApp();
    std = await freshStandard(app);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  it('CNF-026 rate limits on the link page, and they let requests through if Redis is down', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const d2 = await deliverX1(app, std);
    const token = d1.token as string;

    // Step 1: 60 GETs a minute from one IP; the 61st is refused, another IP is not.
    await roomInWindow(60, 20);
    const ip1 = '203.0.113.10';
    for (let i = 1; i <= 60; i++) expect((await page().get(token, '', { ip: ip1 })).status).toBe(200);
    const sixtyFirst = await page().get(token, '', { ip: ip1 });
    expectTooManyPage(sixtyFirst);
    expect(textOf(sixtyFirst.text)).toContain('Please wait 1 minute, then try again.');
    await page().get(token, '', { ip: '203.0.113.11' }).expect(200);

    // Step 2: 6 posts per link per 10 minutes, refused ones counted; the 7th is refused.
    await roomInWindow(600, 60);
    for (let i = 1; i <= 6; i++) await page().answer(d2.token as string, 'OTHER', 'x', { ip: `198.51.100.${i}` }).expect(400);
    expectTooManyPage(await page().answer(d2.token as string, 'YES', undefined, { ip: '198.51.100.7' }));
    expect((await confirmationOf(d2.order.id))?.status).toBe('PENDING');

    // Step 3: 20 posts a minute from one IP; the 21st records nothing.
    const fresh: string[] = [];
    const orders = [];
    for (let i = 0; i < 21; i++) {
      const order = await createOrder({ distributor: std.DA, client: std.C1, status: 'DELIVERED', lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }] });
      orders.push(order);
      fresh.push((await createConfirmation({ order })).token);
    }
    await roomInWindow(60, 20);
    const ip3 = '203.0.113.30';
    for (let i = 0; i < 20; i++) await page().answer(fresh[i], 'YES', undefined, { ip: ip3 }).expect(303);
    expectTooManyPage(await page().answer(fresh[20], 'YES', undefined, { ip: ip3 }));
    expect((await confirmationOf(orders[20].id))?.status).toBe('PENDING');

    // Steps 4-5: 30 unknown tokens per 10 minutes; then this IP is refused everywhere, without a lookup.
    await roomInWindow(600, 60);
    const ip4 = '203.0.113.40';
    const unknown = (n: number) => `${'abcdefghjkmnpqrstvwx'}${String(n).padStart(6, '0')}`;
    for (let i = 1; i <= 30; i++) expect((await page().get(unknown(i), '', { ip: ip4 })).status).toBe(404);
    expectTooManyPage(await page().get(unknown(31), '', { ip: ip4 }));
    const lookups = jest.spyOn(app.get(ConfirmationServiceImpl), 'findLink');
    expectTooManyPage(await page().get(token, '', { ip: ip4 }));
    expect(lookups).not.toHaveBeenCalled();
    lookups.mockRestore();
    await page().get(token, '', { ip: '203.0.113.41' }).expect(200);

    // Step 6: bad formats are 404 with no lookup, and they are not misses.
    const ip6 = '203.0.113.60';
    for (let i = 1; i <= 31; i++) await page().get('a'.repeat(25), '', { ip: ip6 }).expect(404);
    await page().get(token, '', { ip: ip6 }).expect(200);

    // Step 7: Redis down: every request goes through (the limiter fails open).
    const limiter = app.get(RateLimitService);
    const original = limiter['store'];
    const down: RateLimitStore = { eval: async () => Promise.reject(new Error('Redis is down')) };
    limiter.useStore(down);
    try {
      for (let i = 0; i < 61; i++) expect((await page().get(token, '', { ip: ip1 })).status).toBe(200);
    } finally {
      limiter.useStore(original as RateLimitStore);
    }
  }, 240_000);
});
