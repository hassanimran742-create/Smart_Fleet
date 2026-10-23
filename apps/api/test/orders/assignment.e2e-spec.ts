/**
 * Driver assignment and trips, Inc 1 (ADR-12, API_CONTRACT §7.6 assign-driver, §7.7, §8.3): manual
 * assignment from the distributor's store, reassignment, races, the driver's own trips, trip and stop
 * steps, and what a cancel does to a trip.
 */
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData } from '../helpers/standard-data';
import { API, OrdersFixture, qrOf, together } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

jest.setTimeout(300_000);

describeDb('api-orders: assignment and trips', () => {
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

  const storeStopOf = async (tripId: string) => (await f.stops(tripId)).find((stop) => stop.stopType === 'STORE_PICKUP');
  const deliveryStopOf = async (tripId: string) => (await f.stops(tripId)).find((stop) => stop.stopType === 'DELIVERY');

  it('ASG-001 with automatic assignment off, a new order waits for the office and nothing assigns it', async () => {
    const { std } = f;
    // Step 1.
    expect((await http(app).get(`${API}/app/config`).expect(200)).body.features.autoAssign).toBe(false);
    // Step 2.
    const x2 = await f.x2();
    // Step 3 (a short wait instead of a minute: nothing is queued at all).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const read = await f.as(std.DA).get(`/orders/${x2.id}`).expect(200);
    expect(read.body).toMatchObject({ status: 'PENDING', stage: 'NEEDS_DRIVER', trip: null, assignedAt: null });
    const queue = app.get<Queue>(getQueueToken('dispatch'));
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    expect(jobs.filter((job) => job.data?.orderId === x2.id)).toEqual([]);
    // Step 4.
    const manual = await f.as(std.SA1).post('/dispatch/manual').send({ orderId: x2.id }).expect(403);
    expect(manual.body).toMatchObject({ code: 'DISPATCH_AUTO_OFF', message: 'Automatic assignment is switched off.' });
    expect((await f.order(x2.id)).status).toBe('PENDING');
    // Step 5.
    const settings = await f.as(std.SA1).get('/settings').expect(200);
    const rows = Array.isArray(settings.body) ? settings.body : settings.body.items;
    expect((rows as Array<{ key: string; value: unknown; default: unknown }>).find((row) => row.key === 'dispatch.autoAssign.enabled')).toMatchObject({
      value: false,
      default: false,
    });
  });

  it('ASG-002 assigning Kashif creates a trip that starts at Ahmed Gas Store, whatever store the request names', async () => {
    const { std } = f;
    const x1 = await f.x1();
    // Step 1.
    const res = await f.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR1.id, originStoreId: std.DB.homeStoreId }).expect(200);
    expect(res.body).toEqual({ tripId: expect.any(String), driverId: std.DR1.id, originStoreId: std.DA.homeStoreId });
    // Step 2.
    const trip = await f.as(std.SA1).get(`/trips/${res.body.tripId}`).expect(200);
    expect(trip.body).toMatchObject({ status: 'PLANNED', vehicle: { plateNo: 'LEA-101' }, originStoreId: std.DA.homeStoreId });
    expect(trip.body.stops).toEqual([
      expect.objectContaining({ seq: 0, stopType: 'STORE_PICKUP', storeId: std.DA.homeStoreId, status: 'PENDING' }),
      expect.objectContaining({ seq: 1, stopType: 'DELIVERY', orderId: x1.id, status: 'PENDING' }),
    ]);
    const order = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body).toMatchObject({
      status: 'ASSIGNED',
      stage: 'DRIVER_ASSIGNED',
      assignedAt: expect.any(String),
      trip: { driver: { name: 'Kashif' }, vehicle: { plateNo: 'LEA-101' } },
      originStore: { id: std.DA.homeStoreId, name: 'Ahmed Gas Store' },
    });
    // Step 3.
    const audits = await f.audits('order.assign', x1.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.SA1.id, distributorId: std.DA.id });
  });

  it('ASG-003 assignment is refused for the wrong caller, a finished order, an unavailable driver or no van', async () => {
    const { std, db } = f;
    await f.setBalance(std.DA, 2_000_000n);
    const O1 = await f.x1();
    const D1 = await f.x1();
    await db.order.update({ where: { id: D1.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), deliveryMethod: 'DRIVER_TAP' } });
    const C1x = await f.x1();
    await f.cancel(C1x.id, { reasonCode: 'DUPLICATE' }).expect(200);
    const assign = (who: typeof std.SA1 | typeof std.DA | typeof std.DR1, orderId: string, driverId: string) =>
      f.as(who).post(`/orders/${orderId}/assign-driver`).send({ driverId });
    // Step 1.
    for (const who of [std.DA, std.DR1]) expect((await assign(who, O1.id, std.DR1.id).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 2.
    for (const order of [D1, C1x]) {
      const res = await assign(std.SA1, order.id, std.DR1.id).expect(409);
      expect(res.body).toMatchObject({ code: 'ORDER_NOT_ASSIGNABLE', message: "This order can't get a driver now." });
    }
    // Step 3.
    await db.driver.update({ where: { id: std.DR2.id }, data: { availability: 'ON_LEAVE' } });
    const unavailable = await assign(std.SA1, O1.id, std.DR2.id).expect(409);
    expect(unavailable.body).toMatchObject({ code: 'ASSIGN_DRIVER_NOT_AVAILABLE', message: "Imran can't take trips right now." });
    // Step 4.
    await db.driver.update({ where: { id: std.DR2.id }, data: { availability: 'AVAILABLE', currentVehicleId: null } });
    const noVan = await assign(std.SA1, O1.id, std.DR2.id).expect(409);
    expect(noVan.body).toMatchObject({ code: 'ASSIGN_DRIVER_NO_VEHICLE', message: 'Imran has no van. Give them a van first.' });
    const row = await f.order(O1.id);
    expect([row.status, row.tripId]).toEqual(['PENDING', null]);
    expect(await f.audits('order.assign')).toEqual([]);
    // Step 5.
    await db.driver.update({ where: { id: std.DR2.id }, data: { currentVehicleId: std.DR2.vehicleId } });
  });

  it('ASG-004 changing the driver closes the old trip and stop, and only the new driver can deliver', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const T1 = (await f.assign(x1.id, std.DR1)).tripId;
    // Step 1.
    const res = await f.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Kashif is sick' }).expect(200);
    expect(res.body).toEqual({ tripId: expect.any(String), driverId: std.DR2.id, originStoreId: std.DA.homeStoreId, reassignedFromTripId: T1 });
    const T2 = res.body.tripId as string;
    // Step 2.
    const old = await f.as(std.SA1).get(`/trips/${T1}`).expect(200);
    expect(old.body.status).toBe('ABORTED');
    expect((old.body.stops as Array<{ stopType: string; orderId: string | null; status: string }>).find((stop) => stop.orderId === x1.id)?.status).toBe('CANCELLED');
    const fresh = await f.as(std.SA1).get(`/trips/${T2}`).expect(200);
    expect(fresh.body).toMatchObject({ status: 'PLANNED', vehicle: { plateNo: 'LEB-202' } });
    expect(fresh.body.stops).toEqual([
      expect.objectContaining({ stopType: 'STORE_PICKUP', storeId: std.DA.homeStoreId }),
      expect.objectContaining({ stopType: 'DELIVERY', orderId: x1.id }),
    ]);
    expect((await f.order(x1.id)).tripId).toBe(T2);
    // Step 3.
    const mine = (await f.as(std.DR1).get('/trips/mine').expect(200)).body as Array<{ id: string; status: string }>;
    expect(mine.filter((trip) => trip.status === 'PLANNED' || trip.status === 'IN_PROGRESS').map((trip) => trip.id)).not.toContain(T1);
    expect((await f.as(std.DR1).get(`/orders/${x1.id}`).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await f.as(std.DR1).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await f.loadScan(std.DR1, T1, 'AG-C0001').expect(409)).body.code).toBe('SCAN_TRIP_CLOSED');
    expect((await f.cylinder('AG-C0001')).custodyType).toBe('STORE');
    // Step 4.
    expect(((await f.as(std.DR2).get('/trips/mine').expect(200)).body as Array<{ id: string }>).map((trip) => trip.id)).toContain(T2);
    // Step 5.
    const audits = await f.audits('order.reassign', x1.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.SA1.id, reason: 'Kashif is sick' });
    expect(audits[0].diff).toMatchObject({ fromTripId: T1, toTripId: T2 });
    // Step 6.
    expect(await f.balance()).toBe(452_000n);
  });

  it('ASG-005 changing the driver is refused once a cylinder is loaded, and the office cannot abort that trip', async () => {
    const { std, db } = f;
    const x1 = await f.x1();
    const T1 = (await f.assign(x1.id, std.DR1)).tripId;
    // Step 1.
    await f.loadScan(std.DR1, T1, 'AG-C0001').expect(201);
    const cylinder = await f.cylinder('AG-C0001');
    expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
    const loaded = await f.as(std.SA1).get(`/orders/${x1.id}`).expect(200);
    expect(loaded.body).toMatchObject({ stage: 'LOADING', loadStartedAt: expect.any(String) });
    // Step 2.
    expect(loaded.body.allowedActions).not.toContain('REASSIGN');
    const tripsBefore = await db.trip.count();
    const stopsBefore = await f.stops(T1);
    // Step 3.
    const refused = await f.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Test' }).expect(409);
    expect(refused.body).toMatchObject({
      code: 'ASSIGN_ORDER_LOADED',
      details: { plateNo: 'LEA-101' },
      message: "Cylinders are already loaded on LEA-101, so this order can't change driver.",
    });
    expect(await db.trip.count()).toBe(tripsBefore);
    expect(await f.stops(T1)).toEqual(stopsBefore);
    // Step 4 (the case's reason "Test" is 4 characters, refused by the 5–300 rule first; a valid reason meets the trip rule).
    expect((await f.as(std.SA1).patch(`/trips/${T1}/status`).send({ status: 'ABORTED', reason: 'Test' }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    const abort = await f.as(std.SA1).patch(`/trips/${T1}/status`).send({ status: 'ABORTED', reason: 'Test abort after load' }).expect(409);
    expect(abort.body.code).toBe('TRIP_INVALID_TRANSITION');
    expect((await f.trip(T1)).status).not.toBe('ABORTED');
  });

  it('ASG-006 a driver change racing the first load scan: either the change wins or the load wins, never both', async () => {
    const { std } = f;
    await f.setBalance(std.DA, 20n * 48_000n);
    const codes = await f.extraCylinders(20, std.sizes.kg11_8, 'SWAP');
    for (let round = 0; round < 20; round++) {
      const x1 = await f.x1();
      const T1 = (await f.assign(x1.id, std.DR1)).tripId;
      const [reassign, scan] = await together(
        f.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id, reason: 'Race test' }),
        f.loadScan(std.DR1, T1, codes[round]),
      );
      const order = await f.order(x1.id);
      const cylinder = await f.cylinder(codes[round]);
      const trip = await f.trip(T1);
      if (reassign.status === 200) {
        expect({ round, scan: scan.status, code: scan.body.code }).toEqual({ round, scan: 409, code: 'SCAN_TRIP_CLOSED' });
        expect(trip.status).toBe('ABORTED');
        expect((await deliveryStopOf(T1))?.status).toBe('CANCELLED');
        expect(cylinder.custodyType).toBe('STORE');
        expect(order.loadStartedAt).toBeNull();
      } else {
        expect({ round, reassign: reassign.status, code: reassign.body.code, scan: scan.status }).toEqual({
          round,
          reassign: 409,
          code: 'ASSIGN_ORDER_LOADED',
          scan: 201,
        });
        expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
        expect(order.loadStartedAt).not.toBeNull();
        expect(trip.status).not.toBe('ABORTED');
      }
      // Never both: a loaded cylinder on an aborted trip.
      expect(trip.status === 'ABORTED' && cylinder.custodyType === 'VEHICLE').toBe(false);
      // Put the round's order out of the way.
      await f.cancel(x1.id, { reasonCode: 'OTHER', note: 'Race round done' }).expect(200);
    }
  });

  it('ASG-007 two office users assigning one order at once, or one user submitting twice, leave one live trip', async () => {
    const { std, db } = f;
    const O1 = await f.x1();
    const O2 = await f.x1();
    // Step 1.
    const [a, b] = await together(
      f.as(std.SA1).post(`/orders/${O1.id}/assign-driver`).send({ driverId: std.DR1.id }),
      f.as(std.SA2).post(`/orders/${O1.id}/assign-driver`).send({ driverId: std.DR2.id }),
    );
    expect(a.status === 200 || b.status === 200).toBe(true);
    // Step 2.
    const stops = await db.tripStop.findMany({ where: { orderId: O1.id }, include: { trip: true } });
    expect(stops.filter((stop) => stop.trip.status !== 'ABORTED').map((stop) => stop.tripId).filter((id, i, all) => all.indexOf(id) === i)).toHaveLength(1);
    expect(stops.filter((stop) => stop.status !== 'CANCELLED')).toHaveLength(1);
    const final = await f.order(O1.id);
    const finalTrip = await f.trip(final.tripId as string);
    expect(await f.audits('order.assign', O1.id)).toHaveLength(1);
    const reassigns = await f.audits('order.reassign', O1.id);
    expect(reassigns.length).toBeLessThanOrEqual(1);
    const lastAudit = reassigns[0] ?? (await f.audits('order.assign', O1.id))[0];
    expect((lastAudit.diff as { driverId: string }).driverId).toBe(finalTrip.driverId);
    // Step 3.
    const first = await f.as(std.SA1).post(`/orders/${O2.id}/assign-driver`).send({ driverId: std.DR1.id }).expect(200);
    const second = await f.as(std.SA1).post(`/orders/${O2.id}/assign-driver`).send({ driverId: std.DR1.id }).expect(200);
    expect(first.headers['x-already-applied']).toBeUndefined();
    expect(second.headers['x-already-applied']).toBe('true');
    expect(second.body.tripId).toBe(first.body.tripId);
    expect(await db.trip.count({ where: { orders: { some: { id: O2.id } }, status: { not: 'ABORTED' } } })).toBe(1);
    expect(await f.audits('order.assign', O2.id)).toHaveLength(1);
    expect(await f.audits('order.reassign', O2.id)).toEqual([]);
    // Step 4.
    for (const driver of [std.DR1, std.DR2]) {
      const trips = (await f.as(driver).get('/trips/mine').expect(200)).body as Array<{ id: string; status: string; orders: Array<{ id: string }> }>;
      for (const trip of trips) {
        if (trip.status === 'ABORTED') continue;
        expect(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).toContain(trip.status);
      }
    }
  });

  it('ASG-008 a driver sees and acts on only their own trips and orders', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const T1 = (await f.assign(x1.id, std.DR1)).tripId;
    const store = await storeStopOf(T1);
    const missing = await f.as(std.DR2).get('/trips/00000000-0000-4000-8000-000000000000').expect(404);
    // Step 1.
    expect((await f.as(std.DR2).get('/trips/mine').expect(200)).body).toEqual([]);
    const calls = [
      f.as(std.DR2).get(`/trips/${T1}`),
      f.as(std.DR2).get(`/orders/${x1.id}`),
      f.as(std.DR2).patch(`/trips/${T1}/status`).send({ status: 'IN_PROGRESS' }),
      f.as(std.DR2).patch(`/trips/stops/${store?.id}/arrive`),
      f.as(std.DR2).post('/custody/scan').send({ qrCode: qrOf('AG-C0003'), eventType: 'SCAN_OUT', tripId: T1 }),
    ];
    for (const call of calls) {
      const res = await call.expect(404);
      expect({ code: res.body.code, message: res.body.message }).toEqual({ code: missing.body.code, message: missing.body.message });
    }
    expect((await f.trip(T1)).status).toBe('PLANNED');
    expect((await storeStopOf(T1))?.status).toBe('PENDING');
    expect((await f.cylinder('AG-C0003')).custodyType).toBe('STORE');
    // Step 2.
    expect(((await f.as(std.DR1).get('/trips/mine').expect(200)).body as Array<{ id: string }>).map((trip) => trip.id)).toEqual([T1]);
    const own = await f.as(std.DR1).get(`/trips/${T1}`).expect(200);
    expect(own.body.allowedActions).toEqual(['START']);
    expect((own.body.stops as Array<{ status: string; allowedActions: string[] }>).map((stop) => [stop.status, stop.allowedActions])).toEqual([
      ['PENDING', ['ARRIVE']],
      ['PENDING', ['ARRIVE']],
    ]);
    // Step 3.
    await http(app).get(`${API}/trips/${T1}`).expect(401);
  });

  it('ASG-009 trip and stop steps in Inc 1: start, arrive, depart, finish and the office abort', async () => {
    const { std } = f;
    const O1 = await f.x1();
    const T1 = (await f.assign(O1.id, std.DR1)).tripId;
    const O2 = await f.x1();
    const T2 = (await f.assign(O2.id, std.DR1)).tripId;
    // Step 1.
    const started = await f.as(std.DR1).patch(`/trips/${T1}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', startedAt: expect.any(String) });
    expect((await f.as(std.DR1).get(`/orders/${O1.id}`).expect(200)).body).toMatchObject({ status: 'ASSIGNED', stage: 'DRIVER_ASSIGNED', onTheWayAt: null });
    // Step 2.
    const store = await storeStopOf(T1);
    const arrived = await f.as(std.DR1).patch(`/trips/stops/${store?.id}/arrive`).expect(200);
    expect(arrived.body.status).toBe('ARRIVED');
    const arrivedAgain = await f.as(std.DR1).patch(`/trips/stops/${store?.id}/arrive`).expect(200);
    expect(arrivedAgain.headers['x-already-applied']).toBe('true');
    expect(arrivedAgain.body.arrivedAt).toBe(arrived.body.arrivedAt);
    const departed = await f.as(std.DR1).patch(`/trips/stops/${store?.id}/depart`).expect(200);
    expect(departed.body).toMatchObject({ status: 'DONE', completedAt: expect.any(String) });
    expect((await f.as(std.DR1).get(`/orders/${O1.id}`).expect(200)).body).toMatchObject({ status: 'IN_TRANSIT', stage: 'ON_THE_WAY', onTheWayAt: expect.any(String) });
    const departedAgain = await f.as(std.DR1).patch(`/trips/stops/${store?.id}/depart`).expect(200);
    expect(departedAgain.headers['x-already-applied']).toBe('true');
    expect(departedAgain.body.departedAt).toBe(departed.body.departedAt);
    // Step 3.
    const open = await f.as(std.DR1).patch(`/trips/${T1}/status`).send({ status: 'COMPLETED' }).expect(409);
    expect(open.body).toMatchObject({ code: 'TRIP_ORDERS_OPEN', message: 'Finish or close every order on this trip first.' });
    // Step 4.
    await f.as(std.DR1).patch(`/orders/${O1.id}/status`).send({ status: 'DELIVERED' }).expect(200);
    expect((await f.as(std.DR1).patch(`/trips/${T1}/status`).send({ status: 'COMPLETED' }).expect(200)).body.status).toBe('COMPLETED');
    expect((await f.as(std.DR1).patch(`/trips/${T1}/status`).send({ status: 'COMPLETED' }).expect(200)).headers['x-already-applied']).toBe('true');
    // Step 5.
    expect((await f.as(std.SA1).patch(`/trips/${T2}/status`).send({ status: 'ABORTED' }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    const aborted = await f.as(std.SA1).patch(`/trips/${T2}/status`).send({ status: 'ABORTED', reason: 'Van broke down' }).expect(200);
    expect(aborted.body.status).toBe('ABORTED');
    const back = await f.as(std.SA1).get(`/orders/${O2.id}`).expect(200);
    expect(back.body).toMatchObject({ status: 'PENDING', trip: null, assignedAt: null, stage: 'NEEDS_DRIVER' });
    expect((await f.stops(T2)).map((stop) => stop.status)).toEqual(['CANCELLED', 'CANCELLED']);
    const audits = await f.audits('trip.abort', T2);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.SA1.id, reason: 'Van broke down' });
    expect(audits[0].diff).toMatchObject({ orderIds: [O2.id] });
    expect(await f.ledger({ entryType: { in: ['CREDIT_ORDER_REVERSAL'] } })).toEqual([]);
    // Step 6.
    expect((await f.as(std.DR1).patch(`/trips/${T1}/status`).send({ status: 'PLANNED' }).expect(409)).body.code).toBe('TRIP_INVALID_TRANSITION');
    // Step 7.
    const again = await f.as(std.SA1).patch(`/trips/${T2}/status`).send({ status: 'ABORTED', reason: 'Van broke down' }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(await f.audits('trip.abort', T2)).toHaveLength(1);
  });

  it('ASG-010 cancelling an order cancels its stop; the trip is aborted only if nothing was loaded', async () => {
    const { std } = f;
    const O1 = await f.x1();
    const T1 = (await f.assign(O1.id, std.DR1)).tripId;
    const O2 = await f.x1();
    const T2 = (await f.assign(O2.id, std.DR1)).tripId;
    await f.loadScan(std.DR1, T2, 'AG-C0004').expect(201);
    // Steps 1 and 2.
    expect((await f.cancel(O1.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200)).body.order.status).toBe('CANCELLED');
    expect((await f.cancel(O2.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200)).body.order.status).toBe('CANCELLED');
    // Step 3.
    const t1 = await f.as(std.SA1).get(`/trips/${T1}`).expect(200);
    expect(t1.body.status).toBe('ABORTED');
    expect((t1.body.stops as Array<{ orderId: string | null; status: string }>).find((stop) => stop.orderId === O1.id)?.status).toBe('CANCELLED');
    const t2 = await f.as(std.SA1).get(`/trips/${T2}`).expect(200);
    expect(t2.body.status).not.toBe('ABORTED');
    expect((t2.body.stops as Array<{ orderId: string | null; status: string }>).find((stop) => stop.orderId === O2.id)?.status).toBe('CANCELLED');
    const cylinder = await f.cylinder('AG-C0004');
    expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
  });
});
