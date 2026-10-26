/**
 * [review23 fixes, api-runs] Regression tests for the findings where an approved day-end fix meets the
 * runs, through the real routes (download, fill, upload, submit, approve, reopen):
 *
 * - holder-scans-03 / -08: a fix that keeps the holder (SET_STATE, MARK_LOST on a van) moves nothing: the
 *   driver who loaded the cylinder stays responsible, and "since" stays the time he loaded it.
 * - holder-scans-05 / robustness-jobs-03: a cylinder marked lost on a van stays on its record ("Lost") but
 *   no longer keeps the van loaded: the next run finishes, the 03:00 check is clean, the van can change
 *   driver, and the shop isn't told it is coming back. A lost cylinder that is found and taken back counts.
 * - holder-scans-07: after a reopen, re-sending the sheet keeps every applied fix's link and adds a found
 *   extra cylinder once.
 *
 * Nothing here moves money.
 */
import type { INestApplication } from '@nestjs/common';
import { VanCheckJob } from '../../../src/modules/custody/van-check.job';
import { authHeader } from '../../helpers/auth';
import { dayCloseLines, dayCloseOf } from '../../helpers/day-end';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createOrder, createTrip, placeWithCustomer, setCylinderState } from '../../helpers/runs';
import {
  API,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  D21,
  approve,
  createDayEndApp,
  download,
  fill,
  freshWorld,
  loadScan,
  receiveScan,
  submittedDay,
  tripNeeding,
  upload,
  vanOf,
  type DayWorld,
} from '../../inc3/dayend/support';

jest.setTimeout(CASE_TIMEOUT_MS);

/**
 * The Inc 2/3 driver app's headers (the over-the-air JS names its release, apps/mobile/src/api/release.ts).
 * A driver call without them is the installed 0.1.0 JS, which is told to restart for the update instead of
 * a refusal only the new app can act on (TRIP_VAN_NOT_EMPTY, app-version.interceptor.ts).
 */
const NEW_DRIVER_APP = { 'X-App-Variant': 'driver', 'X-App-Version': '0.1.1' };

describeDb('review23 fixes (api-runs): day-end fixes and the runs', () => {
  let app: INestApplication;
  let w: DayWorld;

  beforeAll(async () => {
    app = await createDayEndApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    w = await freshWorld(app);
  });

  async function history(code: string) {
    const res = await http(app).get(`${API}/cylinders/${code}/history`).set(authHeader(w.std.SA1.actor));
    expect(res.status).toBe(200);
    return res.body as {
      holder: { type: string; label: string; since: string | null; responsible: { name: string } | null };
      events: Array<{ action: string; at: string; dayEnd: { businessDate: string } | null }>;
    };
  }

  it('REV23 holder-scans-03 REV23 holder-scans-08 a fix that keeps the holder changes neither the responsible driver nor "since"', async () => {
    const trip = await tripNeeding(w, { driver: 'DR1', size: 'kg11_8', needs: 1 });
    const load = await loadScan(w, 'DR1', trip, w.ag(10));
    expect(load.status).toBe(201);
    const loadedAt = load.body.scan.at as string;

    const day = await submittedDay(w, { 'AG-C0010': { where: "On driver's van", state: 'Damaged', why: 'Valve leaking, driver says' } });
    await approve(w, day.id, day.version);
    const fixed = await history('AG-C0010');
    expect(fixed.events.map((event) => event.action).slice(-2)).toEqual(['SCAN_OUT', 'ADJUSTED']);
    expect(fixed.holder).toEqual({ type: 'VEHICLE', label: 'LEA-101', since: loadedAt, responsible: { userId: w.std.DR1.userId, name: 'Kashif', role: 'DRIVER' } });

    // The shop scans it in: a real holder change, so no one is responsible and "since" is the receive's time.
    const received = await receiveScan(w, w.ag(10));
    expect(received.status).toBe(201);
    const back = await history('AG-C0010');
    expect(back.holder).toEqual({ type: 'STORE', label: 'Ahmed Gas Store', since: received.body.scan.at, responsible: null });
  });

  it('REV23 holder-scans-05 a cylinder marked lost on a van stays on its record but no longer keeps the van loaded', async () => {
    const { std, scans } = w;
    // Kashif takes AG-C0003 back from Sana and loses it on the way back.
    await placeWithCustomer({ cylinder: w.ag(3), client: std.C1, actor: std.DR1 });
    const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] });
    const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
    const stop = trip.deliveryStopFor(order.id);
    await scans.tripScan(std.DR1, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: w.ag(10).qrCode }).expect(201);
    await scans.finishStop(std.DR1, trip.id, trip.pickupStopId).expect(200);
    await scans.tripScan(std.DR1, trip.id, { stopId: stop, action: 'HANDOVER', code: w.ag(10).qrCode }).expect(201);
    await scans.tripScan(std.DR1, trip.id, { stopId: stop, action: 'TAKE_BACK', code: w.ag(3).qrCode, returnState: 'EMPTY' }).expect(201);
    await scans.finishStop(std.DR1, trip.id, stop).expect(200);
    // Before the day-end it really is on the van: the run can't finish, the shop expects it back.
    expect((await scans.finishTrip(std.DR1, trip.id, {}).set(NEW_DRIVER_APP)).body.code).toBe('TRIP_VAN_NOT_EMPTY');

    const day = await submittedDay(w, { 'AG-C0003': { where: 'Missing', why: 'Driver lost it on the way back' } });
    await approve(w, day.id, day.version);
    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: w.ag(3).id } })).toMatchObject({ custodyType: 'VEHICLE', custodyId: vanOf(w, 'DR1'), state: 'LOST' });

    // On the van's record it is still there, as Lost.
    const home = await scans.driverHome(std.DR1).expect(200);
    expect(home.body.van.total).toBe(1);
    const mine = await http(app).get(`${API}/inventory/my-vehicle`).set(authHeader(std.DR1.actor)).expect(200);
    expect(mine.body.cylinders).toEqual([expect.objectContaining({ shortCode: 'AG-C0003', state: 'LOST' })]);
    const view = await scans.trip(std.DR1, trip.id).expect(200);
    expect({ total: view.body.van.total, cylinders: view.body.van.cylinders, actions: view.body.allowedActions }).toEqual({ total: 1, cylinders: [], actions: ['COMPLETE'] });
    // But nothing waits for it: the shop's list, the run's finish, the 03:00 check, the van's driver.
    expect((await scans.storeIncoming(std.DA).expect(200)).body.vans).toEqual([]);
    await scans.finishTrip(std.DR1, trip.id, {}).expect(200);
    expect(await app.get(VanCheckJob).run()).toEqual({ vans: 0, plates: [] });
    await http(app).patch(`${API}/drivers/${std.DR1.id}/vehicle`).set(authHeader(std.SA1.actor)).send({ vehicleId: null }).expect(200);

    // Found later: the shop receives it by its number; it keeps its LOST state until a day-end fixes it.
    const found = await scans.storeScan(std.DA, { code: 'AG-C0003', entryMethod: 'TYPED' });
    expect(found.status).toBe(201);
    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: w.ag(3).id } })).toMatchObject({ custodyType: 'STORE', state: 'LOST' });
  });

  it('REV23 holder-scans-05 a lost cylinder found at a customer and taken back still counts on the van', async () => {
    const { std, scans } = w;
    await placeWithCustomer({ cylinder: w.ag(11), client: std.C1, actor: std.DR1 });
    await setCylinderState(w.ag(11).id, 'LOST');
    const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] });
    const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
    const stop = trip.deliveryStopFor(order.id);
    await scans.tripScan(std.DR1, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    await scans.finishStop(std.DR1, trip.id, trip.pickupStopId).expect(200);
    await scans.tripScan(std.DR1, trip.id, { stopId: stop, action: 'HANDOVER', code: w.ag(1).qrCode }).expect(201);
    await scans.tripScan(std.DR1, trip.id, { stopId: stop, action: 'TAKE_BACK', code: w.ag(11).qrCode, returnState: 'EMPTY' }).expect(201);
    await scans.finishStop(std.DR1, trip.id, stop).expect(200);
    const finish = await scans.finishTrip(std.DR1, trip.id, {}).set(NEW_DRIVER_APP);
    expect({ status: finish.status, code: finish.body.code, cylinders: finish.body.details?.cylinders }).toEqual({
      status: 409,
      code: 'TRIP_VAN_NOT_EMPTY',
      cylinders: [expect.objectContaining({ shortCode: 'AG-C0011', state: 'LOST', came: 'TAKEN_BACK' })],
    });
    expect((await scans.storeIncoming(std.DA).expect(200)).body.vans).toHaveLength(1);
  });

  it('REV23 holder-scans-07 a re-sent sheet after a reopen keeps the applied links and adds the found cylinder once', async () => {
    const { std, calls } = w;
    const cylinders = () => w.db.cylinder.count({ where: { distributorId: std.DA.id } });
    const before = await cylinders();
    const filled = await fill(await download(w), { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } }, {
      extra: [{ number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }],
    });
    const first = await upload(w, filled);
    expect(first.status).toBe(200);
    await calls.submit(std.DA, D21, { version: first.body.version }).expect(200);
    const day = (await dayCloseOf(std.DA.id, D21))!;
    const firstApproval = await approve(w, day.id, first.body.version);
    expect(firstApproval.body.registered.map((c: { shortCode: string }) => c.shortCode)).toEqual(['AG-C0036']);
    const linked = (await dayCloseLines(day.id)).filter((line) => line.appliedEventId);
    expect(linked.map((line) => line.sheetKey).sort()).toEqual(['AG-C0005', 'AG-C0099']);

    // Reopened, and the same filled file sent again: the links move to the new lines.
    await calls.reopen(std.SA1, day.id, { reason: 'Recount the 15 kg cylinders' }).expect(200);
    const again = await upload(w, filled);
    expect(again.status).toBe(200);
    const lines = await dayCloseLines(day.id);
    const byKey = new Map(lines.map((line) => [line.sheetKey, line]));
    expect(byKey.get('AG-C0099')).toMatchObject({ diff: 'UNKNOWN_CYLINDER', appliedEventId: linked.find((l) => l.sheetKey === 'AG-C0099')?.appliedEventId });
    // AG-C0005 is Damaged in the app now: its row matches, and keeps its fix's link.
    expect(byKey.get('AG-C0005')).toMatchObject({ diff: 'MATCH', appliedEventId: linked.find((l) => l.sheetKey === 'AG-C0005')?.appliedEventId });
    expect((await history('AG-C0036')).events.find((event) => event.action === 'REGISTERED')?.dayEnd).toEqual({ businessDate: D21 });
    expect((await history('AG-C0005')).events.find((event) => event.action === 'ADJUSTED')?.dayEnd).toEqual({ businessDate: D21 });

    // The office review lists the extra number, but there is nothing to add any more.
    await calls.submit(std.DA, D21, { version: again.body.version }).expect(200);
    const review = await calls.adminDay(std.SA1, day.id).expect(200);
    expect(review.body.lines.map((line: { shortCode: string }) => line.shortCode)).toEqual(['AG-C0099']);
    expect(review.body.fixesToApply).toEqual([]);
    const secondApproval = await approve(w, day.id, again.body.version);
    expect(secondApproval.body.registered).toEqual([]);
    expect(await cylinders()).toBe(before + 1);
    const approved = await w.db.auditLog.findFirstOrThrow({ where: { action: 'day.approve', resourceId: day.id }, orderBy: { createdAt: 'desc' } });
    expect(approved.diff).toMatchObject({ applied: 0, registered: 0, unchanged: 1, registeredCodes: [] });

    // Reopened again, a fresh sheet (it lists AG-C0036 now) with AG-C0099 put on Extra once more: still once.
    await calls.reopen(std.SA1, day.id, { reason: 'One more recount please' }).expect(200);
    const fresh = await fill(await download(w), {}, { extra: [{ number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }] });
    const third = await upload(w, fresh);
    expect(third.status).toBe(200);
    await calls.submit(std.DA, D21, { version: third.body.version }).expect(200);
    expect((await approve(w, day.id, third.body.version)).body.registered).toEqual([]);
    expect(await cylinders()).toBe(before + 1);
    expect((await history('AG-C0036')).events.find((event) => event.action === 'REGISTERED')?.dayEnd).toEqual({ businessDate: D21 });
  });
});
