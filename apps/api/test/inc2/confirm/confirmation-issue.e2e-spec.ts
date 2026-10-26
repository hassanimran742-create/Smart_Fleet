/**
 * Issuing the link when an order is delivered (CUSTOMER_PAGE §1-§3, API_CONTRACT §9.3, §9.5, §9.7):
 * inside the delivering transaction, only while `confirmation.enabled` is on, once per order, with the
 * frozen snapshot and a QUEUED SMS row sent after commit. The driver never sees the link.
 *
 * Each case runs twice where it can: on the delivering transaction exactly as the stop finish writes it
 * (`finishDelivery`, so this lane's part is proven now), and through the scan lane's real routes (the
 * visit finish, the office manual delivery v2), which run once that lane is merged (SF_READY_LANES).
 */
import type { INestApplication } from '@nestjs/common';
import { ConfirmationService } from '../../../src/modules/confirmation/confirmation.interface';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authHeader } from '../../helpers/auth';
import { confirmationToken, customerLinks } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { scanCalls } from '../../helpers/scan-calls';
import type { StandardData } from '../../helpers/standard-data';
import {
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  confirmationOf,
  createConfirmApp,
  deliverX1,
  finishDelivery,
  freshStandard,
  messagesOf,
  moneyOf,
  pageCalls,
  setSetting,
  SpyProvider,
  textOf,
  waitForSends,
  withSpyProvider,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('issuing the confirmation when an order is delivered', () => {
  let app: INestApplication;
  let std: StandardData;
  const spy = new SpyProvider();
  const db = () => getTestPrisma();
  const scans = () => scanCalls(app);

  beforeAll(async () => {
    app = await createConfirmApp(withSpyProvider(spy));
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  beforeEach(() => spy.reset());

  /** The X1 snapshot of the cases: 2 × 11.8 kg and 1 × 45.4 kg delivered, two unlabelled 11.8 kg returns. */
  function x1Snapshot(deliveredAt: Date) {
    return {
      v: 1,
      shop: { name: 'Ahmed Gas', phoneE164: '+923211234567' },
      orderNo: 'AG-0001',
      deliveredAt: deliveredAt.toISOString(),
      delivered: [
        { cylinderTypeId: std.sizes.kg11_8, size: '11.8 kg', count: 2 },
        { cylinderTypeId: std.sizes.kg45_4, size: '45.4 kg', count: 1 },
      ],
      takenBack: [
        { cylinderTypeId: std.sizes.kg11_8, size: '11.8 kg', state: 'EMPTY', count: 1, unlabelled: true },
        { cylinderTypeId: std.sizes.kg11_8, size: '11.8 kg', state: 'PART_FILLED', count: 1, unlabelled: true },
      ],
    };
  }

  async function expectIssuedX1(orderId: string): Promise<void> {
    const order = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: 'DELIVERED' });
    const rows = await db().deliveryConfirmation.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ status: 'PENDING', tokenVersion: 1, response: null, distributorId: std.DA.id, phoneE164: '+923001234567' });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expiresAt.getTime()).toBe((order.deliveredAt as Date).getTime() + 72 * 3_600_000);
    expect(row.snapshot).toEqual(x1Snapshot(order.deliveredAt as Date));
    const messages = await messagesOf(orderId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      channel: 'SMS',
      provider: 'mock',
      templateKey: 'sms.deliveryConfirm.v1',
      locale: 'en',
      toPhoneE164: '+923001234567',
      idempotencyKey: `confirm:${orderId}:v1:sms`,
      confirmationId: row.id,
      orderId,
      // The pilot defaults: test mode on, an empty allowlist.
      status: 'SKIPPED',
      errorCode: 'NOT_A_TEST_PHONE',
    });
  }

  describe('with confirmation switched off (the default)', () => {
    beforeEach(async () => {
      std = await freshStandard(app, { enabled: false });
    });

    it('CNF-001 setting off: delivering an order makes no link and no message', async () => {
      const placed = await deliverX1(app, std, { deliver: false });
      const before = await moneyOf(std.DA.id);
      const d1 = await finishDelivery(app, placed, std.DR1.userId);
      expect(d1.issued).toBeNull();
      expect(await confirmationOf(d1.order.id)).toBeNull();
      expect(await messagesOf(d1.order.id)).toEqual([]);
      expect(spy.calls).toHaveLength(0);
      expect(before.balancePaisa).toBe(475_000n);
      expect(await moneyOf(std.DA.id)).toEqual(before);
      // The order lists' `confirmation` field: none.
      expect((await app.get(ConfirmationService).summariesFor([d1.order.id])).get(d1.order.id)).toBeUndefined();
    });

    it('CNF-001 setting off: finishing a visit makes no link and no message (POST …/finish)', async () => {
      const d1 = await deliverX1(app, std, { deliver: false });
      const before = await moneyOf(std.DA.id);
      const res = await scans().finishStop(std.DR1, d1.trip.id, d1.stopId, {}).expect(200);
      expect(res.body.order).toMatchObject({ id: d1.order.id, status: 'DELIVERED' });
      expect(res.body).toHaveProperty('nextStopId');
      expect(JSON.stringify(res.body)).not.toContain('/c/');
      expect(await db().order.findUniqueOrThrow({ where: { id: d1.order.id } })).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'SCANNED' });
      expect((await db().tripStop.findUniqueOrThrow({ where: { id: d1.stopId } })).status).toBe('DONE');
      expect(await confirmationOf(d1.order.id)).toBeNull();
      expect(await messagesOf(d1.order.id)).toEqual([]);
      expect(spy.calls).toHaveLength(0);
      expect(await moneyOf(std.DA.id)).toEqual(before);
    });

    it("CNF-001 step 4: the order lists carry `confirmation` (null for an order delivered while it was off)", async () => {
      const d1 = await deliverX1(app, std);
      expect(d1.issued).toBeNull();
      await setSetting(app, 'confirmation.enabled', true, 'Owner switched confirmation on');
      const d2 = await deliverX1(app, std);
      const done = await http(app).get('/api/v1/orders').query({ tab: 'done' }).set(authHeader(std.DA.actor)).expect(200);
      const listed = (id: string) => done.body.items.find((item: { id: string }) => item.id === id);
      expect(listed(d1.order.id)).toHaveProperty('confirmation', null);
      expect(listed(d2.order.id).confirmation).toEqual({ status: 'PENDING', response: null, caseOpen: false });
      const one = await http(app).get(`/api/v1/orders/${d1.order.id}`).set(authHeader(std.DA.actor)).expect(200);
      expect(one.body).toHaveProperty('confirmation', null);
    });
  });

  describe('with confirmation switched on', () => {
    beforeEach(async () => {
      std = await freshStandard(app);
    });

    it('CNF-003 setting on: the delivering transaction issues one pending link', async () => {
      const d1 = await deliverX1(app, std, { deliver: false });
      const prisma = app.get(PrismaService);
      const deliveredAt = new Date();
      const issued = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: d1.order.id }, data: { status: 'DELIVERED', deliveredAt, deliveryMethod: 'SCANNED' } });
        const out = await app.get(ConfirmationService).issueForDeliveredOrder(tx, { orderId: d1.order.id, stopId: d1.stopId, deliveredAt });
        // Written inside the delivery's transaction, QUEUED until after commit.
        expect((await tx.outboundMessage.findMany({ where: { orderId: d1.order.id } })).map((m) => m.status)).toEqual(['QUEUED']);
        return out;
      });
      expect(issued).toMatchObject({ orderId: d1.order.id, created: true, messageId: expect.any(String) });
      await app.get(ConfirmationService).sendIssued(issued);
      await expectIssuedX1(d1.order.id);
      expect(await db().outboundMessage.count({ where: { status: 'QUEUED' } })).toBe(0);
      expect((await app.get(ConfirmationService).summariesFor([d1.order.id])).get(d1.order.id)).toEqual({ status: 'PENDING', response: null, caseOpen: false });
    });

    it('CNF-003 setting on: finishing the visit issues one pending link (POST …/finish)', async () => {
      const d1 = await deliverX1(app, std, { deliver: false });
      const res = await scans().finishStop(std.DR1, d1.trip.id, d1.stopId, {}).expect(200);
      expect(res.body.order).toMatchObject({ status: 'DELIVERED' });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('/c/');
      await waitForSends();
      await expectIssuedX1(d1.order.id);
      const row = (await confirmationOf(d1.order.id))!;
      expect(text).not.toContain(confirmationToken(row.id, 1));
    });

    it('CNF-025 after a real issue no column of delivery_confirmations holds the raw token, only its hash', async () => {
      const d1 = await deliverX1(app, std);
      const row = (await confirmationOf(d1.order.id))!;
      const token = confirmationToken(row.id, row.tokenVersion);
      const columns = await db().$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_confirmations' ORDER BY ordinal_position`;
      expect(columns.length).toBeGreaterThan(10);
      const [raw] = await db().$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ${columns.map((c) => `"${c.column_name}"::text AS "${c.column_name}"`).join(', ')} FROM delivery_confirmations WHERE id = $1::uuid`,
        row.id,
      );
      for (const [column, value] of Object.entries(raw)) {
        expect({ column, holdsToken: String(value ?? '').includes(token) }).toEqual({ column, holdsToken: false });
      }
      expect(raw.token_hash).toBe(require('crypto').createHash('sha256').update(token).digest('hex'));
      const messages = await messagesOf(d1.order.id);
      for (const message of messages) expect(JSON.stringify(message)).not.toContain(token);
    });

    it('CNF-004 issuing again for the same order keeps one link and one SMS', async () => {
      const d1 = await deliverX1(app, std);
      const row = (await confirmationOf(d1.order.id))!;
      const again = await app.get(PrismaService).$transaction((tx) =>
        app.get(ConfirmationService).issueForDeliveredOrder(tx, { orderId: d1.order.id, stopId: d1.stopId, deliveredAt: new Date() }),
      );
      expect(again).toEqual({ confirmationId: row.id, orderId: d1.order.id, messageId: null, created: false });
      await app.get(ConfirmationService).sendIssued(again);
      const after = (await confirmationOf(d1.order.id))!;
      expect(after).toMatchObject({ id: row.id, tokenVersion: 1, tokenHash: row.tokenHash, expiresAt: row.expiresAt });
      expect(await db().deliveryConfirmation.count({ where: { orderId: d1.order.id } })).toBe(1);
      expect((await messagesOf(d1.order.id)).map((m) => m.idempotencyKey)).toEqual([`confirm:${d1.order.id}:v1:sms`]);
    });

    it('CNF-004 a double tap on Finish visit keeps one link and one SMS (POST …/finish twice)', async () => {
      await setSetting(app, 'messaging.allowlist', ['+923001234567']);
      const d1 = await deliverX1(app, std, { deliver: false });
      await scans().finishStop(std.DR1, d1.trip.id, d1.stopId, {}).expect(200);
      const repeat = await scans().finishStop(std.DR1, d1.trip.id, d1.stopId, {}).expect(200);
      expect(repeat.headers['x-already-applied']).toBe('true');
      await waitForSends();
      expect(await db().deliveryConfirmation.count({ where: { orderId: d1.order.id } })).toBe(1);
      expect(await messagesOf(d1.order.id)).toHaveLength(1);
      expect(spy.calls).toHaveLength(1);
    });

    it('CNF-005 an office manual delivery also issues a link (POST /orders/:id/manual-delivery)', async () => {
      // The driver could not scan at the door: the cylinders are still loaded on the van.
      const d1 = await deliverX1(app, std, { deliver: false, handOver: false, unlabelled: [] });
      const before = await moneyOf(std.DA.id);
      await scans()
        .manualDelivery(std.SA1, d1.order.id, { reason: 'Driver phone not working at the door', cylinders: d1.given.map((c) => ({ code: c.shortCode })) })
        .expect(200);
      expect(await db().order.findUniqueOrThrow({ where: { id: d1.order.id } })).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'MANUAL' });
      expect(await moneyOf(std.DA.id)).toEqual(before);
      await waitForSends();
      const row = (await confirmationOf(d1.order.id))!;
      expect(row.status).toBe('PENDING');
      expect((row.snapshot as { delivered: unknown }).delivered).toEqual([
        { cylinderTypeId: std.sizes.kg11_8, size: '11.8 kg', count: 2 },
        { cylinderTypeId: std.sizes.kg45_4, size: '45.4 kg', count: 1 },
      ]);
      expect((row.snapshot as { takenBack: unknown }).takenBack).toEqual([]);
      expect((await messagesOf(d1.order.id)).map((m) => m.idempotencyKey)).toEqual([`confirm:${d1.order.id}:v1:sms`]);
      const shared = await customerLinks(app).share(std.SA1, d1.order.id, 'COPY').expect(200);
      const open = await pageCalls(app).path('get', new URL(shared.body.url).pathname).expect(200);
      expect(textOf(open.text)).toContain('Taken back None');
    });

    it('CNF-040 the driver never gets the link (the finish, trips, stops, orders and home answers)', async () => {
      const d1 = await deliverX1(app, std, { deliver: false });
      const finish = await scans().finishStop(std.DR1, d1.trip.id, d1.stopId, {}).expect(200);
      await waitForSends();
      const row = (await confirmationOf(d1.order.id))!;
      const token = confirmationToken(row.id, 1);
      const answers = [
        finish,
        await scans().trip(std.DR1, d1.trip.id).expect(200),
        await scans().stop(std.DR1, d1.trip.id, d1.stopId).expect(200),
        await http(app).get(`/api/v1/orders/${d1.order.id}`).set(authHeader(std.DR1.actor)).expect(200),
        await scans().driverHome(std.DR1).expect(200),
      ];
      for (const res of answers) {
        const text = JSON.stringify(res.body);
        expect(text).not.toContain('/c/');
        expect(text).not.toContain(token);
        expect(text).not.toContain('Did you get it?');
        expect(text).not.toMatch(/"(url|link|confirmationUrl)"/);
      }
      expect((await messagesOf(d1.order.id)).filter((m) => m.channel === 'SHARE_LINK')).toEqual([]);
      expect(row.tokenVersion).toBe(1);
    });

    it('MSG-001 the mock provider records the outgoing SMS of a finished visit (POST …/finish)', async () => {
      await setSetting(app, 'messaging.allowlist', ['+923001234567']);
      const d1 = await deliverX1(app, std, { deliver: false });
      await scans().finishStop(std.DR1, d1.trip.id, d1.stopId, {}).expect(200);
      await waitForSends();
      const [row] = await messagesOf(d1.order.id);
      expect(row).toMatchObject({ channel: 'SMS', provider: 'mock', status: 'SKIPPED', errorCode: 'MOCK_PROVIDER', providerMessageId: null });
      expect(row.bodyRedacted.startsWith('Ahmed Gas: Order AG-0001 delivered. Did you get it? Tap ')).toBe(true);
      expect(row.bodyRedacted).toContain('[link]');
    });
  });
});
