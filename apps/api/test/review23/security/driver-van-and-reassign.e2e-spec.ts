/**
 * Review 23 (security): two ways a driver's routes reach past "the caller's own trip".
 *
 * 1. A reassigned order stays readable by the old driver through `GET /trips/:tripId/stops/:stopId`
 *    (the stop row keeps its order), with the new driver's name, phone and van, although
 *    `GET /orders/:id` answers that driver 404 (`canSeeOrder`, API_CONTRACT §3.2).
 * 2. `PATCH /drivers/:id/vehicle` used to check only that the vans are empty (§9.5), so a driver whose van
 *    was changed after assignment kept a PLANNED trip on the old van: the LOAD scans then put cylinders on
 *    the van another driver now drove, and that driver's run couldn't finish. The fix (lead decision for
 *    security-01 / holder-scans-01): the change is refused while a run names either van, 409
 *    DRIVER_HAS_OPEN_RUN ("Finish or reassign Kashif's trip on LEA-101 first."), so a run keeps its van.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, X2, type World } from '../../inc2/scan/support/world';

jest.setTimeout(180_000);

describeDb('review23 security: driver routes past the caller\'s own trip', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
  });

  it('REV23-SEC-STOP-LEAK the old driver still reads a reassigned order (and its new driver) through the stop route', async () => {
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, w.std.DR1);
    const oldStop = await t1.stopFor(x1.id);
    // The office gives the order to Imran before anything was loaded (allowed, §7.6 rule 4).
    await w.assign(x1, w.std.DR2, 'Kashif is stuck in traffic');

    // The order route: Kashif no longer sees it.
    const direct = await w.as(w.std.DR1).get(`/orders/${x1.id}`);
    expect({ status: direct.status, code: direct.body.code }).toEqual({ status: 404, code: 'NOT_FOUND' });

    // The stop route of his old trip: the same order, with Imran's phone and van.
    const viaStop = await w.scans.stop(w.std.DR1, t1.id, oldStop);
    const order = viaStop.body.order;
    // eslint-disable-next-line no-console
    console.log(
      `[review23] old driver via the stop route: ${viaStop.status}; order ${order?.shortCode} ${order?.status}; customer ${order?.client?.name} ${order?.client?.phone}; ` +
        `now on trip ${order?.trip?.id === t1.id ? 'T1' : 'the new trip'} of ${order?.trip?.driver?.name} ${order?.trip?.driver?.phone} (${order?.trip?.vehicle?.plateNo})`,
    );
    expect({ status: viaStop.status, order: viaStop.body.order?.id ?? null }).toEqual({ status: 404, order: null });
  });

  it("REV23-SEC-VAN-SWAP a van change while the driver's trip names his van is refused, so his LOAD lands on the van he drives", async () => {
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, w.std.DR1); // T1 on LEA-101, Kashif's van
    const lea101 = t1.vehicleId;
    // LEA-101 breaks down for Kashif: the office tries to give him a new van, and LEA-101 to Imran. Both
    // vans are empty, but T1 still names LEA-101: the change is refused, nothing is moved (lead decision:
    // a run keeps its van; "Finish or reassign Kashif's trip first").
    const lec303 = await w.db.vehicle.create({ data: { plateNo: 'LEC-303', capacityUnits: 40, homeZoneId: w.std.zones.North.id } });
    const openRun = { status: 409, code: 'DRIVER_HAS_OPEN_RUN', details: { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' } };
    const ownChange = await w.as(w.std.SA1).patch(`/drivers/${w.std.DR1.id}/vehicle`).send({ vehicleId: lec303.id });
    expect({ status: ownChange.status, code: ownChange.body.code, details: ownChange.body.details }).toEqual(openRun);
    const giveAway = await w.as(w.std.SA1).patch(`/drivers/${w.std.DR2.id}/vehicle`).send({ vehicleId: lea101 });
    expect({ status: giveAway.status, code: giveAway.body.code, details: giveAway.body.details }).toEqual(openRun);
    const drivers = await w.db.driver.findMany({ where: { id: { in: [w.std.DR1.id, w.std.DR2.id] } }, select: { id: true, currentVehicleId: true } });
    expect(new Map(drivers.map((d) => [d.id, d.currentVehicleId]))).toEqual(new Map([[w.std.DR1.id, lea101], [w.std.DR2.id, w.std.DR2.vehicleId]]));

    // Kashif loads X1's cylinders at Ahmed Gas Store on T1: they are on the van he drives, no one else's.
    await w.load(w.std.DR1, t1, [1, 2, 31]);
    const holders = await Promise.all([1, 2, 31].map((n) => w.holder(n)));
    expect(holders.map((h) => h.custodyId)).toEqual([lea101, lea101, lea101]);

    // Imran's own run on his own van finishes.
    const x2 = await w.placeOrder(X2, 'C2');
    const t2 = await w.assign(x2, w.std.DR2);
    expect(t2.vehicleId).toBe(w.std.DR2.vehicleId);
    await w.load(w.std.DR2, t2, [21, 22, 23]);
    await w.doneLoading(w.std.DR2, t2);
    await w.hand(w.std.DR2, t2, x2, [21, 22, 23]);
    expect((await w.finishVisit(w.std.DR2, t2, x2)).status).toBe(200);
    const finish = await w.scans.finishTrip(w.std.DR2, t2.id);
    expect(finish.status).toBe(200);
  });

  it('REV23-SEC-VAN-SWAP a van change while the driver has an assigned refill is refused, so its pickups land on the van he drives', async () => {
    const station = await w.as(w.std.SA1).post('/filling-stations').send({ name: 'Lahore Filling Station', address: 'GT Road', lat: 31.53, lng: 74.26 }).expect(201);
    // Two empties in Ahmed Gas Store.
    await w.markState(5, 'EMPTY');
    await w.markState(6, 'EMPTY');
    const refill = await w.as(w.std.DA).post('/filling-orders').set({ 'X-App-Variant': 'distributor', 'X-App-Version': '0.1.1' }).send({ fillingStationId: station.body.id, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 2 }).expect(201);
    await w.as(w.std.SA1).patch(`/filling-orders/${refill.body.id}/assign`).send({ driverId: w.std.DR1.id }).expect(200);
    const lea101 = w.std.DR1.vehicleId as string;
    const lec303 = await w.db.vehicle.create({ data: { plateNo: 'LEC-303', capacityUnits: 40, homeZoneId: w.std.zones.North.id } });
    const openRun = { status: 409, code: 'DRIVER_HAS_OPEN_RUN', details: { driver: 'Kashif', plateNo: 'LEA-101', run: 'REFILL' } };
    const ownChange = await w.as(w.std.SA1).patch(`/drivers/${w.std.DR1.id}/vehicle`).send({ vehicleId: lec303.id });
    expect({ status: ownChange.status, code: ownChange.body.code, details: ownChange.body.details }).toEqual(openRun);
    const giveAway = await w.as(w.std.SA1).patch(`/drivers/${w.std.DR2.id}/vehicle`).send({ vehicleId: lea101 });
    expect({ status: giveAway.status, code: giveAway.body.code, details: giveAway.body.details }).toEqual(openRun);

    const pickup = await w
      .as(w.std.DR1)
      .post(`/filling-orders/${refill.body.id}/scans`)
      .send({ scanId: '7f000000-0000-4000-8000-000000000001', phase: 'PICKUP', code: w.ag(5).qrCode, entryMethod: 'QR' });
    expect(pickup.status).toBe(201);
    const holder = await w.holder(5);
    // On LEA-101, which Kashif still drives: no other driver's van holds his refill's cylinder.
    expect(holder.custodyId).toBe(lea101);
    expect((await w.db.driver.findUniqueOrThrow({ where: { id: w.std.DR1.id } })).currentVehicleId).toBe(lea101);
  });
});
