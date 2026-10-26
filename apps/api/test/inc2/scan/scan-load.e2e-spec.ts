/**
 * [Inc 2] Load at the store (API_CONTRACT §9.2 LOAD, §9.3 "Done loading"): DRV-010 to DRV-016.
 */
import type { INestApplication } from '@nestjs/common';
import { CylinderState } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, messageOf, X1, X2, type World } from './support/world';

jest.setTimeout(180_000);

describeDb('inc2 scan: load at the store', () => {
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

  it('DRV-010 Load moves a full cylinder from the store onto this trip\'s van and shows progress', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    expect(await w.balance()).toBe(475_000n);
    const t1 = await w.assign(x1, std.DR1);
    const sanaStop = await t1.stopFor(x1.id);

    // Step 1: each action only fits its own stop.
    const wrongLoad = await scans.tripScan(std.DR1, t1.id, { stopId: sanaStop, action: 'LOAD', code: w.ag(1).qrCode });
    expect(wrongLoad.status).toBe(403);
    expect(wrongLoad.body).toMatchObject({ code: 'SCAN_EVENT_NOT_ALLOWED', message: messageOf('SCAN_EVENT_NOT_ALLOWED') });
    const wrongHand = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'HANDOVER', code: w.ag(1).qrCode });
    expect(wrongHand.status).toBe(403);
    expect(wrongHand.body.code).toBe('SCAN_EVENT_NOT_ALLOWED');
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    expect(await w.eventCount(1)).toBe(1); // only its REGISTERED move

    // Step 2: the load.
    const res = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode, entryMethod: 'QR' }).expect(201);
    expect(res.body.result).toBe('RECORDED');
    expect(res.body.cylinder).toMatchObject({ shortCode: 'AG-C0001', size: { label: '11.8 kg' }, state: 'FULL', holder: { type: 'VEHICLE', label: 'LEA-101' } });
    expect(res.body.scan).toMatchObject({ action: 'LOAD', scanId: expect.any(String), at: expect.any(String) });
    expect(res.body.stop.type).toBe('STORE_PICKUP');
    expect(res.body.stop.progress).toEqual({
      type: 'STORE_PICKUP',
      lines: [
        { cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', needed: 2, done: 1 },
        { cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg', needed: 1, done: 0 },
      ],
      doneCount: 1,
      neededCount: 3,
      complete: false,
    });

    // Step 3: the first scan starts the trip.
    const trip = await scans.trip(std.DR1, t1.id).expect(200);
    expect(trip.body.status).toBe('IN_PROGRESS');

    // Step 4: delivery has started for X1 (the refund cut-off).
    const order = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body.loadStartedAt).toEqual(expect.any(String));
    expect(order.body.stage).toBe('LOADING');

    // Step 5: the move.
    const event = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: 'SCAN_OUT' } });
    expect(event).toMatchObject({
      actorUserId: std.DR1.userId,
      tripId: t1.id,
      tripStopId: t1.pickupStopId,
      source: 'SCAN',
      fromCustodyType: 'STORE',
      fromCustodyId: std.DA.homeStoreId,
      toCustodyType: 'VEHICLE',
      toCustodyId: std.DR1.vehicleId,
      fromState: 'FULL',
      toState: 'FULL',
    });
    const cylinder = await w.db.cylinder.findUniqueOrThrow({ where: { id: w.ag(1).id } });
    expect(cylinder.lastEventId).toBe(event.id);
    expect(await w.balance()).toBe(475_000n);
    await w.walletClean();
  });

  it('DRV-011 Load refuses a cylinder that isn\'t in this distributor\'s store: with a customer, on another van or in another shop\'s store', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const y1 = await w.placeOrder([{ size: '11.8', full: 1 }], 'C2');
    const t2 = await w.assign(y1, std.DR2);
    await w.load(std.DR2, t2, [3]);
    const bg3 = await w.bg(3);
    const before = await Promise.all([w.ag(11), w.ag(3)].map((c) => w.db.cylinderEvent.count({ where: { cylinderId: c.id } })));

    for (const n of [11, 3]) {
      const res = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(n).qrCode });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SCAN_NOT_AT_STORE');
      expect(res.body.message).toBe("This cylinder isn't in Ahmed Gas Store's stock. Load only from this store.");
      expect(res.body.details.progress).toMatchObject({ type: 'STORE_PICKUP', doneCount: 0, neededCount: 3 });
    }
    const other = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: bg3.qrCode });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ code: 'SCAN_WRONG_OWNER', message: 'This cylinder belongs to another shop.' });
    expect(other.body.details.progress).toMatchObject({ doneCount: 0, neededCount: 3 });

    expect(await w.holder(11)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    expect(await w.holder(3)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR2.vehicleId });
    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: bg3.id } })).toMatchObject({ custodyType: 'STORE', custodyId: std.DB.homeStoreId });
    const after = await Promise.all([w.ag(11), w.ag(3)].map((c) => w.db.cylinderEvent.count({ where: { cylinderId: c.id } })));
    expect(after).toEqual(before);
    expect(await w.db.cylinderEvent.count({ where: { cylinderId: bg3.id } })).toBe(1);
  });

  it('DRV-012 Load refuses cylinders that aren\'t full or are marked damaged or lost', async () => {
    const { std, scans } = w;
    await w.markState(20, CylinderState.EMPTY);
    await w.markState(19, CylinderState.PART_FILLED);
    await w.markState(18, CylinderState.FAULTY);
    await w.markState(17, CylinderState.LOST);
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const expected: Record<number, string> = { 20: 'SCAN_NOT_FULL', 19: 'SCAN_NOT_FULL', 18: 'SCAN_CYLINDER_BLOCKED', 17: 'SCAN_CYLINDER_BLOCKED' };
    for (const n of [20, 19, 18, 17]) {
      const res = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(n).qrCode });
      expect({ n, status: res.status, code: res.body.code }).toEqual({ n, status: 409, code: expected[n] });
      expect(res.body.message).toBe(messageOf(expected[n] as 'SCAN_NOT_FULL'));
    }
    const states = await Promise.all([20, 19, 18, 17].map((n) => w.holder(n)));
    expect(states.map((s) => [s.custodyType, s.state])).toEqual([
      ['STORE', 'EMPTY'],
      ['STORE', 'PART_FILLED'],
      ['STORE', 'FAULTY'],
      ['STORE', 'LOST'],
    ]);
    for (const n of [20, 19, 18, 17]) expect(await w.eventCount(n)).toBe(1);
    const order = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body.loadStartedAt).toBeNull();
    expect(order.body.cancel).toMatchObject({ allowed: true, refundPaisa: '25000' });
  });

  it('DRV-013 Load takes only sizes the trip\'s open orders still need', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const x2 = await w.placeOrder(X2, 'C2');
    expect(await w.balance()).toBe(435_000n);
    const t1 = await w.assign(x1, std.DR1);
    const joined = await w.assign(x2, std.DR1);
    expect(joined.id).toBe(t1.id);
    expect(await w.db.tripStop.count({ where: { tripId: t1.id } })).toBe(3);

    const cancel = await w.as(std.DA).post(`/orders/${x2.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    expect(cancel.body.refundedPaisa).toBe('40000');
    expect(await w.balance()).toBe(475_000n);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('PLANNED');

    const fifteen = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(21).qrCode });
    expect(fifteen.status).toBe(409);
    expect(fifteen.body).toMatchObject({ code: 'SCAN_LOAD_NOT_NEEDED', message: "This size isn't needed on this trip any more." });

    let last: { body: { stop: { progress: { lines: Array<{ sizeLabel: string; needed: number; done: number }>; neededCount: number } } } } | undefined;
    for (const n of [1, 2]) last = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(n).qrCode }).expect(201);
    expect(last?.body.stop.progress.lines.find((l) => l.sizeLabel === '11.8 kg')).toMatchObject({ needed: 2, done: 2 });
    expect(last?.body.stop.progress.neededCount).toBe(3);

    const third = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(3).qrCode });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('SCAN_LOAD_NOT_NEEDED');
    expect(await w.holder(3)).toMatchObject({ custodyType: 'STORE' });

    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(31).qrCode }).expect(201);
    await scans.finishStop(std.DR1, t1.id, t1.pickupStopId).expect(200);
    await w.walletClean();
  });

  it('DRV-014 The first Load marks every open order of the trip as started, so a later cancel returns nothing', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const x2 = await w.placeOrder(X2, 'C2');
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(x2, std.DR1);
    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);

    const view = await w.as(std.DA).get(`/orders/${x2.id}`).expect(200);
    expect(view.body.loadStartedAt).toEqual(expect.any(String));
    expect(view.body.cancel).toEqual({ allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' });

    const cancel = await w.as(std.DA).post(`/orders/${x2.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '0' }).expect(200);
    expect(cancel.body.refundedPaisa).toBe('0');
    expect(cancel.body.order.status).toBe('CANCELLED');
    const usmanStop = await t1.stopFor(x2.id);
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: usmanStop } })).status).toBe('CANCELLED');
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('IN_PROGRESS');

    expect(await w.balance()).toBe(435_000n);
    expect(await w.db.ledgerEntry.count({ where: { orderId: x2.id, entryType: 'CREDIT_ORDER_REVERSAL' } })).toBe(0);
    const audits = await w.db.auditLog.findMany({ where: { action: 'order.cancel', resourceId: x2.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].diff).toMatchObject({ refunded: false, refundPaisa: '0', startedRule: 'FIRST_LOAD_SCAN' });
    await w.walletClean();
  });

  it('DRV-015 A cancel racing the first Load gives a refund or a load, never both', async () => {
    const { std, scans } = w;
    const outcomes = { cancelWon: 0, loadWon: 0 };
    for (let round = 1; round <= 20; round += 1) {
      await w.topUp(480);
      const x1 = await w.placeOrder(X1);
      const t1 = await w.assign(x1, std.DR1);
      const cylinder = w.ag(round);
      const before = await w.balance();
      const [cancel, load] = await Promise.all([
        w.as(std.DA).post(`/orders/${x1.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).then((r) => r),
        scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: cylinder.qrCode }).then((r) => r),
      ]);
      expect(cancel.status).toBe(200);
      const holder = await w.holder(round);
      const reversals = await w.db.ledgerEntry.count({ where: { orderId: x1.id, entryType: 'CREDIT_ORDER_REVERSAL' } });
      const order = await w.db.order.findUniqueOrThrow({ where: { id: x1.id } });
      if (cancel.body.refundedPaisa === '25000') {
        outcomes.cancelWon += 1;
        expect({ round, load: load.status, code: load.body.code }).toEqual({ round, load: 409, code: 'SCAN_TRIP_CLOSED' });
        expect(holder.custodyType).toBe('STORE');
        expect(reversals).toBe(1);
        expect(await w.balance()).toBe(before + 25_000n);
      } else {
        outcomes.loadWon += 1;
        expect({ round, load: load.status, refunded: cancel.body.refundedPaisa }).toEqual({ round, load: 201, refunded: '0' });
        expect(holder).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
        expect(order.loadStartedAt).not.toBeNull();
        expect(reversals).toBe(0);
        expect(await w.balance()).toBe(before);
      }
      // Never a refund together with the cylinder on the van.
      expect(cancel.body.refundedPaisa === '25000' && holder.custodyType === 'VEHICLE').toBe(false);
      await w.walletClean();
    }
    expect(outcomes.cancelWon + outcomes.loadWon).toBe(20);
  });

  it('DRV-016 "Done loading" needs every cylinder loaded, then the order is on the way', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2]);

    const early = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'LOAD_INCOMPLETE', message: 'Load every cylinder first: 2 of 3 loaded so far.' });
    expect(early.body.details).toMatchObject({ total: 3, done: 2 });
    expect(early.body.details.lines).toEqual([
      { cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', needed: 2, done: 2 },
      { cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg', needed: 1, done: 0 },
    ]);

    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(31).qrCode }).expect(201);
    const done = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId).expect(200);
    expect(done.headers['x-already-applied']).toBeUndefined();
    const sanaStop = await t1.stopFor(x1.id);
    expect(done.body).toEqual({ order: null, nextStopId: sanaStop });

    const order = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body).toMatchObject({ status: 'IN_TRANSIT', stage: 'ON_THE_WAY', onTheWayAt: expect.any(String) });
    const trip = await scans.trip(std.DR1, t1.id).expect(200);
    const pickup = trip.body.stops.find((s: { id: string }) => s.id === t1.pickupStopId);
    expect(pickup).toMatchObject({ status: 'DONE', departedAt: expect.any(String) });
    expect(await w.balance()).toBe(475_000n);

    const again = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body).toEqual({ order: null, nextStopId: sanaStop });
  });
});
