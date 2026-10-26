/**
 * [Inc 2] The installed 0.1.0 driver app's routes under the Inc 2 rules (API_CONTRACT §9.10, Appendix
 * A), assign-driver v2 (§9.5) and who may call the trip routes (§9.3): DRV-023, DRV-024, DRV-041,
 * DRV-044 and DRV-047.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { recordMove } from '../../helpers/runs';
import { buildWorld, messageOf, X1, X2, Y1, type World } from './support/world';

jest.setTimeout(180_000);

/** The installed app's headers. */
const OLD_APP = { 'X-App-Variant': 'driver', 'X-App-Version': '0.1.0' };

describeDb('inc2 scan: legacy routes, assignment and trip access', () => {
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

  it('DRV-023 Old app (0.1.0): "Delivered" and "Trip completed" follow the Inc 2 rules', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);

    const early = await w.as(std.DR1).patch(`/orders/${x1.id}/status`).set(OLD_APP).send({ status: 'DELIVERED' });
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'DELIVERY_SCANS_INCOMPLETE', message: messageOf('DELIVERY_SCANS_INCOMPLETE') });
    expect((await w.db.order.findUniqueOrThrow({ where: { id: x1.id } })).status).toBe('IN_TRANSIT');

    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    const tap = await w.as(std.DR1).patch(`/orders/${x1.id}/status`).set(OLD_APP).send({ status: 'DELIVERED' });
    expect(tap.status).toBe(200);
    expect(tap.body).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'SCANNED' });
    expect(await w.db.ledgerEntry.count({ where: { orderId: x1.id, entryType: { not: 'DEBIT_ORDER' } } })).toBe(0);
    expect(await w.balance()).toBe(475_000n);

    // AG-C0011, taken back Empty earlier, is still on LEA-101.
    await w.withCustomer(11, 'C1');
    await recordMove({
      cylinderId: w.ag(11).id,
      eventType: CylinderEventType.PICKED_UP_EMPTY,
      actorUserId: std.DR1.userId,
      from: { type: CustodyType.CLIENT, id: std.C1.id },
      to: { type: CustodyType.VEHICLE, id: std.DR1.vehicleId as string },
      fromState: CylinderState.FULL,
      toState: CylinderState.EMPTY,
    });
    const complete = await w.as(std.DR1).patch(`/trips/${t1.id}/status`).set(OLD_APP).send({ status: 'COMPLETED' });
    expect(complete.status).toBe(409);
    expect(complete.body.code).toBe('TRIP_VAN_NOT_EMPTY');
    expect(complete.body.details.count).toBe(1);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('IN_PROGRESS');
  });

  it('DRV-024 Old app (0.1.0): the legacy scan route uses the new rules and can\'t hand back', async () => {
    const { std } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    const legacy = (body: Record<string, unknown>) => w.as(std.DR1).post('/custody/scan').set(OLD_APP).send(body);

    const handBack = await legacy({ qrCode: w.ag(1).qrCode, eventType: 'SCAN_IN', tripId: t1.id });
    expect(handBack.status).toBe(403);
    expect(handBack.body).toMatchObject({ code: 'SCAN_USE_STORE_RECEIVE', message: 'Ask the store to scan it in.' });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });

    const lateLoad = await legacy({ qrCode: w.ag(21).qrCode, eventType: 'SCAN_OUT', tripId: t1.id });
    expect(lateLoad.status).toBe(409);
    expect(lateLoad.body.code).toBe('SCAN_STOP_CLOSED');
    expect(await w.holder(21)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });

    const back = await legacy({ qrCode: w.ag(11).qrCode, eventType: 'PICKED_UP_EMPTY', tripId: t1.id, orderId: x1.id });
    expect(back.status).toBe(201);
    expect(back.body).toMatchObject({ newState: 'EMPTY', toType: 'VEHICLE', toId: std.DR1.vehicleId, cylinderId: w.ag(11).id });
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId, state: 'EMPTY' });
    const sana = await t1.stopFor(x1.id);
    const row = await w.db.stopCylinder.findFirstOrThrow({ where: { tripStopId: sana, cylinderId: w.ag(11).id } });
    expect(row).toMatchObject({ direction: 'TAKEN_BACK', returnState: 'EMPTY' });

    // The same move again: the old app's repeat, found by the same-move test.
    const repeat = await legacy({ qrCode: w.ag(11).qrCode, eventType: 'PICKED_UP_EMPTY', tripId: t1.id, orderId: x1.id });
    expect(repeat.status).toBe(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body.alreadyRecorded).toBe(true);
  });

  it('DRV-041 An order can\'t be moved to another driver once anything is loaded', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1]);

    const move = await w.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Kashif is unwell' });
    expect(move.status).toBe(409);
    expect(move.body).toMatchObject({
      code: 'ASSIGN_ORDER_LOADED',
      message: "Cylinders are already loaded on LEA-101, so this order can't change driver.",
      details: { plateNo: 'LEA-101' },
    });
    const order = await w.db.order.findUniqueOrThrow({ where: { id: x1.id } });
    expect(order.tripId).toBe(t1.id);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('IN_PROGRESS');
    expect(await w.db.auditLog.count({ where: { action: 'order.reassign', resourceId: x1.id } })).toBe(0);

    await scans.storeScan(std.DA, { code: w.ag(1).qrCode }).expect(201);
    const again = await w.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Kashif is unwell' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ASSIGN_ORDER_LOADED');
  });

  it('DRV-044 A new order joins the driver\'s planned trip only while nothing is loaded', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const x2 = await w.placeOrder(X2, 'C2');
    const y1 = await w.placeOrder(Y1, 'C2');
    expect(await w.balance()).toBe(395_000n);

    const joined = await w.as(std.SA1).post(`/orders/${x2.id}/assign-driver`).send({ driverId: std.DR1.id }).expect(200);
    expect(joined.body).toMatchObject({ tripId: t1.id, appendedToExistingTrip: true });
    const stops = await w.db.tripStop.findMany({ where: { tripId: t1.id }, orderBy: { seq: 'asc' } });
    expect(stops.map((s) => [s.seq, s.stopType, s.orderId])).toEqual([
      [0, 'STORE_PICKUP', null],
      [1, 'DELIVERY', x1.id],
      [2, 'DELIVERY', x2.id],
    ]);

    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    const fresh = await w.as(std.SA1).post(`/orders/${y1.id}/assign-driver`).send({ driverId: std.DR1.id }).expect(200);
    expect(fresh.body.appendedToExistingTrip).toBe(false);
    expect(fresh.body.tripId).not.toBe(t1.id);
    const t2 = await w.db.trip.findUniqueOrThrow({ where: { id: fresh.body.tripId }, include: { stops: { orderBy: { seq: 'asc' } } } });
    expect(t2).toMatchObject({ status: 'PLANNED', originStoreId: std.DA.homeStoreId });
    expect(t2.stops[0]).toMatchObject({ stopType: 'STORE_PICKUP', storeId: std.DA.homeStoreId });
    expect(await w.db.tripStop.count({ where: { tripId: t1.id } })).toBe(3);

    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(2).qrCode }).expect(201);
    const third = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(3).qrCode });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('SCAN_LOAD_NOT_NEEDED');
  });

  it('DRV-047 Inc 2 trip routes accept only the trip\'s own driver: another driver gets 404, the shop and the office 403', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const calls = (caller: Parameters<World['as']>[0], tripId: string, stopId: string) => [
      scans.tripScan(caller, tripId, { stopId, action: 'LOAD', code: w.ag(1).qrCode }),
      scans.stop(caller, tripId, stopId),
      scans.finishStop(caller, tripId, stopId),
      scans.finishTrip(caller, tripId, {}),
    ];
    const strip = (body: Record<string, unknown>) => ({ statusCode: body.statusCode, code: body.code, message: body.message, details: body.details });

    const unknown = await Promise.all(calls(std.DR2, randomUUID(), randomUUID()));
    const other = await Promise.all(calls(std.DR2, t1.id, t1.pickupStopId));
    other.forEach((res, i) => {
      expect(res.status).toBe(404);
      expect(strip(res.body)).toEqual(strip(unknown[i].body));
    });
    for (const caller of [std.DA, std.SA1]) {
      for (const res of await Promise.all(calls(caller, t1.id, t1.pickupStopId))) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
      }
    }
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE' });
    expect(await w.eventCount(1)).toBe(1);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('PLANNED');
    expect((await w.db.tripStop.findMany({ where: { tripId: t1.id } })).every((s) => s.status === 'PENDING')).toBe(true);
  });
});
