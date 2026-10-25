/**
 * Review 23 (security, messaging): `POST /orders/:id/confirmation/share` stops at 20 shares per order an
 * hour (API_CONTRACT §9.7), but `POST /orders/:id/confirmation/new-link { send: 'SMS' }` (the one route
 * that makes the platform itself text a number) has no limit, and the number is whatever the shop last
 * typed for the customer (`PATCH /clients/:id`, no limit either). With a real SMS company and test mode
 * off (the provider spy below stands in for one), a shop can make the platform send any number of texts,
 * to numbers it chooses, on the platform's SMS account.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { authHeader } from '../../helpers/auth';
import { createConfirmation, customerLinks } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createOrder } from '../../helpers/runs';
import type { StandardData } from '../../helpers/standard-data';
import {
  BOOT_TIMEOUT_MS,
  createConfirmApp,
  deliverX1,
  freshStandard,
  setSetting,
  SpyProvider,
  waitForSends,
  withSpyProvider,
} from '../../inc2/confirm/support';

jest.setTimeout(180_000);

describeDb('review23 security: new-link SMS has no limit', () => {
  let app: INestApplication;
  let std: StandardData;
  const spy = new SpyProvider('sms-company');

  beforeAll(async () => {
    app = await createConfirmApp(withSpyProvider(spy));
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  it('REV23-SEC-SMS-FLOOD 30 new links with send SMS in a row are all sent, to numbers the shop picks', async () => {
    std = await freshStandard(app);
    // After the pilot: a real SMS company, test mode off.
    await setSetting(app, 'messaging.testMode', false);
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    await waitForSends();
    spy.reset();
    spy.next = { kind: 'SENT', providerMessageId: 'sms-company-1' };

    const statuses: number[] = [];
    const numbers = new Set<string>();
    for (let i = 0; i < 30; i++) {
      // "Fix" the customer's number to any number at all, then text it a new link.
      const phone = `0300 ${String(5550000 + i).padStart(7, '0')}`;
      const fix = await http(app).patch(`/api/v1/clients/${std.C1.id}`).set(authHeader(std.DA.actor)).send({ phone });
      expect(fix.status).toBe(200);
      const res = await customerLinks(app).newLink(std.DA, d1.order.id, { send: 'SMS' });
      statuses.push(res.status);
    }
    await waitForSends();
    for (const call of spy.calls) numbers.add(call.toE164);
    // eslint-disable-next-line no-console
    console.log(`[review23] new-link answers ${JSON.stringify([...new Set(statuses)])}; the SMS company was called ${spy.calls.length} times, for ${numbers.size} different numbers`);

    // The share route stops at 20 an hour; the route that really sends texts should stop at least as soon.
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(spy.calls.length).toBeLessThanOrEqual(20);
  });

  it('REV23 security-05 at most 3 new-link texts per order an hour; a repeat, and a new link without a text, are never limited', async () => {
    std = await freshStandard(app);
    await setSetting(app, 'messaging.testMode', false);
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    await waitForSends();
    // The delivery's own first SMS doesn't count: the shop still has its 3.
    spy.reset();
    spy.next = { kind: 'SENT', providerMessageId: 'sms-company-2' };
    const links = customerLinks(app);
    const keys = Array.from({ length: 5 }, () => randomUUID());
    for (const key of keys.slice(0, 3)) await links.newLink(std.DA, d1.order.id, { send: 'SMS' }, key).expect(200);
    // The last one again (the phone retrying): its answer, not a refusal.
    const repeat = await links.newLink(std.DA, d1.order.id, { send: 'SMS' }, keys[2]);
    expect({ status: repeat.status, replay: repeat.headers['idempotent-replay'] }).toEqual({ status: 200, replay: 'true' });

    const fourth = await links.newLink(std.DA, d1.order.id, { send: 'SMS' }, keys[3]);
    expect({ status: fourth.status, code: fourth.body.code }).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(fourth.body.details.minutes).toBeGreaterThanOrEqual(1);
    expect(fourth.body.details.minutes).toBeLessThanOrEqual(60);
    expect(Number(fourth.headers['retry-after'])).toBe(fourth.body.details.minutes * 60);
    // Nothing changed with the refusal: the link is still the third one's.
    const version = (await getTestPrisma().deliveryConfirmation.findUniqueOrThrow({ where: { orderId: d1.order.id } })).tokenVersion;
    expect(version).toBe(4);

    // A new link to share by hand (no text) still works.
    await links.newLink(std.DA, d1.order.id, {}, keys[4]).expect(200);
    await waitForSends();
    expect(spy.calls.length).toBe(3);
  });

  it('REV23 security-05 at most 20 new-link texts per shop an hour, across its orders', async () => {
    std = await freshStandard(app);
    await setSetting(app, 'messaging.testMode', false);
    spy.reset();
    spy.next = { kind: 'SENT', providerMessageId: 'sms-company-3' };
    const links = customerLinks(app);
    const orders = [];
    for (let i = 0; i < 7; i++) {
      const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED });
      await createConfirmation({ order });
      orders.push(order);
    }
    const statuses: number[] = [];
    for (const order of orders) {
      for (let k = 0; k < 3; k++) statuses.push((await links.newLink(std.DA, order.id, { send: 'SMS' })).status);
    }
    // 20 texts went out; the 21st (the last order's third) was refused for the shop.
    expect(statuses.filter((status) => status === 200)).toHaveLength(20);
    expect(statuses[20]).toBe(429);
    await waitForSends();
    expect(spy.calls.length).toBe(20);
    // Bilal Gas is counted on its own.
    const other = await createOrder({ distributor: std.DB, client: std.C3, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED });
    await createConfirmation({ order: other });
    expect((await links.newLink(std.DB, other.id, { send: 'SMS' })).status).toBe(200);
  });
});
