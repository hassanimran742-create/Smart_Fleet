/**
 * [Inc 2] The scan-related order and assignment cases under the Inc 2 rules: ORD-014, ASG-005, ASG-006,
 * ASG-009, ASG-010 and ASG-012 as they read once loads, hand-overs and hand-backs are Inc 2 scans
 * (API_CONTRACT §7.6, §7.7, §9.2-§9.5, §9.10). The Inc 1 forms pin the Inc 1 build.
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { recordMove } from '../../helpers/runs';
import { buildWorld, X1, type World } from './support/world';

jest.setTimeout(240_000);

describeDb('inc2 scan: orders and assignment on scans', () => {
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

  it('ORD-014 (Inc 2) Delivered guard: only the trip\'s driver, only with matching scans, and only once', async () => {
    const { std } = w;
    const o1 = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const t1 = await w.assign(o1, std.DR1);
    const tap = (caller: Parameters<World['as']>[0], id: string) => w.as(caller).patch(`/orders/${id}/status`).send({ status: 'DELIVERED' });

    expect((await tap(std.DR2, o1.id)).status).toBe(404);
    const office = await tap(std.SA1, o1.id);
    expect(office.status).toBe(400);
    expect(office.body.code).toBe('ORDER_USE_MANUAL_DELIVERY');
    expect((await tap(std.DA, o1.id)).status).toBe(403);
    const unscanned = await tap(std.DR1, o1.id);
    expect(unscanned.status).toBe(409);
    expect(unscanned.body.code).toBe('DELIVERY_SCANS_INCOMPLETE');

    await w.load(std.DR1, t1, [1]);
    await w.hand(std.DR1, t1, o1, [1]);
    const done = await tap(std.DR1, o1.id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'DELIVERED', stage: 'DELIVERED', deliveryMethod: 'SCANNED', deliveredAt: expect.any(String) });
    const repeat = await tap(std.DR1, o1.id);
    expect(repeat.status).toBe(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body.deliveredAt).toBe(done.body.deliveredAt);

    const o2 = await w.placeOrder([{ size: '11.8', full: 1 }], 'C2');
    const t2 = await w.assign(o2, std.DR1);
    await w.load(std.DR1, t2, [2]);
    await w.hand(std.DR1, t2, o2, [2]);
    const both = await Promise.all([tap(std.DR1, o2.id).then((r) => r), tap(std.DR1, o2.id).then((r) => r)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.filter((r) => !r.headers['x-already-applied'])).toHaveLength(1);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('IN_PROGRESS');
    expect(await w.db.ledgerEntry.count({ where: { orderId: { in: [o1.id, o2.id] } } })).toBe(2);
    await w.walletClean();
  });

  it('ASG-005 (Inc 2) Changing the driver is refused once a cylinder is loaded, and the office can\'t abort that trip', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    const order = await w.as(std.SA1).get(`/orders/${x1.id}`).expect(200);
    expect(order.body.stage).toBe('LOADING');
    expect(order.body.allowedActions).not.toContain('REASSIGN');
    const move = await w.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Test' });
    expect(move.status).toBe(409);
    expect(move.body).toMatchObject({ code: 'ASSIGN_ORDER_LOADED', details: { plateNo: 'LEA-101' } });
    expect(await w.db.trip.count()).toBe(1);
    const abort = await w.as(std.SA1).patch(`/trips/${t1.id}/status`).send({ status: 'ABORTED', reason: 'Test abort' });
    expect(abort.status).toBe(409);
    expect(abort.body.code).toBe('TRIP_INVALID_TRANSITION');
  });

  it('ASG-006 (Inc 2) A driver change racing the first load scan: either the change wins or the load wins, never both', async () => {
    const { std, scans } = w;
    for (let round = 1; round <= 20; round += 1) {
      await w.topUp(480);
      const x1 = await w.placeOrder(X1);
      const t1 = await w.assign(x1, std.DR1);
      const cylinder = w.ag(round);
      const [move, load] = await Promise.all([
        w.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Race test' }).then((r) => r),
        scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: cylinder.qrCode }).then((r) => r),
      ]);
      const trip = await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } });
      const order = await w.db.order.findUniqueOrThrow({ where: { id: x1.id } });
      const holder = await w.holder(round);
      if (move.status === 200) {
        expect({ round, load: load.status, code: load.body.code }).toEqual({ round, load: 409, code: 'SCAN_TRIP_CLOSED' });
        expect(trip.status).toBe('ABORTED');
        expect(holder.custodyType).toBe('STORE');
        expect(order.loadStartedAt).toBeNull();
        // Keep DR2's trip from collecting the next rounds' orders: cancel the moved order.
        await w.as(std.DA).post(`/orders/${x1.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
      } else {
        expect({ round, move: move.status, code: move.body.code, load: load.status }).toEqual({ round, move: 409, code: 'ASSIGN_ORDER_LOADED', load: 201 });
        expect(holder).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
        expect(order.loadStartedAt).not.toBeNull();
        expect(trip.status).toBe('IN_PROGRESS');
      }
      expect(move.status === 200 && holder.custodyType === 'VEHICLE').toBe(false);
    }
    await w.walletClean();
  });

  it('ASG-009 (Inc 2) Trip and stop steps: start, arrive, depart as "Done loading", finish and office abort', async () => {
    const { std, scans } = w;
    const o1 = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const t1 = await w.assign(o1, std.DR1);
    const started = await w.as(std.DR1).patch(`/trips/${t1.id}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    expect((await w.as(std.DA).get(`/orders/${o1.id}`).expect(200)).body).toMatchObject({ status: 'ASSIGNED', stage: 'DRIVER_ASSIGNED', onTheWayAt: null });

    const arrive = await w.as(std.DR1).patch(`/trips/stops/${t1.pickupStopId}/arrive`).expect(200);
    const again = await w.as(std.DR1).patch(`/trips/stops/${t1.pickupStopId}/arrive`).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body.arrivedAt).toBe(arrive.body.arrivedAt);
    const empty = await w.as(std.DR1).patch(`/trips/stops/${t1.pickupStopId}/depart`);
    expect(empty.status).toBe(409);
    expect(empty.body.code).toBe('LOAD_INCOMPLETE');
    await w.load(std.DR1, t1, [1]);
    const depart = await w.as(std.DR1).patch(`/trips/stops/${t1.pickupStopId}/depart`).expect(200);
    expect(depart.body).toMatchObject({ status: 'DONE', completedAt: expect.any(String) });
    expect((await w.as(std.DR1).patch(`/trips/stops/${t1.pickupStopId}/depart`).expect(200)).headers['x-already-applied']).toBe('true');
    expect((await w.as(std.DA).get(`/orders/${o1.id}`).expect(200)).body).toMatchObject({ status: 'IN_TRANSIT', stage: 'ON_THE_WAY' });

    const open = await w.as(std.DR1).patch(`/trips/${t1.id}/status`).send({ status: 'COMPLETED' });
    expect(open.status).toBe(409);
    expect(open.body.code).toBe('TRIP_STOPS_OPEN');
    await w.hand(std.DR1, t1, o1, [1]);
    expect((await w.finishVisit(std.DR1, t1, o1)).status).toBe(200);
    await w.as(std.DR1).patch(`/trips/${t1.id}/status`).send({ status: 'COMPLETED' }).expect(200);
    expect((await w.as(std.DR1).patch(`/trips/${t1.id}/status`).send({ status: 'COMPLETED' }).expect(200)).headers['x-already-applied']).toBe('true');

    const o2 = await w.placeOrder([{ size: '11.8', full: 1 }], 'C2');
    const t2 = await w.assign(o2, std.DR1);
    expect(t2.id).not.toBe(t1.id);
    expect((await w.as(std.SA1).patch(`/trips/${t2.id}/status`).send({ status: 'ABORTED' })).status).toBe(400);
    const aborted = await w.as(std.SA1).patch(`/trips/${t2.id}/status`).send({ status: 'ABORTED', reason: 'Van broke down' }).expect(200);
    expect(aborted.body.status).toBe('ABORTED');
    const back = await w.db.order.findUniqueOrThrow({ where: { id: o2.id } });
    expect(back).toMatchObject({ status: 'PENDING', tripId: null, assignedAt: null });
    expect((await w.db.tripStop.findMany({ where: { tripId: t2.id } })).every((s) => s.status === 'CANCELLED')).toBe(true);
    const audit = await w.db.auditLog.findMany({ where: { action: 'trip.abort', resourceId: t2.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].diff).toMatchObject({ orderIds: [o2.id] });
    expect((await w.as(std.DR1).patch(`/trips/${t1.id}/status`).send({ status: 'PLANNED' })).status).toBe(409);
    const repeat = await w.as(std.SA1).patch(`/trips/${t2.id}/status`).send({ status: 'ABORTED', reason: 'Van broke down' }).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(await w.db.auditLog.count({ where: { action: 'trip.abort', resourceId: t2.id } })).toBe(1);
  });

  it('ASG-010 (Inc 2) Cancelling an order cancels its stop; the trip is aborted only if nothing was loaded', async () => {
    const { std, scans } = w;
    const o2 = await w.placeOrder([{ size: '11.8', full: 1 }], 'C2');
    const t2 = await w.assign(o2, std.DR1);
    await scans.tripScan(std.DR1, t2.id, { stopId: t2.pickupStopId, action: 'LOAD', code: w.ag(4).qrCode }).expect(201);
    const o1 = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const t1 = await w.assign(o1, std.DR1);
    expect(t1.id).not.toBe(t2.id);

    await w.as(std.DA).post(`/orders/${o1.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    await w.as(std.DA).post(`/orders/${o2.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('ABORTED');
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: await t1.stopFor(o1.id) } })).status).toBe('CANCELLED');
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t2.id } })).status).toBe('IN_PROGRESS');
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: await t2.stopFor(o2.id) } })).status).toBe('CANCELLED');
    expect(await w.holder(4)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
  });

  it('ASG-012 (Inc 2) The store\'s hand-back of an earlier run\'s empties doesn\'t block a driver change; a hand-over or a take-back does', async () => {
    const { std, scans } = w;
    // An empty from an earlier run is still on DR1's van.
    await w.withCustomer(15, 'C1');
    await recordMove({
      cylinderId: w.ag(15).id,
      eventType: CylinderEventType.PICKED_UP_EMPTY,
      actorUserId: std.DR1.userId,
      from: { type: CustodyType.CLIENT, id: std.C1.id },
      to: { type: CustodyType.VEHICLE, id: std.DR1.vehicleId as string },
      fromState: CylinderState.FULL,
      toState: CylinderState.EMPTY,
    });
    const x1 = await w.placeOrder(X1);
    const t = await w.assign(x1, std.DR1);
    expect((await w.receive(15)).status).toBe(201);
    const view = await w.as(std.SA1).get(`/orders/${x1.id}`).expect(200);
    expect(view.body.loadStartedAt).toBeNull();
    expect(view.body.cancel.refundPaisa).toBe('48000');
    expect(view.body.allowedActions).toContain('REASSIGN');
    const moved = await w.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id }).expect(200);
    expect(moved.body.reassignedFromTripId).toBe(t.id);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('ABORTED');
    const cancelled = await w.as(std.DA).post(`/orders/${x1.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    expect(cancelled.body.refundedPaisa).toBe('48000');
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: moved.body.tripId } })).status).toBe('ABORTED');

    // A hand-over keeps the order on its trip.
    const third = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const t3 = await w.assign(third, std.DR1);
    await w.load(std.DR1, t3, [1]);
    await w.hand(std.DR1, t3, third, [1]);
    const handed = await w.as(std.SA1).get(`/orders/${third.id}`).expect(200);
    expect(handed.body.allowedActions).not.toContain('REASSIGN');
    expect(handed.body.allowedActions).toContain('MANUAL_DELIVERY');
    expect((await w.as(std.SA1).post(`/orders/${third.id}/assign-driver`).send({ driverId: std.DR2.id })).body.code).toBe('ASSIGN_ORDER_LOADED');

    // So does a take-back before anything is loaded.
    await w.withCustomer(16, 'C2');
    const fourth = await w.placeOrder([{ size: '11.8', full: 1, back: 1 }], 'C2');
    const t4 = await w.assign(fourth, std.DR2);
    await scans.tripScan(std.DR2, t4.id, { stopId: await t4.stopFor(fourth.id), action: 'TAKE_BACK', code: w.ag(16).qrCode, returnState: 'EMPTY' }).expect(201);
    const kept = await w.as(std.SA1).get(`/orders/${fourth.id}`).expect(200);
    expect(kept.body.loadStartedAt).toBeNull();
    expect(kept.body.allowedActions).not.toContain('REASSIGN');
    const refused = await w.as(std.SA1).post(`/orders/${fourth.id}/assign-driver`).send({ driverId: std.DR1.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ASSIGN_ORDER_LOADED');
    await w.walletClean();
  });
});
