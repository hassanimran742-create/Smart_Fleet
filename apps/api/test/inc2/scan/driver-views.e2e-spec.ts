/**
 * [Inc 2] The driver's read routes (API_CONTRACT §9.3: `GET /driver/home`, `GET /trips/:tripId`,
 * `GET /trips/:tripId/stops/:stopId`) and the van load counted from cylinders (Appendix A,
 * `GET /inventory/my-vehicle`). Contract tests: no case id of their own (DRV cases use these reads).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, Y1, type World } from './support/world';

jest.setTimeout(120_000);

describeDb('inc2 scan: driver reads', () => {
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

  it('API §9.3 GET /driver/home gives the van, the active trip, the next trips and today\'s count in one request', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1]);
    const y1 = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(y1, std.DR1);
    expect(t2.id).not.toBe(t1.id);

    const home = await scans.driverHome(std.DR1).expect(200);
    expect(home.body).toEqual({
      businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      onDuty: false,
      vehicle: { id: std.DR1.vehicleId, plateNo: 'LEA-101' },
      van: { full: 1, empty: 0, partFilled: 0, total: 1 },
      activeTrip: {
        id: t1.id,
        status: 'IN_PROGRESS',
        plannedAt: expect.any(String),
        startedAt: expect.any(String),
        store: { id: std.DA.homeStoreId, name: 'Ahmed Gas Store' },
        customers: 1,
        // [Inc 2/3 UI gate] Today's rows read the names and the cylinder count from the summary.
        customerNames: ['Sana'],
        cylinders: 3,
        stops: { done: 0, total: 2 },
      },
      nextTrips: [
        expect.objectContaining({
          id: t2.id,
          status: 'PLANNED',
          startedAt: null,
          customers: 1,
          customerNames: ['Usman'],
          cylinders: 1,
          stops: { done: 0, total: 2 },
        }),
      ],
      doneToday: 0,
    });
    expect((await scans.driverHome(std.DA)).status).toBe(403);
    expect((await scans.driverHome(std.SA1)).status).toBe(403);
  });

  it('API §9.3 GET /trips/:tripId adds each stop\'s words and progress, the van and the trip\'s buttons', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    const trip = await scans.trip(std.DR1, t1.id).expect(200);
    expect(trip.body).toMatchObject({
      id: t1.id,
      status: 'IN_PROGRESS',
      van: { full: 3, empty: 0, partFilled: 0, total: 3 },
      leftoverReason: null,
      allowedActions: [],
      driver: { id: std.DR1.id, name: 'Kashif' },
      originStore: { name: 'Ahmed Gas Store' },
    });
    const [pickup, sana] = trip.body.stops;
    expect(pickup).toMatchObject({ id: t1.pickupStopId, seq: 0, type: 'STORE_PICKUP', stopType: 'STORE_PICKUP', status: 'ARRIVED', title: 'Ahmed Gas Store', address: expect.any(String) });
    expect(pickup.progress).toMatchObject({ type: 'STORE_PICKUP', doneCount: 3, neededCount: 3, complete: true });
    expect(pickup.location).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(sana).toMatchObject({ type: 'DELIVERY', title: 'Sana', address: "Sana's house", status: 'PENDING', orderId: x1.id });
    expect(sana.progress).toMatchObject({ type: 'DELIVERY', give: { doneCount: 0, neededCount: 3 }, canFinish: false });

    // [Inc 2/3 UI gate] The van's cylinders from the trip's point of view, for Unload's rows (R7): loaded
    // for an order still open, so NOT_DELIVERED.
    expect(trip.body.van.cylinders).toHaveLength(3);
    expect(trip.body.van.cylinders).toEqual(
      expect.arrayContaining([
        { shortCode: 'AG-C0001', sizeLabel: '11.8 kg', state: 'FULL', came: 'NOT_DELIVERED' },
        { shortCode: 'AG-C0002', sizeLabel: '11.8 kg', state: 'FULL', came: 'NOT_DELIVERED' },
      ]),
    );

    const office = await scans.trip(std.SA1, t1.id).expect(200);
    expect(office.body.allowedActions).toEqual([]);
    expect((await scans.trip(std.DR2, t1.id)).status).toBe(404);

    const stop = await scans.stop(std.DR1, t1.id, t1.pickupStopId).expect(200);
    expect(stop.body.order).toBeNull();
    expect(stop.body.progress).toMatchObject({ type: 'STORE_PICKUP', complete: true });

    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    const ready = await scans.trip(std.DR1, t1.id).expect(200);
    expect(ready.body.allowedActions).toEqual(['COMPLETE']);
    expect(ready.body.van.total).toBe(0);
    expect(ready.body.van.cylinders).toEqual([]);
  });

  it("REV23 security-03 a visit whose order went to another driver is 404 to the old driver; his other stops still read", async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const y1 = await w.placeOrder(Y1, 'C2');
    expect((await w.assign(y1, std.DR1)).id).toBe(t1.id); // appended: T1 has no load yet
    const sanaStop = await t1.stopFor(x1.id);
    const usmanStop = await t1.stopFor(y1.id);
    // The office gives Sana's order to Imran before anything is loaded; Usman's stays on Kashif's run.
    const t2 = await w.assign(x1, std.DR2, 'Kashif is stuck in traffic');

    const old = await scans.stop(std.DR1, t1.id, sanaStop);
    expect({ status: old.status, code: old.body.code, order: old.body.order ?? null }).toEqual({ status: 404, code: 'NOT_FOUND', order: null });
    expect((await w.as(std.DR1).get(`/orders/${x1.id}`)).status).toBe(404);
    // His own stops still read: the store stop (no order) and Usman's visit with its order.
    expect((await scans.stop(std.DR1, t1.id, t1.pickupStopId).expect(200)).body.order).toBeNull();
    expect((await scans.stop(std.DR1, t1.id, usmanStop).expect(200)).body.order).toMatchObject({ id: y1.id });
    // The trip still lists the old visit (cancelled), with its own words.
    const trip = await scans.trip(std.DR1, t1.id).expect(200);
    expect(trip.body.stops.find((stop: { id: string }) => stop.id === sanaStop)).toMatchObject({ status: 'CANCELLED', title: 'Sana' });
    // Imran reads the order on his own trip.
    const now = await scans.stop(std.DR2, t2.id, await t2.stopFor(x1.id)).expect(200);
    expect(now.body.order).toMatchObject({ id: x1.id });
  });

  it('Appendix A GET /inventory/my-vehicle counts the cylinders on the driver\'s van', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    const load = await w.as(std.DR1).get('/inventory/my-vehicle').expect(200);
    expect(load.body).toMatchObject({ vehicleId: std.DR1.vehicleId, plateNo: 'LEA-101', totalFull: 3, totalEmpty: 0, totalPartFilled: 0 });
    expect(load.body.byType.map((row: { full: number }) => row.full).sort()).toEqual([1, 2]);
    // [Inc 2/3 UI gate] My van's numbers line (R9): each cylinder by number, lowest first.
    expect(load.body.cylinders.map((cylinder: { shortCode: string }) => cylinder.shortCode)).toEqual(['AG-C0001', 'AG-C0002', 'AG-C0031']);
    expect(load.body.cylinders[0]).toEqual({ shortCode: 'AG-C0001', cylinderTypeId: expect.any(String), state: 'FULL' });

    const none = await w.as(std.DR2).get('/inventory/my-vehicle').expect(200);
    expect(none.body.cylinders).toEqual([]);
  });
});
