/**
 * [Inc 2] The office's manual delivery naming the cylinders: the forgotten-IN rule (ADR-13, API_CONTRACT
 * §9.5, G06-08, G06-09): HLD-004 to HLD-006, plus the Inc 2 forms of ORD-015 and ORD-019.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { registerCylinders } from '../../helpers/runs';
import { buildWorld, X1, X2, type World } from './support/world';

jest.setTimeout(240_000);

const REASON = "Not scanned IN at the store; driver's phone died";

describeDb('inc2 scan: the office names the cylinders of a manual delivery', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('HLD-004 Forgotten IN: the office\'s manual delivery names the cylinders and moves them to the customer', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 31]);
    const body = {
      reason: REASON,
      cylinders: [{ code: 'AG-C0001' }, { code: 'AG-C0002' }, { code: 'AG-C0031' }],
      takenBack: [{ code: 'AG-C0011', returnState: 'EMPTY' as const }],
    };
    const res = await scans.manualDelivery(std.SA1, x1.id, body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'MANUAL' });
    const order = await w.db.order.findUniqueOrThrow({ where: { id: x1.id } });
    expect(order.manualDeliveryReason).toBe(REASON);

    for (const n of [1, 2, 31]) expect(await w.holder(n)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    const delivered = await w.db.cylinderEvent.findMany({ where: { orderId: x1.id, eventType: 'DELIVERED' } });
    expect(delivered).toHaveLength(3);
    const from = Object.fromEntries(delivered.map((e) => [e.cylinderId, e.fromCustodyType]));
    expect(from[w.ag(1).id]).toBe('VEHICLE');
    expect(from[w.ag(31).id]).toBe('VEHICLE');
    expect(from[w.ag(2).id]).toBe('STORE');
    for (const event of delivered) expect(event).toMatchObject({ source: 'MANUAL', actorUserId: std.SA1.id, reason: REASON });
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId, state: 'EMPTY' });
    const back = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(11).id, eventType: 'PICKED_UP_EMPTY' } });
    expect(back).toMatchObject({ source: 'MANUAL', tripId: t1.id, actorUserId: std.SA1.id, reason: REASON });
    const sana = await t1.stopFor(x1.id);
    expect(await w.db.stopCylinder.findFirstOrThrow({ where: { tripStopId: sana, cylinderId: w.ag(11).id } })).toMatchObject({
      direction: 'TAKEN_BACK',
      returnState: 'EMPTY',
    });
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: sana } })).status).toBe('DONE');

    const again = await scans.manualDelivery(std.SA1, x1.id, body);
    expect(again.status).toBe(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(await w.db.cylinderEvent.count({ where: { orderId: x1.id, source: 'MANUAL' } })).toBe(4);

    expect(await w.balance()).toBe(475_000n);
    expect(await w.db.ledgerEntry.count({ where: { orderId: x1.id } })).toBe(1);
    const audit = await w.db.auditLog.findMany({ where: { action: 'order.manual_delivery', resourceId: x1.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe(REASON);
    expect(audit[0].diff).toMatchObject({ cylinders: ['AG-C0001', 'AG-C0002', 'AG-C0031'], takenBack: [{ code: 'AG-C0011', returnState: 'EMPTY' }] });
    const moves = await w.db.auditLog.findMany({ where: { action: 'custody.manual_event' } });
    expect(moves).toHaveLength(4);
    for (const move of moves) {
      expect(move).toMatchObject({ resourceType: 'cylinder', reason: REASON, actorUserId: std.SA1.id });
      expect(move.diff).toMatchObject({ eventId: expect.any(String), orderId: x1.id, from: expect.any(Object), to: expect.any(Object) });
    }
    await w.walletClean();
  });

  it('HLD-005 Manual delivery refuses cylinders that don\'t match the order exactly, and moves nothing', async () => {
    const { std, scans } = w;
    await w.withCustomer(14, 'C2');
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    const ask = (codes: string[], reason = REASON) => scans.manualDelivery(std.SA1, x1.id, { reason, cylinders: codes.map((code) => ({ code })) });

    const short = await ask(['AG-C0001', 'AG-C0002', 'AG-C0031'], 'Too short');
    expect(short.status).toBe(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');

    const two = await ask(['AG-C0001', 'AG-C0031']);
    expect(two.status).toBe(409);
    expect(two.body).toMatchObject({ code: 'MANUAL_DELIVERY_CYLINDERS_MISMATCH', message: "The cylinders don't match the order." });
    expect(two.body.details.problems).toEqual([]);
    expect(two.body.details.sizes).toEqual(expect.arrayContaining([{ cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', needed: 2, named: 1 }]));

    const wrongSize = await ask(['AG-C0001', 'AG-C0002', 'AG-C0021']);
    expect(wrongSize.status).toBe(409);
    expect(wrongSize.body.details.problems).toEqual([{ code: 'AG-C0021', reason: 'WRONG_SIZE' }]);
    expect(wrongSize.body.details.sizes).toEqual(expect.arrayContaining([{ cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg', needed: 1, named: 0 }]));

    const elsewhere = await ask(['AG-C0001', 'AG-C0014', 'AG-C0031']);
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.details.problems).toEqual([{ code: 'AG-C0014', reason: 'NOT_AVAILABLE', holderType: 'CLIENT' }]);

    const unknown = await ask(['AG-C0001', 'AG-C0002', 'AG-C0099']);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'SCAN_CYLINDER_UNKNOWN', details: { code: 'AG-C0099' } });

    expect((await w.db.order.findUniqueOrThrow({ where: { id: x1.id } })).status).not.toBe('DELIVERED');
    expect(await w.holder(14)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C2.id });
    expect(await w.holder(21)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    for (const n of [1, 2, 31]) expect(await w.holder(n)).toMatchObject({ custodyType: 'VEHICLE' });
    expect(await w.db.cylinderEvent.count({ where: { source: 'MANUAL' } })).toBe(0);
    expect(await w.db.auditLog.count({ where: { action: 'order.manual_delivery' } })).toBe(0);
  });

  it('HLD-006 Only the office can record a manual delivery', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    const body = { reason: REASON, cylinders: [{ code: 'AG-C0001' }, { code: 'AG-C0002' }, { code: 'AG-C0031' }] };
    for (const caller of [std.DA, std.DR1]) {
      const res = await scans.manualDelivery(caller, x1.id, body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    }
    for (const n of [1, 2, 31]) expect(await w.holder(n)).toMatchObject({ custodyType: 'VEHICLE' });
    const ops = await scans.manualDelivery(std.SA2, x1.id, body);
    expect(ops.status).toBe(200);
    expect(ops.body).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'MANUAL' });
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: 'order.manual_delivery', resourceId: x1.id } });
    expect(audit.actorUserId).toBe(std.SA2.id);
  });

  it('ORD-015 (Inc 2) The office can record a delivery with a reason and the named cylinders, only for an order with a driver', async () => {
    const { std, scans } = w;
    const o1 = await w.placeOrder([{ size: '11.8', full: 1 }]);
    await w.assign(o1, std.DR1);
    const o2 = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const o3 = await w.placeOrder([{ size: '11.8', full: 1 }], 'C2');
    const t3 = await w.assign(o3, std.DR2);
    await w.load(std.DR2, t3, [9]);
    await w.doneLoading(std.DR2, t3);
    await w.hand(std.DR2, t3, o3, [9]);
    expect((await w.finishVisit(std.DR2, t3, o3)).status).toBe(200);

    const tooShort = await scans.manualDelivery(std.SA1, o1.id, { reason: 'Too short', cylinders: [{ code: '1' }] });
    expect(tooShort.status).toBe(400);
    const body = { reason: 'Driver phone broke at the door', cylinders: [{ code: 'AG-C0001' }] };
    const first = await scans.manualDelivery(std.SA1, o1.id, body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'MANUAL' });
    const repeat = await scans.manualDelivery(std.SA1, o1.id, body);
    expect(repeat.status).toBe(200);
    expect(repeat.headers['x-already-applied']).toBe('true');

    const pending = await scans.manualDelivery(std.SA1, o2.id, { ...body, cylinders: [{ code: 'AG-C0002' }] });
    expect(pending.status).toBe(409);
    expect(pending.body).toMatchObject({ code: 'ORDER_INVALID_TRANSITION', details: { from: 'PENDING', to: 'DELIVERED' } });
    const byDriver = await scans.manualDelivery(std.SA1, o3.id, { ...body, cylinders: [{ code: 'AG-C0003' }] });
    expect(byDriver.status).toBe(409);
    expect(byDriver.body).toMatchObject({ code: 'ORDER_INVALID_TRANSITION', details: { currentStatus: 'DELIVERED' } });
    for (const caller of [std.DA, std.DR1]) expect((await scans.manualDelivery(caller, o1.id, body)).status).toBe(403);

    const audits = await w.as(std.SA1).get(`/audit-logs?action=order.manual_delivery&resourceId=${o1.id}`).expect(200);
    expect(audits.body.items).toHaveLength(1);
    expect(audits.body.items[0]).toMatchObject({ actor: { userId: std.SA1.id }, reason: body.reason });
  });

  it('ORD-019 (Inc 2) The office\'s manual delivery and the driver\'s visit finish at the same moment record one delivery', async () => {
    const { std, scans } = w;
    for (let round = 1; round <= 10; round += 1) {
      await w.topUp(400);
      const order = await w.placeOrder(X2, 'C2');
      const trip = await w.assign(order, std.DR1);
      const fifteen = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg15, count: 3, actor: std.SA1 });
      for (const cylinder of fifteen) {
        await scans.tripScan(std.DR1, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: cylinder.qrCode }).expect(201);
      }
      await w.doneLoading(std.DR1, trip);
      const usman = await trip.stopFor(order.id);
      for (const cylinder of fifteen) {
        await scans.tripScan(std.DR1, trip.id, { stopId: usman, action: 'HANDOVER', code: cylinder.qrCode }).expect(201);
      }
      const [office, driver] = await Promise.all([
        scans.manualDelivery(std.SA1, order.id, { reason: 'Driver phone broke at the door', cylinders: fifteen.map((c) => ({ code: c.shortCode })) }).then((r) => r),
        w.finishVisit(std.DR1, trip, order).then((r) => r),
      ]);
      const winners = [office, driver].filter((r) => r.status === 200 && !r.headers['x-already-applied']);
      expect({ round, winners: winners.length }).toEqual({ round, winners: 1 });
      const loser = office === winners[0] ? driver : office;
      expect({ round, status: loser.status, code: loser.body.code }).toEqual({ round, status: 409, code: 'ORDER_INVALID_TRANSITION' });
      const delivered = await w.db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(delivered.status).toBe('DELIVERED');
      expect(delivered.deliveryMethod).toBe(office === winners[0] ? 'MANUAL' : 'SCANNED');
      expect(await w.db.auditLog.count({ where: { action: 'order.manual_delivery', resourceId: order.id } })).toBe(office === winners[0] ? 1 : 0);
      await scans.finishTrip(std.DR1, trip.id, {}).expect(200);
    }
    await w.walletClean();
  });
});
