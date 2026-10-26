/**
 * The shop's and the office's confirmation routes (API_CONTRACT §9.7, CUSTOMER_PAGE §10):
 * `GET /orders/:id/confirmation`, `POST …/share` and `POST …/new-link`, with their common checks (the
 * switch, a driver or another distributor 404, not delivered 409, no row 404), the share log and the
 * link rotation.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import { formatPkPhone } from '@smartfleet/shared-utils';
import { ConfirmationService } from '../../../src/modules/confirmation/confirmation.interface';
import { renderSms } from '../../../src/modules/messaging/messaging.interface';
import { authHeader } from '../../helpers/auth';
import { confirmationToken, customerLinks, tokenFromUrl } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createOrder, createTrip } from '../../helpers/runs';
import type { StandardData } from '../../helpers/standard-data';
import {
  auditRows,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  confirmationOf,
  createConfirmApp,
  currentToken,
  deliverX1,
  finishDelivery,
  freshStandard,
  LINK_BASE,
  messagesOf,
  pageCalls,
  patchConfirmation,
  setSetting,
  textOf,
  waitForSends,
  X1_FEE_PAISA,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

const KEY = (n: number) => `77777777-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

describeDb('confirmation routes for the shop and the office', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const links = () => customerLinks(app);
  const page = () => pageCalls(app);

  beforeAll(async () => {
    app = await createConfirmApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  beforeEach(async () => {
    std = await freshStandard(app);
  });

  it('CNF-002 setting off: the confirmation routes answer "switched off", and links are closed', async () => {
    // D2 was delivered while the setting was on (its link T2 is PENDING); D1 after it was switched off.
    const d2 = await deliverX1(app, std);
    await setSetting(app, 'confirmation.enabled', false, 'Owner switched confirmation off');
    const d1 = await deliverX1(app, std);
    expect(d1.issued).toBeNull();

    const disabled = ERROR_MESSAGE_EN.FEATURE_DISABLED;
    for (const res of [
      await links().view(std.DA, d1.order.id).expect(403),
      await links().share(std.DA, d1.order.id, 'WHATSAPP').expect(403),
      await links().newLink(std.DA, d1.order.id).expect(403),
      await links().view(std.SA1, d1.order.id).expect(403),
      await links().view(std.DR1, d1.order.id).expect(403),
    ]) {
      expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED', message: disabled });
      expect(res.headers['x-feature-disabled']).toBe('confirmations');
    }
    expect(await confirmationOf(d1.order.id)).toBeNull();
    expect(await messagesOf(d1.order.id)).toEqual([]);

    const config = await http(app).get('/api/v1/app/config').expect(200);
    expect(config.body.features.confirmations).toBe(false);

    const t2 = d2.token as string;
    for (const res of [await page().get(t2).expect(410), await page().answer(t2, 'YES').expect(410)]) {
      expect(textOf(res.text)).toContain('This link is closed');
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    }
    expect(await confirmationOf(d2.order.id)).toMatchObject({ status: 'PENDING', response: null });
    expect(await auditRows('confirmation.answer')).toHaveLength(0);

    // Step 7: switched on again: D1 has no confirmation (no back-fill); T2 works again.
    await http(app)
      .patch('/api/v1/settings/confirmation.enabled')
      .set(authHeader(std.SA1.actor))
      .send({ value: true, reason: 'Owner switched confirmation back on' })
      .expect(200);
    const after = await links().view(std.DA, d1.order.id).expect(404);
    expect(after.body.code).toBe('NOT_FOUND');
    expect(await confirmationOf(d1.order.id)).toBeNull();
    const open = await page().get(t2).expect(200);
    expect(textOf(open.text)).toContain('Did you get your delivery?');
  });

  it("CNF-002 step 7: an order delivered while the setting was off reads confirmation null (GET /orders/:id)", async () => {
    await setSetting(app, 'confirmation.enabled', false, 'Owner switched confirmation off');
    const d1 = await deliverX1(app, std);
    await setSetting(app, 'confirmation.enabled', true, 'Owner switched confirmation back on');
    const order = await http(app).get(`/api/v1/orders/${d1.order.id}`).set(authHeader(std.DA.actor)).expect(200);
    expect(order.body).toHaveProperty('confirmation', null);
  });

  it('CNF-023 (wiring) the API as main.ts sets it up serves the page at /c/ and not under /api/v1', async () => {
    // test/helpers/app.ts is createTestApp with configureApp alone, as main.ts runs it.
    const { createTestApp } = await import('../../helpers/app');
    const plain = await createTestApp();
    try {
      const d1 = await deliverX1(plain, std);
      const page = await http(plain).get(`/c/${d1.token}`).set('X-Forwarded-For', '198.51.100.200').expect(200);
      expect(textOf(page.text)).toContain('Did you get your delivery?');
      expect(page.headers['x-request-id']).toEqual(expect.any(String));
      const api = await http(plain).get(`/api/v1/c/${d1.token}`).expect(404);
      expect(api.body).toMatchObject({ code: 'NOT_FOUND', path: '/api/v1/c/[token]' });
    } finally {
      await plain.close();
    }
  });

  it('CNF-006 before delivery the confirmation routes say "not delivered yet"', async () => {
    const x1 = await createOrder({
      distributor: std.DA,
      client: std.C1,
      feePaisa: X1_FEE_PAISA,
      lines: [
        { cylinderTypeId: std.sizes.kg11_8, fullCount: 2 },
        { cylinderTypeId: std.sizes.kg45_4, fullCount: 1 },
      ],
    });
    await createTrip({ driver: std.DR1, distributor: std.DA, orders: [x1] });
    const x2 = await createOrder({ distributor: std.DA, client: std.C2, feePaisa: 40_000n, lines: [{ cylinderTypeId: std.sizes.kg15, fullCount: 3 }] });
    await db().order.update({ where: { id: x2.id }, data: { status: 'FAILED', failedAt: new Date(), failureReasonCode: 'CUSTOMER_NOT_HOME' } });
    for (const order of [x1, x2]) {
      for (const res of [
        await links().view(std.DA, order.id).expect(409),
        await links().share(std.DA, order.id, 'COPY').expect(409),
        await links().newLink(std.DA, order.id).expect(409),
      ]) {
        expect(res.body).toMatchObject({ code: 'CONFIRM_NOT_READY', message: "This order isn't delivered yet." });
      }
      expect(await confirmationOf(order.id)).toBeNull();
      expect(await messagesOf(order.id)).toEqual([]);
    }
  });

  it('CNF-022 a new link stops the old one and keeps the same deadline', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const before = (await confirmationOf(d1.order.id))!;
    const l1 = d1.token as string;
    const smsRowsBefore = (await messagesOf(d1.order.id)).length;

    const view = await links().newLink(std.DA, d1.order.id, {}).expect(200);
    const after = (await confirmationOf(d1.order.id))!;
    expect(after.tokenVersion).toBe(2);
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect((await messagesOf(d1.order.id)).length).toBe(smsRowsBefore);
    expect(view.body).toMatchObject({ reach: 'NOT_SENT', lastMessage: null, status: 'PENDING' });

    const shared = await links().share(std.DA, d1.order.id, 'COPY').expect(200);
    const l2 = tokenFromUrl(shared.body.url);
    expect(l2).not.toBe(l1);

    for (const res of [await page().get(l1).expect(404), await page().answer(l1, 'YES').expect(404)]) {
      expect(textOf(res.text)).toContain("We can't find this link");
    }
    expect((await confirmationOf(d1.order.id))?.status).toBe('PENDING');
    const l2Page = await page().get(l2).expect(200);
    expect(textOf(l2Page.text)).toContain(`Order ${d1.order.shortCode}`);

    const audits = await auditRows('confirmation.new_link', d1.order.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorKind: 'USER', actorUserId: std.DA.userId, resourceType: 'Order' });
    expect(audits[0].diff).toMatchObject({ tokenVersion: 2, no: d1.order.shortCode });

    // The race: a new link and an answer on the old link at the same moment.
    const d2 = await deliverX1(app, std);
    const old = d2.token as string;
    const [rotated, answered] = await Promise.all([links().newLink(std.DA, d2.order.id, {}), page().answer(old, 'YES')]);
    const row = (await confirmationOf(d2.order.id))!;
    if (answered.status === 303) {
      expect(row).toMatchObject({ status: 'ANSWERED', response: 'YES', tokenVersion: 1 });
      expect(rotated.status).toBe(409);
      expect(rotated.body.code).toBe('CONFIRM_CLOSED');
    } else {
      expect(answered.status).toBe(404);
      expect(rotated.status).toBe(200);
      expect(row).toMatchObject({ status: 'PENDING', response: null, tokenVersion: 2 });
    }
  });

  it('CNF-040 the driver never gets the link (the confirmation routes answer 404)', async () => {
    const d1 = await deliverX1(app, std);
    const notFound = ERROR_MESSAGE_EN.NOT_FOUND;
    for (const res of [
      await links().view(std.DR1, d1.order.id).expect(404),
      await links().share(std.DR1, d1.order.id, 'WHATSAPP').expect(404),
      await links().newLink(std.DR1, d1.order.id, {}).expect(404),
    ]) {
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: notFound });
      expect(JSON.stringify(res.body)).not.toContain('/c/');
    }
    expect((await messagesOf(d1.order.id)).filter((row) => row.channel === 'SHARE_LINK')).toEqual([]);
    expect((await confirmationOf(d1.order.id))?.tokenVersion).toBe(1);
  });

  it('CNF-041 another distributor gets 404 on DA\'s confirmation', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const before = await messagesOf(d1.order.id);
    for (const res of [
      await links().view(std.DB, d1.order.id).expect(404),
      await links().share(std.DB, d1.order.id, 'COPY').expect(404),
      await links().newLink(std.DB, d1.order.id, { send: 'SMS' }).expect(404),
    ]) {
      expect(res.body.code).toBe('NOT_FOUND');
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(d1.order.shortCode);
      expect(text).not.toContain('Ahmed Gas');
    }
    expect((await confirmationOf(d1.order.id))?.tokenVersion).toBe(1);
    expect(await messagesOf(d1.order.id)).toEqual(before);
  });

  it('CNF-042 the confirmation view for the shop and the office', async () => {
    await setSetting(app, 'messaging.allowlist', ['+923001234567']);
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const row = (await confirmationOf(d1.order.id))!;
    const deliveredAt = (await db().order.findUniqueOrThrow({ where: { id: d1.order.id } })).deliveredAt as Date;
    for (const caller of [std.DA, std.SA1]) {
      const res = await links().view(caller, d1.order.id).expect(200);
      expect(res.body).toMatchObject({
        orderId: d1.order.id,
        orderShortCode: 'AG-0001',
        status: 'PENDING',
        response: null,
        comment: null,
        respondedAt: null,
        expiresAt: new Date(deliveredAt.getTime() + 72 * 3_600_000).toISOString(),
        reach: 'NOT_SENT',
        lastMessage: { channel: 'SMS', status: 'SKIPPED', errorCode: 'MOCK_PROVIDER', byName: null, via: null },
        customer: { name: 'Sana', phoneDisplay: '0300 1234567', phoneValid: true },
        delivered: [
          { size: '11.8 kg', count: 2 },
          { size: '45.4 kg', count: 1 },
        ],
        takenBack: [
          { size: '11.8 kg', state: 'EMPTY', count: 1, unlabelled: true },
          { size: '11.8 kg', state: 'PART_FILLED', count: 1, unlabelled: true },
        ],
        caseOpen: false,
        allowedActions: ['SHARE', 'NEW_LINK'],
      });
      expect(row.expiresAt.toISOString()).toBe(res.body.expiresAt);
      const text = JSON.stringify(res.body);
      for (const banned of ['token', 'url', 'Hash', 'Paisa', '/c/', confirmationToken(row.id, 1)]) expect(text).not.toContain(banned);
    }
  });

  it('MSG-007 sharing returns the link, the message and app links, and logs each share', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const before = (await confirmationOf(d1.order.id))!;
    const first = await links().share(std.DA, d1.order.id, 'WHATSAPP').expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const token = d1.token as string;
    const url = `${LINK_BASE()}/c/${token}`;
    const message = renderSms({ shop: 'Ahmed Gas', orderNo: 'AG-0001', link: url, phone: formatPkPhone('+923211234567', 'compact') }).text;
    expect(first.body).toEqual({
      url,
      message,
      whatsappUrl: `https://wa.me/923001234567?text=${encodeURIComponent(message)}`,
      smsUrl: `sms:+923001234567?body=${encodeURIComponent(message)}`,
      expiresAt: before.expiresAt.toISOString(),
    });
    expect(url).toMatch(/^https:\/\/smartfleetpk\.com\/c\/[0-9a-z]{26}$/);
    expect(message).toContain(url);
    for (const via of ['SMS', 'SHARE_SHEET', 'COPY'] as const) {
      expect((await links().share(std.DA, d1.order.id, via).expect(200)).body.url).toBe(url);
    }
    expect((await links().share(std.SA2, d1.order.id, 'COPY').expect(200)).body.url).toBe(url);
    const after = (await confirmationOf(d1.order.id))!;
    expect(after.tokenVersion).toBe(1);
    expect(after.tokenHash).toBe(before.tokenHash);

    const open = await page().get(token).expect(200);
    expect(textOf(open.text)).toContain('Did you get your delivery?');

    const shares = (await messagesOf(d1.order.id)).filter((row) => row.channel === 'SHARE_LINK');
    expect(shares.map((row) => [row.provider, row.status, row.createdByUserId])).toEqual([
      ['share-whatsapp', 'SENT', std.DA.userId],
      ['share-sms', 'SENT', std.DA.userId],
      ['share-sheet', 'SENT', std.DA.userId],
      ['share-copy', 'SENT', std.DA.userId],
      ['share-copy', 'SENT', std.SA2.id],
    ]);
    for (const row of shares) {
      expect(row.idempotencyKey).toMatch(new RegExp(`^share:${d1.order.id}:[0-9a-f-]{36}$`));
      expect(row.bodyRedacted).toContain('[link]');
      expect(row.bodyRedacted).not.toContain(token);
    }
    const view = await links().view(std.DA, d1.order.id).expect(200);
    expect(view.body).toMatchObject({ reach: 'SHARED', lastMessage: { channel: 'SHARE_LINK', status: 'SENT', via: 'COPY', byName: 'Ops' } });
  });

  it('MSG-008 retrying share or new link with the same Idempotency-Key does not double it', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const [k1, k2, k3] = [KEY(1), KEY(2), KEY(3)];
    const first = await links().share(std.DA, d1.order.id, 'WHATSAPP', k1).expect(200);
    const repeat = await links().share(std.DA, d1.order.id, 'WHATSAPP', k1).expect(200);
    expect(repeat.headers['idempotent-replay']).toBe('true');
    expect(repeat.body).toEqual(first.body);
    expect((await messagesOf(d1.order.id)).filter((row) => row.idempotencyKey === `share:${d1.order.id}:${k1}`)).toHaveLength(1);

    const rotated = await links().newLink(std.DA, d1.order.id, { send: 'SMS' }, k2).expect(200);
    await waitForSends();
    const again = await links().newLink(std.DA, d1.order.id, { send: 'SMS' }, k2).expect(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.orderId).toBe(rotated.body.orderId);
    expect((await confirmationOf(d1.order.id))?.tokenVersion).toBe(2);
    expect((await messagesOf(d1.order.id)).filter((row) => row.idempotencyKey === `confirm:${d1.order.id}:v2:sms`)).toHaveLength(1);
    const v2 = await currentToken(d1.order.id);
    await page().get(v2).expect(200);

    await links().newLink(std.DA, d1.order.id, {}, k3).expect(200);
    expect((await confirmationOf(d1.order.id))?.tokenVersion).toBe(3);
    expect(textOf((await page().get(v2).expect(404)).text)).toContain("We can't find this link");

    const rows = (await messagesOf(d1.order.id)).length;
    const conflict = await links().share(std.DA, d1.order.id, 'SMS', k1).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await messagesOf(d1.order.id)).length).toBe(rows);
  });

  it('MSG-009 sharing is refused once the link is closed, and after 20 shares in an hour', async () => {
    const d1 = await deliverX1(app, std);
    const d2 = await deliverX1(app, std);
    const d3 = await deliverX1(app, std);
    await page().answer(d1.token as string, 'YES').expect(303);
    await patchConfirmation(d2.order.id, { expiresAt: new Date(Date.now() - 60_000) });
    await app.get(ConfirmationService).expireDue();

    for (const d of [d1, d2]) {
      const rows = (await messagesOf(d.order.id)).length;
      const version = (await confirmationOf(d.order.id))?.tokenVersion;
      for (const res of [await links().share(std.DA, d.order.id, 'COPY').expect(409), await links().newLink(std.DA, d.order.id, {}).expect(409)]) {
        expect(res.body).toMatchObject({ code: 'CONFIRM_CLOSED', message: 'The customer can no longer answer for this order.' });
      }
      expect((await messagesOf(d.order.id)).length).toBe(rows);
      expect((await confirmationOf(d.order.id))?.tokenVersion).toBe(version);
    }
    expect((await links().view(std.DA, d1.order.id).expect(200)).body.allowedActions).toEqual([]);

    for (let i = 1; i <= 20; i++) await links().share(std.DA, d3.order.id, 'COPY', randomUUID()).expect(200);
    const limited = await links().share(std.DA, d3.order.id, 'COPY', randomUUID()).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.body.details.minutes).toBeGreaterThanOrEqual(1);
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect((await messagesOf(d3.order.id)).filter((row) => row.channel === 'SHARE_LINK')).toHaveLength(20);
  });

  it('CNF-005 (the confirmation part) a delivery by the office issues a link with what it named', async () => {
    // The office's manual delivery v2 issues in its own transaction (the scan lane's route); here the
    // order is delivered MANUAL with no take-back, as that route records it.
    const d = await deliverX1(app, std, { unlabelled: [], deliver: false });
    const done = await finishDelivery(app, d, std.SA1.id, 'MANUAL');
    const row = (await confirmationOf(d.order.id))!;
    expect(row.status).toBe('PENDING');
    expect((row.snapshot as { delivered: unknown; takenBack: unknown }).delivered).toEqual([
      { cylinderTypeId: std.sizes.kg11_8, size: '11.8 kg', count: 2 },
      { cylinderTypeId: std.sizes.kg45_4, size: '45.4 kg', count: 1 },
    ]);
    expect((row.snapshot as { takenBack: unknown }).takenBack).toEqual([]);
    expect((await messagesOf(d.order.id)).map((m) => m.idempotencyKey)).toEqual([`confirm:${d.order.id}:v1:sms`]);
    const shared = await links().share(std.SA1, d.order.id, 'COPY').expect(200);
    const opened = await http(app).get(new URL(shared.body.url).pathname).set('X-Forwarded-For', '198.51.100.7').expect(200);
    expect(textOf(opened.text)).toContain('Taken back None');
    expect(done.token).toBe(tokenFromUrl(shared.body.url));
  });
});
