/**
 * The delivery-cost rules (ADR-06, ADR-07, API_CONTRACT §5.5, §7.6): deducted once when the order is
 * placed, returned once on a cancel before delivery has started, never moved by anything at the door.
 */
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { businessDate, businessDayRange } from '@smartfleet/shared-utils';
import { systemActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, x1OrderBody } from '../helpers/standard-data';
import { API, OrdersFixture, newKey, together, type OrderBody } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

// Booting the whole API and the many-round race cases need more than the 30 s default on a busy machine.
jest.setTimeout(300_000);

describeDb('api-orders: delivery costs', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
  });

  afterAll(async () => {
    await app?.close();
  });

  const debits = (orderId?: string) => f.ledger({ entryType: 'DEBIT_ORDER', ...(orderId ? { orderId } : {}) });
  const reversals = (orderId?: string) => f.ledger({ entryType: 'CREDIT_ORDER_REVERSAL', ...(orderId ? { orderId } : {}) });

  it('FEE-001 placing X1 deducts Rs 480 in the same transaction that creates the order', async () => {
    const { std } = f;
    // Step 1.
    const res = await f.placeX1(newKey(), { deliveryLabel: 'House 1, North', quotedTotalPaisa: '48000' }).expect(201);
    const order = res.body as OrderBody;
    expect(order).toMatchObject({
      shortCode: 'AG-0001',
      status: 'PENDING',
      stage: 'NEEDS_DRIVER',
      fee: {
        totalPaisa: '48000',
        status: 'DEDUCTED',
        breakdown: {
          basePaisa: '25000',
          lines: [
            { sizeLabel: '11.8 kg', count: 2, perCylinderPaisa: '4000', subtotalPaisa: '8000' },
            { sizeLabel: '45.4 kg', count: 1, perCylinderPaisa: '15000', subtotalPaisa: '15000' },
          ],
        },
      },
      cancel: { allowed: true, refundPaisa: '48000', noRefundReason: null },
      deliveryFeePaisa: '48000',
      paymentStatus: 'PAID_VIA_LEDGER',
      originStore: { name: 'Ahmed Gas Store' },
    });
    // Step 2 (the balance; the wallet routes are checked with api-money below).
    expect(await f.balance()).toBe(452_000n);
    // Step 3.
    const row = await f.order(order.id);
    expect(row).toMatchObject({ feeStatus: 'DEDUCTED', feeStrategy: 'DISTRIBUTOR_ZONE', feeBasePaisa: 25_000n });
    expect(row.feeDetails).toMatchObject({ zoneId: std.zones.North.id, zoneName: 'North' });
    const lines = await f.db.orderLine.findMany({ where: { orderId: order.id } });
    const byType = new Map(lines.map((line) => [line.cylinderTypeId, line]));
    expect(byType.get(std.sizes.kg11_8)).toMatchObject({ feePerCylinderPaisa: 4_000n, feePaisa: 8_000n });
    expect(byType.get(std.sizes.kg45_4)).toMatchObject({ feePerCylinderPaisa: 15_000n, feePaisa: 15_000n });
    const debit = await debits(order.id);
    expect(debit).toHaveLength(1);
    expect(debit[0]).toMatchObject({ amountPaisa: -48_000n, balanceAfterPaisa: 452_000n, idempotencyKey: `order:${order.id}:debit` });
    const audits = await f.audits('order.create', order.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.DA.userId, distributorId: std.DA.id });
    // No dispatch job: automatic assignment is off.
    const queue = app.get<Queue>(getQueueToken('dispatch'));
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    expect(jobs.filter((job) => job.data?.orderId === order.id)).toEqual([]);
    await f.expectWalletsConsistent();
  });

  it('FEE-001 the wallet and its statement show the deduction', async () => {
    const order = await f.x1();
    const wallet = await f.as(f.std.DA).get('/wallet').expect(200);
    expect(wallet.body.balancePaisa).toBe('452000');
    const statement = await f.as(f.std.DA).get('/wallet/statement').expect(200);
    expect(statement.body.items[0]).toMatchObject({
      kind: 'DELIVERY_COST',
      amountPaisa: '-48000',
      balanceAfterPaisa: '452000',
      subject: { type: 'ORDER', id: order.id },
    });
  });

  it('FEE-002 X4: the balance must cover the cost exactly; Rs 1 short is refused and nothing is created', async () => {
    const { std, db } = f;
    await f.setBalance(std.DA, 48_000n);
    // Step 1.
    const first = await f.placeX1(newKey()).expect(201);
    expect(await f.balance()).toBe(0n);
    expect((await debits(first.body.id))[0].balanceAfterPaisa).toBe(0n);
    // Step 2.
    await f.setBalance(std.DA, 47_900n);
    const before = {
      orders: await db.order.count(),
      lines: await db.orderLine.count(),
      ledger: await db.ledgerEntry.count(),
      audits: await db.auditLog.count({ where: { action: 'order.create' } }),
      next: (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo,
    };
    // Step 3.
    const refused = await f.placeX1(newKey()).expect(409);
    expect(refused.body).toMatchObject({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      details: { requiredPaisa: '48000', balancePaisa: '47900', shortByPaisa: '100' },
      message: 'Not enough balance. This needs Rs 480 and you have Rs 479. Add money to continue.',
    });
    // Step 4.
    expect(await db.order.count()).toBe(before.orders);
    expect(await db.orderLine.count()).toBe(before.lines);
    expect(await db.ledgerEntry.count()).toBe(before.ledger);
    expect(await db.auditLog.count({ where: { action: 'order.create' } })).toBe(before.audits);
    expect((await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo).toBe(before.next);
    expect(await f.balance()).toBe(47_900n);
    await f.expectWalletsConsistent();
  });

  it('FEE-003 a zero delivery cost writes no ledger row, and cancelling it returns nothing', async () => {
    const { std } = f;
    await f.as(std.SA1).put(`/pricing/prices/${std.DA.id}/${std.zones.South.id}`).send({ basePaisa: 0 }).expect(200);
    // Step 1.
    const placed = await f.placeX2().expect(201);
    expect(placed.body).toMatchObject({ fee: { totalPaisa: '0', status: 'NONE' }, deliveryFeePaisa: '0', paymentStatus: 'UNPAID' });
    expect(await debits()).toEqual([]);
    expect(await f.balance()).toBe(500_000n);
    // Step 2.
    const read = await f.as(std.DA).get(`/orders/${placed.body.id}`).expect(200);
    expect(read.body.cancel).toEqual({ allowed: true, refundPaisa: '0', noRefundReason: null });
    expect(read.body.allowedActions).toContain('CANCEL');
    // Step 3.
    const cancelled = await f.cancel(placed.body.id, { reasonCode: 'DUPLICATE' }).expect(200);
    expect(cancelled.body.refundedPaisa).toBe('0');
    expect(await reversals()).toEqual([]);
    const audit = await f.audits('order.cancel', placed.body.id);
    expect(audit[0].diff).toMatchObject({ refunded: false, refundPaisa: '0' });
    // Step 4.
    await f.as(std.SA1).put(`/pricing/prices/${std.DA.id}/${std.zones.South.id}`).send({ basePaisa: 40000 }).expect(200);
  });

  it('FEE-004 a distributor that is not active cannot place an order, and nothing is deducted', async () => {
    const { std, db } = f;
    await db.distributor.update({ where: { id: std.DA.id }, data: { status: 'SUSPENDED' } });
    const refused = await f.placeX1().expect(403);
    expect(refused.body).toMatchObject({ code: 'DISTRIBUTOR_NOT_ACTIVE', message: "This shop account isn't active. Call the office." });
    expect(await db.order.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'order.create' } })).toBe(0);
    expect(await debits()).toEqual([]);
    expect(await f.balance()).toBe(500_000n);
    await db.distributor.update({ where: { id: std.DA.id }, data: { status: 'ACTIVE' } });
  });

  it('FEE-004 a suspended shop cannot ask for a top-up, while office money actions still work', async () => {
    const { std, db } = f;
    // Top-ups need the company account (rule 1 of POST /payments/topup-requests); set as the settings CLI does.
    await app
      .get(SettingsService)
      .set('topup.account', { ...DUMMY_COMPANY_ACCOUNT }, systemActor('cli:settings'), 'Orders test setup', { allowNotEditable: true });
    const tellUs = (amountPaisa: number) =>
      f.as(std.DA).post('/payments/topup-requests').set('Idempotency-Key', newKey()).send({ amountPaisa, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP' });
    // Step 1.
    const R = (await tellUs(200_000).expect(201)).body as { id: string };
    // Step 2.
    await db.distributor.update({ where: { id: std.DA.id }, data: { status: 'SUSPENDED' } });
    // Step 3.
    const payments = await db.payment.count();
    for (const res of [await f.placeX1(), await tellUs(100_000)]) {
      expect([res.status, res.body.code, res.body.message]).toEqual([403, 'DISTRIBUTOR_NOT_ACTIVE', "This shop account isn't active. Call the office."]);
    }
    expect(await db.payment.count()).toBe(payments);
    expect(await db.order.count()).toBe(0);
    expect(await f.audits('order.create')).toEqual([]);
    // Step 4.
    const approved = await f
      .as(std.SA1)
      .post(`/payments/${R.id}/approve`)
      .set('Idempotency-Key', newKey())
      .send({ bankReference: 'FT-FEE-0004', bankAmountPaisa: 200_000, bankTime: new Date(Date.now() - 60_000).toISOString() })
      .expect(200);
    expect(approved.body.wallet.balancePaisa).toBe('700000');
    const correction = await f
      .as(std.SA1)
      .post(`/admin/distributors/${std.DA.id}/wallet/corrections`)
      .set('Idempotency-Key', newKey())
      .send({ direction: 'ADD', amountPaisa: 10000, reasonCode: 'OTHER', note: 'Suspended shop correction check' })
      .expect(201);
    expect(correction.body.entry).toBeDefined();
    // Step 5.
    await db.distributor.update({ where: { id: std.DA.id }, data: { status: 'ACTIVE' } });
    expect(await debits()).toEqual([]);
    expect(await f.balance()).toBe(710_000n);
    await f.expectWalletsConsistent();
  });

  it('FEE-005 the same Idempotency-Key places one order and deducts once', async () => {
    const { std, db } = f;
    const nextBefore = (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo;
    const K = newKey();
    // Step 1.
    const first = await f.placeX1(K).expect(201);
    expect(await f.balance()).toBe(452_000n);
    // Step 2.
    const replay = await f.placeX1(K).expect(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect([replay.body.id, replay.body.shortCode]).toEqual([first.body.id, first.body.shortCode]);
    expect(await f.balance()).toBe(452_000n);
    // Step 3.
    const conflict = await f.placeX1(K, { lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 3, expectedReturnCount: 3 }] }).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    // Step 4.
    const K2 = newKey();
    const [a, b] = await together(f.placeX1(K2), f.placeX1(K2));
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await f.balance()).toBe(404_000n);
    // Step 5.
    for (const key of [K, K2]) expect(await db.order.count({ where: { clientRequestId: key } })).toBe(1);
    const orders = await db.order.findMany({ orderBy: { orderNo: 'asc' } });
    expect(orders).toHaveLength(2);
    for (const order of orders) {
      const rows = await debits(order.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].idempotencyKey).toBe(`order:${order.id}:debit`);
      expect(await f.audits('order.create', order.id)).toHaveLength(1);
    }
    const nextAfter = (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo;
    expect(nextAfter - nextBefore).toBe(2);
    expect((orders[1].orderNo ?? 0) - (orders[0].orderNo ?? 0)).toBe(1);
  });

  it('FEE-006 two orders at once with money for only one: one is placed, one is refused', async () => {
    const { std, db } = f;
    // Step 1.
    for (let round = 0; round < 20; round++) {
      await f.setBalance(std.DA, 48_000n);
      const [a, b] = await together(f.placeX1(newKey()), f.placeX1(newKey()));
      const refused = [a, b].find((res) => res.status === 409);
      expect({ round, statuses: [a.status, b.status].sort() }).toEqual({ round, statuses: [201, 409] });
      expect(refused?.body).toMatchObject({
        code: 'WALLET_INSUFFICIENT_BALANCE',
        details: { requiredPaisa: '48000', balancePaisa: '0', shortByPaisa: '48000' },
      });
      expect(await f.balance()).toBe(0n);
    }
    expect(await db.order.count()).toBe(20);
    expect(await debits()).toHaveLength(20);
    // Step 2.
    await f.setBalance(std.DA, 96_000n);
    const both = await together(f.placeX1(newKey()), f.placeX1(newKey()));
    expect(both.map((res) => res.status)).toEqual([201, 201]);
    expect(await f.balance()).toBe(0n);
    // Step 3.
    await f.setBalance(std.DA, 200_000n);
    const ten = await together(...Array.from({ length: 10 }, () => f.placeX2(newKey())));
    expect(ten.filter((res) => res.status === 201)).toHaveLength(5);
    expect(ten.filter((res) => res.status === 409 && res.body.code === 'WALLET_INSUFFICIENT_BALANCE')).toHaveLength(5);
    expect(await f.balance()).toBe(0n);
    await f.expectWalletsConsistent();
  });

  it('FEE-009 X3: the distributor cancels before the first load scan and gets Rs 480 back', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const { tripId } = await f.assign(x1.id, std.DR1);
    // Step 1.
    const read = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(read.body.cancel).toEqual({ allowed: true, refundPaisa: '48000', noRefundReason: null });
    expect(read.body.allowedActions).toContain('CANCEL');
    // Step 2.
    const res = await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '48000' }).set('Idempotency-Key', newKey()).expect(200);
    expect(res.body).toMatchObject({
      order: { status: 'CANCELLED', stage: 'CANCELLED', fee: { status: 'REVERSED', totalPaisa: '48000' }, paymentStatus: 'UNPAID', cancelReasonCode: 'CUSTOMER_CANCELLED' },
      refundedPaisa: '48000',
    });
    // Step 3.
    expect(await f.balance()).toBe(500_000n);
    const back = await reversals(x1.id);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ amountPaisa: 48_000n, idempotencyKey: `order:${x1.id}:reversal`, balanceAfterPaisa: 500_000n });
    const stops = await f.stops(tripId);
    expect(stops.find((stop) => stop.stopType === 'DELIVERY')?.status).toBe('CANCELLED');
    expect((await f.trip(tripId)).status).toBe('ABORTED');
    const audits = await f.audits('order.cancel', x1.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.DA.userId, reason: 'CUSTOMER_CANCELLED' });
    expect(audits[0].diff).toMatchObject({ refunded: true, refundPaisa: '48000', startedRule: 'FIRST_LOAD_SCAN' });
    await f.expectWalletsConsistent();
  });

  it('FEE-010 a repeated or simultaneous cancel returns the cost only once', async () => {
    const { std } = f;
    // Step 1.
    const one = await f.x1();
    const key = newKey();
    await f.cancel(one.id, { reasonCode: 'CUSTOMER_CANCELLED' }).set('Idempotency-Key', key).expect(200);
    for (const k of [key, newKey()]) {
      const again = await f.cancel(one.id, { reasonCode: 'CUSTOMER_CANCELLED' }).set('Idempotency-Key', k).expect(200);
      expect(again.headers['x-already-applied']).toBe('true');
      expect(again.body).toMatchObject({ order: { status: 'CANCELLED' }, refundedPaisa: '48000' });
    }
    expect(await f.balance()).toBe(500_000n);
    // Step 2.
    const two = await f.x1();
    const [shop, office] = await together(
      f.cancel(two.id, { reasonCode: 'CUSTOMER_CANCELLED' }),
      f.cancel(two.id, { reasonCode: 'WRONG_ORDER', note: 'Office test cancel' }, std.SA1),
    );
    expect([shop.status, office.status]).toEqual([200, 200]);
    expect([shop, office].filter((res) => res.headers['x-already-applied'] === 'true')).toHaveLength(1);
    expect(await f.balance()).toBe(500_000n);
    // Step 3.
    const three = await f.x1();
    const pair = await together(
      f.cancel(three.id, { reasonCode: 'CUSTOMER_CANCELLED' }).set('Idempotency-Key', newKey()),
      f.cancel(three.id, { reasonCode: 'CUSTOMER_CANCELLED' }).set('Idempotency-Key', newKey()),
    );
    expect(pair.map((res) => res.status)).toEqual([200, 200]);
    expect(pair.filter((res) => res.headers['x-already-applied'] === 'true')).toHaveLength(1);
    expect(await f.balance()).toBe(500_000n);
    // Step 4.
    for (const order of [one, two, three]) {
      expect(await reversals(order.id)).toHaveLength(1);
      expect(await f.audits('order.cancel', order.id)).toHaveLength(1);
    }
    await f.expectWalletsConsistent();
  });

  it('FEE-011 the office cancels before delivery started, with a required note, and the cost is returned', async () => {
    const { std } = f;
    const x2 = await f.x2();
    await f.assign(x2.id, std.DR2);
    // Steps 1 and 2.
    for (const body of [{ reasonCode: 'WRONG_ORDER' }, { reasonCode: 'WRONG_ORDER', note: 'abcd' }]) {
      const res = await f.cancel(x2.id, body, std.SA1).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.fields).toEqual([expect.objectContaining({ path: 'note' })]);
    }
    expect((await f.order(x2.id)).status).toBe('ASSIGNED');
    // Step 3.
    const res = await f.cancel(x2.id, { reasonCode: 'WRONG_ORDER', note: 'Shop phoned: wrong customer', confirmRefundPaisa: '40000' }, std.SA1).expect(200);
    expect(res.body.refundedPaisa).toBe('40000');
    expect(await f.balance()).toBe(500_000n);
    expect(await reversals(x2.id)).toHaveLength(1);
    const audit = (await f.audits('order.cancel', x2.id))[0];
    expect(audit.actorUserId).toBe(std.SA1.id);
    expect(audit.diff).toMatchObject({ note: 'Shop phoned: wrong customer', refunded: true });
  });

  it('FEE-011 the shop statement shows the returned cost against the order', async () => {
    const x2 = await f.x2();
    await f.cancel(x2.id, { reasonCode: 'WRONG_ORDER', note: 'Shop phoned: wrong customer' }, f.std.SA1).expect(200);
    const statement = await f.as(f.std.DA).get('/wallet/statement').expect(200);
    expect(statement.body.items[0]).toMatchObject({ kind: 'DELIVERY_COST_RETURNED', amountPaisa: '40000', subject: { shortCode: x2.shortCode } });
  });

  it('FEE-012 cancel is refused for other distributors, drivers and bad reasons, and nothing is returned', async () => {
    const { std } = f;
    const x1 = await f.x1();
    await f.assign(x1.id, std.DR1);
    // Step 1.
    expect((await f.as(std.DB).get(`/orders/${x1.id}`).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }, std.DB).expect(404)).body.code).toBe('NOT_FOUND');
    // Step 2.
    expect((await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }, std.DR1).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 3.
    for (const body of [{ reasonCode: 'CHANGED_MIND' }, { reasonCode: 'OTHER' }]) {
      expect((await f.cancel(x1.id, body).expect(400)).body.code).toBe('VALIDATION_FAILED');
    }
    const row = await f.order(x1.id);
    expect([row.status, row.feeStatus]).toEqual(['ASSIGNED', 'DEDUCTED']);
    expect(await f.balance()).toBe(452_000n);
    expect(await reversals()).toEqual([]);
    expect(await f.audits('order.cancel')).toEqual([]);
  });

  it('FEE-013 X3: a cancel after the first load scan is allowed but returns nothing', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const { tripId } = await f.assign(x1.id, std.DR1);
    // Step 1.
    await f.loadScan(std.DR1, tripId, 'AG-C0005').expect(201);
    const loaded = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(loaded.body.loadStartedAt).not.toBeNull();
    expect(loaded.body.stage).toBe('LOADING');
    // Step 2.
    for (const who of [std.DA, std.SA1]) {
      const res = await f.as(who).get(`/orders/${x1.id}`).expect(200);
      expect(res.body.cancel).toEqual({ allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' });
    }
    // Step 3.
    const res = await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '0' }).expect(200);
    expect(res.body.refundedPaisa).toBe('0');
    expect(res.body.order).toMatchObject({ status: 'CANCELLED', fee: { status: 'DEDUCTED' } });
    expect(await f.balance()).toBe(452_000n);
    expect(await reversals()).toEqual([]);
    expect((await f.audits('order.cancel', x1.id))[0].diff).toMatchObject({ refunded: false, refundPaisa: '0', startedRule: 'FIRST_LOAD_SCAN' });
    expect((await f.trip(tripId)).status).not.toBe('ABORTED');
    const cylinder = await f.cylinder('AG-C0005');
    expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
  });

  it('FEE-014 if the refund changed while the user was looking, the cancel asks again', async () => {
    const { std } = f;
    const O1 = await f.x1();
    const t1 = await f.assign(O1.id, std.DR1);
    const O2 = await f.x1();
    await f.assign(O2.id, std.DR2);
    // Step 1.
    await f.loadScan(std.DR1, t1.tripId, 'AG-C0005').expect(201);
    const balance = await f.balance();
    // Step 2.
    const changed = await f.cancel(O1.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '48000' }).expect(409);
    expect(changed.body).toMatchObject({
      code: 'ORDER_CANCEL_TERMS_CHANGED',
      details: { refundPaisa: '0' },
      message: 'Delivery has just started. The refund is now Rs 0.',
    });
    expect((await f.order(O1.id)).status).toBe('ASSIGNED');
    expect(await f.balance()).toBe(balance);
    // Step 3.
    expect((await f.cancel(O1.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '0' }).expect(200)).body.refundedPaisa).toBe('0');
    // Step 4.
    const other = await f.cancel(O2.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '0' }).expect(409);
    expect(other.body).toMatchObject({ code: 'ORDER_CANCEL_TERMS_CHANGED', details: { refundPaisa: '48000' } });
    expect((await f.order(O2.id)).status).toBe('ASSIGNED');
  });

  it('FEE-015 a cancel racing the first load scan never gives both a refund and a load', async () => {
    const { std } = f;
    await f.setBalance(std.DA, 30n * 48_000n);
    const codes = await f.extraCylinders(30, std.sizes.kg11_8, 'RACE');
    let refunds = 0;
    let loads = 0;
    for (let round = 0; round < 30; round++) {
      const x1 = await f.x1();
      const { tripId } = await f.assign(x1.id, std.DR1);
      const [cancel, scan] = await together(f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }), f.loadScan(std.DR1, tripId, codes[round]));
      expect({ round, cancel: cancel.status }).toEqual({ round, cancel: 200 });
      const order = await f.order(x1.id);
      const cylinder = await f.cylinder(codes[round]);
      if (cancel.body.refundedPaisa === '48000') {
        refunds += 1;
        expect({ round, scan: scan.status }).toEqual({ round, scan: 409 });
        expect(typeof scan.body.code).toBe('string');
        expect(cylinder.custodyType).toBe('STORE');
        expect(order.loadStartedAt).toBeNull();
      } else {
        loads += 1;
        expect({ round, refunded: cancel.body.refundedPaisa, scan: scan.status }).toEqual({ round, refunded: '0', scan: 201 });
        expect(order.loadStartedAt).not.toBeNull();
        expect(cylinder.custodyType).toBe('VEHICLE');
      }
      expect((await reversals(x1.id)).length).toBeLessThanOrEqual(1);
    }
    expect(refunds + loads).toBe(30);
    await f.expectWalletsConsistent();
  });

  it('FEE-016 after the first hand-over nobody can cancel, and a delivered or failed order cannot be cancelled', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const x2 = await f.x2();
    const t1 = (await f.assign(x1.id, std.DR1)).tripId;
    for (const code of ['AG-C0005', 'AG-C0006', 'AG-C0031']) await f.loadScan(std.DR1, t1, code).expect(201);
    const t2 = (await f.assign(x2.id, std.DR2)).tripId;
    await f.loadScan(std.DR2, t2, 'AG-C0021').expect(201);
    await f.fail(x2.id, { reasonCode: 'CUSTOMER_NOT_HOME' }, std.DR2).expect(200);
    expect(await f.balance()).toBe(412_000n);
    // Step 1.
    await f.as(std.DR1).post('/custody/scan').send({ qrCode: 'AG-C0005-QR', eventType: 'DELIVERED', tripId: t1, orderId: x1.id }).expect(201);
    // Step 2.
    for (const [who, body] of [
      [std.DA, { reasonCode: 'CUSTOMER_CANCELLED' }],
      [std.SA1, { reasonCode: 'OTHER', note: 'Office try after handover' }],
    ] as const) {
      const res = await f.cancel(x1.id, body, who).expect(409);
      expect(res.body).toMatchObject({ code: 'ORDER_HANDOVER_STARTED', message: 'Cylinders were already handed over. Call the office.' });
    }
    const read = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(read.body.cancel.allowed).toBe(false);
    expect(read.body.allowedActions).not.toContain('CANCEL');
    // Step 3. From Inc 2 the Delivered tap needs every cylinder handed over (API_CONTRACT §9.10).
    for (const code of ['AG-C0006', 'AG-C0031']) {
      await f.as(std.DR1).post('/custody/scan').send({ qrCode: `${code}-QR`, eventType: 'DELIVERED', tripId: t1, orderId: x1.id }).expect(201);
    }
    await f.as(std.DR1).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(200);
    const delivered = await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(409);
    expect(delivered.body).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE', message: 'This order is already finished.', details: { currentStatus: 'DELIVERED' } });
    const failed = await f.cancel(x2.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(409);
    expect(failed.body).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE', details: { currentStatus: 'FAILED' } });
    expect(await f.balance()).toBe(412_000n);
    expect(await reversals()).toEqual([]);
    expect(await f.audits('order.cancel')).toEqual([]);
  });

  it('FEE-019 assigning, reassigning and delivering move no money; only placement did', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const x2 = await f.x2();
    expect(await f.balance()).toBe(412_000n);
    // Step 1.
    const first = await f.assign(x1.id, std.DR1);
    const second = await f.assign(x1.id, std.DR2);
    expect(second.reassignedFromTripId).toBe(first.tripId);
    expect(await f.audits('order.assign', x1.id)).toHaveLength(1);
    expect(await f.audits('order.reassign', x1.id)).toHaveLength(1);
    expect((await f.trip(first.tripId)).status).toBe('ABORTED');
    expect((await f.stops(first.tripId)).every((stop) => stop.status === 'CANCELLED')).toBe(true);
    expect(await f.balance()).toBe(412_000n);
    // Step 2.
    await f.as(std.DR2).patch(`/trips/${second.tripId}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    for (const code of ['AG-C0005', 'AG-C0006', 'AG-C0031']) await f.loadScan(std.DR2, second.tripId, code).expect(201);
    for (const code of ['AG-C0005', 'AG-C0006', 'AG-C0031']) {
      await f.as(std.DR2).post('/custody/scan').send({ qrCode: `${code}-QR`, eventType: 'DELIVERED', tripId: second.tripId, orderId: x1.id }).expect(201);
    }
    const tap = await f.as(std.DR2).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(200);
    // From Inc 2 the tap is the visit finish with matching scans (API_CONTRACT §9.10).
    expect(tap.body.deliveryMethod).toBe('SCANNED');
    expect((await f.as(std.DR2).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(200)).headers['x-already-applied']).toBe('true');
    expect(await f.balance()).toBe(412_000n);
    // Step 3.
    await f.assign(x2.id, std.DR1);
    expect((await f.as(std.SA1).post(`/orders/${x2.id}/manual-delivery`).send({ reason: 'Too short' }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    // Manual delivery v2 names the cylinders (API_CONTRACT §9.5): X2's three 15 kg, from the home store, by
    // their QR values (the Inc 1 standard data registers no cylinder numbers).
    const cylinders = ['AG-C0021', 'AG-C0022', 'AG-C0023'].map((code) => ({ code: `${code}-QR` }));
    const manual = await f.as(std.SA1).post(`/orders/${x2.id}/manual-delivery`).send({ reason: 'Driver phone broken at the door', cylinders }).expect(200);
    expect(manual.body).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'MANUAL' });
    expect(await f.audits('order.manual_delivery', x2.id)).toHaveLength(1);
    // Step 4.
    expect(await f.balance()).toBe(412_000n);
    const money = await f.ledger({ distributorId: std.DA.id, entryType: { not: 'ADJUSTMENT' } });
    expect(money.map((row) => row.entryType)).toEqual(['DEBIT_ORDER', 'DEBIT_ORDER']);
    for (const order of [x1, x2]) expect((await f.order(order.id)).feeStatus).toBe('DEDUCTED');
  });

  it('FEE-020 could not deliver moves no money and is allowed only after the start', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const t1 = (await f.assign(x1.id, std.DR1)).tripId;
    const x2 = await f.x2();
    const t2 = (await f.assign(x2.id, std.DR2)).tripId;
    // Step 1.
    for (const [who, body] of [
      [std.DR1, { reasonCode: 'CUSTOMER_REFUSED' }],
      [std.SA1, { reasonCode: 'CUSTOMER_REFUSED', note: 'Customer refused at gate' }],
    ] as const) {
      const res = await f.fail(x1.id, body, who).expect(409);
      expect(res.body).toMatchObject({ code: 'ORDER_NOT_STARTED_USE_CANCEL', message: "Delivery hasn't started. Cancel the order instead." });
    }
    // Step 2. From Inc 2 the depart is "Done loading": everything X1 needs is loaded first (API_CONTRACT §9.10).
    for (const code of ['AG-C0005', 'AG-C0006', 'AG-C0031']) await f.loadScan(std.DR1, t1, code).expect(201);
    const storeStop = (await f.stops(t1)).find((stop) => stop.stopType === 'STORE_PICKUP');
    await f.as(std.DR1).patch(`/trips/stops/${storeStop?.id}/depart`).expect(200);
    // Step 3.
    expect((await f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }, std.DR2).expect(404)).body.code).toBe('NOT_FOUND');
    // Step 4.
    const failed = await f.fail(x1.id, { reasonCode: 'CUSTOMER_REFUSED' }, std.DR1).expect(200);
    expect(failed.body).toMatchObject({ status: 'FAILED', stage: 'NOT_DELIVERED', failureReasonCode: 'CUSTOMER_REFUSED' });
    expect((await f.stops(t1)).find((stop) => stop.stopType === 'DELIVERY')?.status).toBe('FAILED');
    expect(await f.audits('order.fail', x1.id)).toHaveLength(1);
    expect((await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(409)).body.code).toBe('ORDER_NOT_CANCELLABLE');
    // Step 5.
    await f.loadScan(std.DR2, t2, 'AG-C0021').expect(201);
    expect((await f.fail(x2.id, { reasonCode: 'OTHER' }, std.SA1).expect(400)).body.code).toBe('VALIDATION_FAILED');
    expect((await f.fail(x2.id, { reasonCode: 'OTHER', note: 'Gate locked, customer away' }, std.SA1).expect(200)).body.status).toBe('FAILED');
    expect(await f.balance()).toBe(412_000n);
    expect(await reversals()).toEqual([]);
    for (const order of [x1, x2]) expect((await f.order(order.id)).feeStatus).toBe('DEDUCTED');
  });

  it('FEE-021 the default refund cut-off (FIRST_LOAD_SCAN): what does and does not count as delivery started', async () => {
    const { std } = f;
    type Scenario = { name: string; act: (tripId: string, orderId: string) => PromiseLike<unknown>; refunded: boolean };
    const stopOf = async (tripId: string, type: 'STORE_PICKUP' | 'DELIVERY') => (await f.stops(tripId)).find((stop) => stop.stopType === type)?.id;
    const scenarios: Scenario[] = [
      { name: 'no driver action', act: async () => undefined, refunded: true },
      { name: 'trip started', act: (tripId) => f.as(std.DR1).patch(`/trips/${tripId}/status`).send({ status: 'IN_PROGRESS' }).expect(200), refunded: true },
      {
        name: 'arrived at the store',
        act: async (tripId) => f.as(std.DR1).patch(`/trips/stops/${await stopOf(tripId, 'STORE_PICKUP')}/arrive`).expect(200),
        refunded: true,
      },
      { name: 'one load scan', act: (tripId) => f.loadScan(std.DR1, tripId, 'AG-C0007').expect(201), refunded: false },
      {
        name: 'store stop departed',
        // From Inc 2 the depart is "Done loading": everything X1 needs is loaded first (API_CONTRACT §9.10).
        act: async (tripId) => {
          for (const code of ['AG-C0011', 'AG-C0012', 'AG-C0032']) await f.loadScan(std.DR1, tripId, code).expect(201);
          return f.as(std.DR1).patch(`/trips/stops/${await stopOf(tripId, 'STORE_PICKUP')}/depart`).expect(200);
        },
        refunded: false,
      },
      {
        name: 'arrived at the customer',
        act: async (tripId) => f.as(std.DR1).patch(`/trips/stops/${await stopOf(tripId, 'DELIVERY')}/arrive`).expect(200),
        refunded: false,
      },
    ];
    for (const scenario of scenarios) {
      const x1 = await f.x1();
      const { tripId } = await f.assign(x1.id, std.DR1);
      await scenario.act(tripId, x1.id);
      const read = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
      const res = await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
      if (scenario.refunded) {
        expect({ name: scenario.name, refund: read.body.cancel.refundPaisa, refunded: res.body.refundedPaisa }).toEqual({
          name: scenario.name,
          refund: '48000',
          refunded: '48000',
        });
        expect(await reversals(x1.id)).toHaveLength(1);
      } else {
        expect({ name: scenario.name, cancel: read.body.cancel, refunded: res.body.refundedPaisa }).toEqual({
          name: scenario.name,
          cancel: { allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' },
          refunded: '0',
        });
        expect(await reversals(x1.id)).toHaveLength(0);
      }
      expect((await f.audits('order.cancel', x1.id))[0].diff).toMatchObject({ startedRule: 'FIRST_LOAD_SCAN' });
    }
    await f.expectWalletsConsistent();
  });

  it('FEE-022 orders.deliveryStartedAt = DRIVER_ASSIGNED or LEFT_STORE moves the refund cut-off', async () => {
    const { std } = f;
    const office = f.as(std.SA1);
    const setRule = async (value: string) => {
      await office.patch('/settings/orders.deliveryStartedAt').send({ value, reason: `Refund rule test ${value}` }).expect(200);
      expect((await http(app).get(`${API}/app/config`).expect(200)).body.orders.deliveryStartedAt).toBe(value);
    };
    const refundOf = async (orderId: string) => (await f.cancel(orderId, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200)).body;
    const loadOnTrip = async (orderId: string, code: string) => {
      const { tripId } = await f.assign(orderId, std.DR1);
      await f.loadScan(std.DR1, tripId, code).expect(201);
      return tripId;
    };
    // Step 1.
    const bad = await office.patch('/settings/orders.deliveryStartedAt').send({ value: 'ON_DELIVERY', reason: 'bad value test' }).expect(400);
    expect(bad.body.code).toBe('SETTING_INVALID_VALUE');
    // Step 2.
    await setRule('DRIVER_ASSIGNED');
    const A = await f.x1();
    expect((await refundOf(A.id)).refundedPaisa).toBe('48000');
    const B = await f.x1();
    await f.assign(B.id, std.DR1);
    expect((await f.as(std.DA).get(`/orders/${B.id}`).expect(200)).body.cancel).toMatchObject({ refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' });
    expect((await refundOf(B.id)).refundedPaisa).toBe('0');
    // Step 3.
    await setRule('LEFT_STORE');
    const C = await f.x1();
    await loadOnTrip(C.id, 'AG-C0008');
    expect((await refundOf(C.id)).refundedPaisa).toBe('48000');
    const D = await f.x1();
    await loadOnTrip(D.id, 'AG-C0009');
    expect((await f.fail(D.id, { reasonCode: 'CUSTOMER_REFUSED' }, std.DR1).expect(409)).body.code).toBe('ORDER_NOT_STARTED_USE_CANCEL');
    const E = await f.x1();
    const eTrip = await loadOnTrip(E.id, 'AG-C0010');
    // From Inc 2 the depart is "Done loading": the rest of what E needs is loaded first (API_CONTRACT §9.10).
    for (const code of ['AG-C0011', 'AG-C0031']) await f.loadScan(std.DR1, eTrip, code).expect(201);
    const store = (await f.stops(eTrip)).find((stop) => stop.stopType === 'STORE_PICKUP');
    await f.as(std.DR1).patch(`/trips/stops/${store?.id}/depart`).expect(200);
    expect((await refundOf(E.id)).refundedPaisa).toBe('0');
    // Step 4.
    await setRule('FIRST_LOAD_SCAN');
    const F = await f.x1();
    await f.assign(F.id, std.DR1);
    await setRule('DRIVER_ASSIGNED');
    expect((await refundOf(F.id)).refundedPaisa).toBe('0');
    expect((await f.audits('order.cancel', F.id))[0].diff).toMatchObject({ startedRule: 'DRIVER_ASSIGNED' });
    await setRule('FIRST_LOAD_SCAN');
    // Step 5.
    const changes = await f.audits('setting.update');
    expect(changes.length).toBeGreaterThanOrEqual(5);
    for (const row of changes) {
      expect(row.diff).toMatchObject({ key: 'orders.deliveryStartedAt', from: expect.any(String), to: expect.any(String) });
      expect(row.reason).toEqual(expect.stringContaining('Refund rule test'));
    }
    await f.expectWalletsConsistent();
  });

  /** 02:30 on the current business day's date: still the business day before (cut-off 03:00). */
  const beforeTheCutoff = () => {
    const options = { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' };
    const today = businessDayRange(businessDate(new Date(), options), options);
    return new Date(today.start.getTime() - 30 * 60_000);
  };

  /** Top-ups approved today (Rs 5,000 and Rs 2,000) and one at 02:30 (Rs 1,000, the day before). */
  const seedApprovedTopups = async () => {
    const approved = (amount: bigint, at: Date, n: number) =>
      f.db.payment.create({
        data: {
          distributorId: f.std.DA.id,
          requestNo: 100 + n,
          amountPaisa: amount,
          bankAmountPaisa: amount,
          provider: 'BANK_MANUAL',
          status: 'SUCCESS',
          completedAt: at,
          bankReference: `FT-${n}`,
          bankReferenceKey: `FT${n}TEST`,
        },
      });
    await approved(500_000n, new Date(), 1);
    await approved(200_000n, new Date(), 2);
    await approved(100_000n, beforeTheCutoff(), 3);
  };

  it('FEE-024 delivery costs taken today = costs deducted minus costs returned, by the business day', async () => {
    const { std, db } = f;
    // Today: X1 (Rs 480), X2 (Rs 400), X1 cancelled before loading (Rs 480 back).
    const x1 = await f.x1();
    await f.x2();
    await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    // Seeded the day before: a Rs 400 deduction at 02:30.
    await db.ledgerEntry.create({
      data: {
        distributorId: std.DA.id,
        entryType: 'DEBIT_ORDER',
        amountPaisa: -40_000n,
        balanceAfterPaisa: 0n,
        idempotencyKey: `test-earlier-debit:${std.DA.id}`,
        createdAt: beforeTheCutoff(),
      },
    });
    await seedApprovedTopups();
    // Step 1.
    const summary = await f.as(std.SA1).get('/admin/summary').expect(200);
    expect(summary.body.orders.costTakenTodayPaisa).toBe('40000');
    expect(summary.body.topups.approvedToday).toEqual({ count: 2, totalPaisa: '700000' });
  });

  it('FEE-024 the top-up list shows the same approved-today figure', async () => {
    await seedApprovedTopups();
    // Step 2.
    const topups = await f.as(f.std.SA1).get('/admin/topups?tab=to-check').expect(200);
    expect(topups.body.approvedToday).toEqual({ count: 2, totalPaisa: '700000' });
    const summary = await f.as(f.std.SA1).get('/admin/summary').expect(200);
    expect(summary.body.topups.approvedToday).toEqual(topups.body.approvedToday);
  });

  it('FEE-026 after loading, a cancel and a could-not-deliver at the same moment: one wins and no money moves', async () => {
    const { std } = f;
    await f.setBalance(std.DA, 20n * 48_000n);
    const codes = await f.extraCylinders(20, std.sizes.kg11_8, 'DUEL');
    for (let round = 0; round < 20; round++) {
      const x1 = await f.x1();
      const { tripId } = await f.assign(x1.id, std.DR1);
      await f.loadScan(std.DR1, tripId, codes[round]).expect(201);
      const [cancel, fail] = await together(
        f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '0' }),
        f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }, std.DR1),
      );
      const ok = [cancel, fail].filter((res) => res.status === 200);
      expect({ round, ok: ok.length }).toEqual({ round, ok: 1 });
      const order = await f.order(x1.id);
      if (cancel.status === 200) {
        expect(cancel.body.refundedPaisa).toBe('0');
        expect(fail.body).toMatchObject({ code: 'ORDER_INVALID_TRANSITION', details: { from: 'CANCELLED', to: 'FAILED', currentStatus: 'CANCELLED' } });
        expect(order.status).toBe('CANCELLED');
      } else {
        expect(cancel.body).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE', details: { currentStatus: 'FAILED' } });
        expect(order.status).toBe('FAILED');
      }
      expect((await f.audits('order.cancel', x1.id)).length + (await f.audits('order.fail', x1.id)).length).toBe(1);
    }
    expect(await reversals()).toEqual([]);
    expect(await f.balance()).toBe(0n);
    await f.expectWalletsConsistent();
  });

  it('FEE-005 a retry keeps answering with the first order even after the price changes', async () => {
    const { std } = f;
    const K = newKey();
    const first = await f.placeX1(K).expect(201);
    await f.as(std.SA1).put(`/pricing/prices/${std.DA.id}/${std.zones.North.id}`).send({ basePaisa: 30000 }).expect(200);
    const replay = await f.as(std.DA).post('/orders').set('Idempotency-Key', K).send(x1OrderBody(std)).expect(200);
    expect(replay.body).toMatchObject({ id: first.body.id, fee: { totalPaisa: '48000' } });
  });
});
