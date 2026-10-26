/**
 * [review23 fixes, api-runs] Regression tests for the run and van findings, through the real routes:
 *
 * - holder-scans-01 / security-01: the office can't change a driver's van, or give that van to another
 *   driver, while a run can still put cylinders onto it (409 DRIVER_HAS_OPEN_RUN, API_CONTRACT §9.5). A run
 *   keeps its van and is never moved.
 * - holder-scans-02: two open runs of one driver on one van: each run sees only its own cylinders; another
 *   run's loads out for delivery aren't its leftovers, a cancelled order's load still is a spare.
 * - holder-scans-04: COMPLETE is offered exactly when "Finish trip" succeeds, a refill cylinder on the van
 *   included.
 * - robustness-jobs-06: a refreshed VAN_NOT_EMPTY reads the van's count now and keeps the driver's reason.
 *
 * Nothing here moves money.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VanCheckJob } from '../../../src/modules/custody/van-check.job';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http, type TestResponse } from '../../helpers/http';
import { refillCalls } from '../../helpers/inc3-calls';
import { createRefill, createStation } from '../../helpers/refills';
import { setCylinderState } from '../../helpers/runs';
import { buildWorld, messageOf, X1, Y1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

/**
 * The Inc 2/3 driver app's headers (the over-the-air JS names its release, apps/mobile/src/api/release.ts).
 * A driver call without them is the installed 0.1.0 JS, which is told to restart for the update instead of
 * a refusal only the new app can act on (TRIP_VAN_NOT_EMPTY, app-version.interceptor.ts).
 */
const NEW_DRIVER_APP = { 'X-App-Variant': 'driver', 'X-App-Version': '0.1.1' };

/** The van change's refusal: 409 DRIVER_HAS_OPEN_RUN with the run's driver and van, in plain words. */
function expectOpenRun(res: TestResponse, run: { driver: string; plateNo: string; run: 'TRIP' | 'REFILL' }): void {
  expect({ status: res.status, code: res.body.code, details: res.body.details }).toEqual({ status: 409, code: 'DRIVER_HAS_OPEN_RUN', details: run });
  expect(res.body.message).toBe(messageOf('DRIVER_HAS_OPEN_RUN', run));
  expect(res.body.message).toBe(`Finish or reassign ${run.driver}'s trip on ${run.plateNo} first.`);
}

describeDb('review23 fixes (api-runs): vans and runs', () => {
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

  async function newVan(plateNo: string): Promise<string> {
    const van = await w.db.vehicle.create({ data: { plateNo, capacityUnits: 40, homeZoneId: w.std.zones.North.id, status: 'ACTIVE' }, select: { id: true } });
    return van.id;
  }

  function giveVan(driverId: string, vehicleId: string | null) {
    return w.as(w.std.SA1).patch(`/drivers/${driverId}/vehicle`).send({ vehicleId });
  }

  async function vansOfDrivers() {
    const [kashif, imran] = await Promise.all([
      w.db.driver.findUniqueOrThrow({ where: { id: w.std.DR1.id }, select: { currentVehicleId: true } }),
      w.db.driver.findUniqueOrThrow({ where: { id: w.std.DR2.id }, select: { currentVehicleId: true } }),
    ]);
    return { kashif: kashif.currentVehicleId, imran: imran.currentVehicleId };
  }

  it("REV23 holder-scans-01 the office can't move Kashif to another van, or give his van away, while his trip waits on it", async () => {
    const { std, scans } = w;
    const lea101 = std.DR1.vehicleId as string;
    const leb202 = std.DR2.vehicleId as string;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1); // PLANNED on LEA-101, nothing loaded yet
    const lec303 = await newVan('LEC-303');
    const audits = () => w.db.auditLog.count({ where: { action: 'driver.update' } });
    const before = await audits();

    // LEA-101 breaks down before loading: neither change goes through, in either direction.
    expectOpenRun(await giveVan(std.DR1.id, lec303), { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' });
    expectOpenRun(await giveVan(std.DR2.id, lea101), { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' });
    expectOpenRun(await giveVan(std.DR1.id, null), { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' });
    // Nothing was written: both drivers keep their vans, no audit row, and the run keeps its van.
    expect(await vansOfDrivers()).toEqual({ kashif: lea101, imran: leb202 });
    expect(await audits()).toBe(before);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).vehicleId).toBe(lea101);
    // Giving Kashif the van he already has is still a repeat, not a refusal.
    expect((await giveVan(std.DR1.id, lea101).expect(200)).headers['x-already-applied']).toBe('true');

    // The office gives X1 to Imran (allowed before loading): Kashif's idle trip ends, and his van can change.
    await w.assign(x1, std.DR2, 'Kashif\'s van broke down');
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('ABORTED');
    await giveVan(std.DR1.id, lec303).expect(200);
    expect(await vansOfDrivers()).toEqual({ kashif: lec303, imran: leb202 });

    // Kashif's next order is a run on the van he drives now, and its load goes there.
    const y1 = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(y1, std.DR1);
    expect(t2.vehicleId).toBe(lec303);
    await w.load(std.DR1, t2, [1]);
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: lec303 });
    const home = await scans.driverHome(std.DR1).expect(200);
    expect({ plate: home.body.vehicle.plateNo, total: home.body.van.total }).toEqual({ plate: 'LEC-303', total: 1 });
    // And now that run blocks a change of LEC-303 in its turn (the van also holds its cylinder).
    expect((await giveVan(std.DR1.id, lea101)).body.code).toBe('VEHICLE_HAS_CYLINDERS');
    await w.walletClean();
  });

  it('REV23 holder-scans-01 an assigned refill keeps its van too, until the shop cancels it', async () => {
    const { std } = w;
    const refills = refillCalls(app);
    const station = await createStation();
    await setCylinderState(w.ag(6).id, 'EMPTY');
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, station });
    await refills.assign(std.SA1, refill.id, std.DR1.id).expect(200); // the refill's van: LEA-101
    const lec303 = await newVan('LEC-303');

    expectOpenRun(await giveVan(std.DR1.id, lec303), { driver: 'Kashif', plateNo: 'LEA-101', run: 'REFILL' });
    expectOpenRun(await giveVan(std.DR2.id, std.DR1.vehicleId as string), { driver: 'Kashif', plateNo: 'LEA-101', run: 'REFILL' });
    expect(await vansOfDrivers()).toEqual({ kashif: std.DR1.vehicleId, imran: std.DR2.vehicleId });

    // Nothing picked up yet: the shop cancels it, and the van can change.
    await refills.cancel(std.DA, refill.id).expect(200);
    await giveVan(std.DR1.id, lec303).expect(200);
    expect((await vansOfDrivers()).kashif).toBe(lec303);
  });

  it('REV23 holder-scans-01 a trip with every stop closed and an empty van no longer blocks a van change', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    // Kashif hasn't tapped "Finish trip" yet, but nothing can be loaded or taken back on this run any more.
    await giveVan(std.DR1.id, null).expect(200);
    expect((await vansOfDrivers()).kashif).toBeNull();
    // He can still finish it: the finish reads the run's own van.
    await w.scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    await w.walletClean();
  });

  it("REV23 holder-scans-01 a driver's own run left on an old van blocks his next van, and that van's next driver", async () => {
    const { std } = w;
    const lea101 = std.DR1.vehicleId as string;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const office = authHeader(std.SA1.actor);
    // Archiving Kashif releases his van; his planned trip still names LEA-101.
    await http(app).delete(`/api/v1/drivers/${std.DR1.id}`).set(office).send({ reason: 'Left the company' }).expect(200);
    expect((await vansOfDrivers()).kashif).toBeNull();
    expectOpenRun(await giveVan(std.DR2.id, lea101), { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' });
    // Reactivated, he can't be given another van while that run is open either.
    await http(app).patch(`/api/v1/drivers/${std.DR1.id}/reactivate`).set(office).send({ reason: 'Came back' }).expect(200);
    const lec303 = await newVan('LEC-303');
    expectOpenRun(await giveVan(std.DR1.id, lec303), { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' });

    // The office gives X1 to Imran: the run ends, and both changes go through.
    await w.assign(x1, std.DR2, 'Kashif is not driving today');
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('ABORTED');
    await giveVan(std.DR1.id, lec303).expect(200);
  });

  it("REV23 holder-scans-02 two open runs on one van: each sees only its own cylinders, and a cancelled order's load is still a spare", async () => {
    const { std, scans } = w;
    const sana = await w.placeOrder(Y1, 'C1');
    const t1 = await w.assign(sana, std.DR1);
    await w.load(std.DR1, t1, [1]);
    // Assigned while Kashif is still at the store: a second run on LEA-101.
    const usman = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(usman, std.DR1);
    expect(t2.id).not.toBe(t1.id);
    expect(t2.vehicleId).toBe(t1.vehicleId);
    await w.doneLoading(std.DR1, t1);
    await w.load(std.DR1, t2, [2]);
    await w.doneLoading(std.DR1, t2);
    await w.hand(std.DR1, t1, sana, [1]);
    expect((await w.finishVisit(std.DR1, t1, sana)).status).toBe(200);

    // T1 is done: Usman's cylinder is T2's, out for delivery. T2 still owes it.
    const view1 = await scans.trip(std.DR1, t1.id).expect(200);
    expect({ cylinders: view1.body.van.cylinders, total: view1.body.van.total, actions: view1.body.allowedActions }).toEqual({
      cylinders: [],
      total: 1,
      actions: ['COMPLETE'],
    });
    const view2 = await scans.trip(std.DR1, t2.id).expect(200);
    expect(view2.body.van.cylinders).toEqual([{ shortCode: 'AG-C0002', sizeLabel: '11.8 kg', state: 'FULL', came: 'NOT_DELIVERED' }]);
    expect(view2.body.allowedActions).toEqual([]);

    // Usman cancels after loading: AG-C0002 is no one's delivery now, so it is a spare for both runs.
    await w.as(std.DA).post(`/orders/${usman.id}/cancel`).set('Idempotency-Key', randomUUID()).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    const refused = await scans.finishTrip(std.DR1, t1.id, {}).set(NEW_DRIVER_APP);
    expect({ status: refused.status, code: refused.body.code, cylinders: refused.body.details?.cylinders }).toEqual({
      status: 409,
      code: 'TRIP_VAN_NOT_EMPTY',
      cylinders: [{ shortCode: 'AG-C0002', sizeLabel: '11.8 kg', state: 'FULL', came: 'SPARE' }],
    });
    expect((await scans.trip(std.DR1, t1.id).expect(200)).body.allowedActions).toEqual([]);
    const incoming = await scans.storeIncoming(std.DA).expect(200);
    expect(incoming.body.vans.flatMap((van: { cylinders: Array<{ shortCode: string; came: string }> }) => van.cylinders.map((c) => `${c.shortCode} ${c.came}`))).toEqual([
      'AG-C0002 SPARE',
    ]);

    // The store takes it back: both runs finish.
    expect((await w.receive(2)).status).toBe(201);
    await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    await scans.finishTrip(std.DR1, t2.id, {}).expect(200);
    await w.walletClean();
  });

  it('REV23 holder-scans-04 a refill cylinder on the van: COMPLETE is offered exactly when Finish trip goes through', async () => {
    const { std, scans } = w;
    const refills = refillCalls(app);
    const station = await createStation();
    await setCylinderState(w.ag(6).id, 'EMPTY');
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, station, assignTo: std.DR1 });
    await refills.scan(std.DR1, refill.id, { phase: 'PICKUP', code: w.ag(6).qrCode }).expect(201);

    const y1 = await w.placeOrder(Y1);
    const t1 = await w.assign(y1, std.DR1);
    await w.load(std.DR1, t1, [1]);
    await w.doneLoading(std.DR1, t1);
    // A visit still open: nothing offered.
    expect((await scans.trip(std.DR1, t1.id).expect(200)).body.allowedActions).toEqual([]);
    await w.hand(std.DR1, t1, y1, [1]);
    expect((await w.finishVisit(std.DR1, t1, y1)).status).toBe(200);

    const view = await scans.trip(std.DR1, t1.id).expect(200);
    // The van holds the refill cylinder (its counts say so), but it isn't the trip's.
    expect({ total: view.body.van.total, cylinders: view.body.van.cylinders, actions: view.body.allowedActions }).toEqual({
      total: 1,
      cylinders: [],
      actions: ['COMPLETE'],
    });
    await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    await w.walletClean();
  });

  it("REV23 robustness-jobs-06 the 03:00 refresh shows the van's count now and keeps the driver's reason", async () => {
    const { std, scans } = w;
    await w.setting('trip.allowFinishWithLeftovers', true);
    const x1 = await w.placeOrder([{ size: '11.8', full: 2 }]);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2]);
    await w.doneLoading(std.DR1, t1);
    await scans.failOrder(std.DR1, x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    await scans.finishTrip(std.DR1, t1.id, { leftoverReason: 'Store closed' }).expect(200);
    const alertOf = async () => {
      const rows = await w.db.alert.findMany({ where: { alertType: 'VAN_NOT_EMPTY', resourceId: std.DR1.vehicleId as string } });
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const first = await alertOf();
    expect({ title: first.title, body: first.body }).toEqual({
      title: 'LEA-101 still has cylinders on it (2)',
      body: 'LEA-101 still has 2 cylinder(s) on it. The shop must scan them in. Reason: Store closed',
    });

    // The shop takes one back; a new run is planned on the van; the 03:00 check runs.
    expect((await w.receive(1)).status).toBe(201);
    const y1 = await w.placeOrder(Y1, 'C2');
    await w.assign(y1, std.DR1);
    expect(await app.get(VanCheckJob).run()).toEqual({ vans: 1, plates: ['LEA-101'] });
    const refreshed = await alertOf();
    expect(refreshed.id).toBe(first.id);
    expect({ title: refreshed.title, body: refreshed.body, context: refreshed.context }).toEqual({
      title: 'LEA-101 still has cylinders on it (1)',
      body: 'LEA-101 still has 1 cylinder(s) on it. The shop must scan them in. Reason: Store closed',
      context: { vehicleId: std.DR1.vehicleId, plateNo: 'LEA-101', count: 1, tripId: t1.id, leftoverReason: 'Store closed' },
    });
    // The website's list shows the same words.
    const listed = (await w.as(std.SA1).get('/alerts?status=OPEN').expect(200)).body as Array<{ id: string; title: string; body: string }>;
    expect(listed.find((alert) => alert.id === first.id)).toMatchObject({ title: refreshed.title, body: refreshed.body });
    expect((await w.receive(2)).status).toBe(201);
    await w.setting('trip.allowFinishWithLeftovers', false);
    await w.walletClean();
  });
});
