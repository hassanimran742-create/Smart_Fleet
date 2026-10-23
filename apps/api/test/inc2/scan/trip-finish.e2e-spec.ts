/**
 * [Inc 2] "Finish trip", leftovers, the 03:00 van check and a loaded van's driver change (API_CONTRACT
 * §9.3, §9.5, §9.9): DRV-038, DRV-039, DRV-040 and DRV-043.
 */
import type { INestApplication } from '@nestjs/common';
import { getTestPrisma } from '../../helpers/db';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { VanCheckJob } from '../../../src/modules/custody/van-check.job';
import { assertVansEmptyForDriverChange } from '../../../src/modules/custody/van';
import { buildWorld, messageOf, X1, X2, type World } from './support/world';
import { itWhenReady } from './support/waiting';

jest.setTimeout(180_000);

describeDb('inc2 scan: finish trip, leftovers and the van check', () => {
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

  async function vanAlerts(vehicleId: string, status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' = 'OPEN') {
    return getTestPrisma().alert.findMany({ where: { alertType: 'VAN_NOT_EMPTY', resourceId: vehicleId, status } });
  }

  it('DRV-038 "Finish trip" needs every stop closed and an empty van', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 1 },
      { size: '45.4', full: 1 },
    ]);
    const x2 = await w.placeOrder(X2, 'C2');
    expect(await w.balance()).toBe(412_000n);
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(x2, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31, 21, 22, 23]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);

    const open = await scans.finishTrip(std.DR1, t1.id, {});
    expect(open.status).toBe(409);
    expect(open.body).toMatchObject({ code: 'TRIP_STOPS_OPEN', message: 'Finish every stop first.' });

    await w.hand(std.DR1, t1, x2, [21, 22, 23]);
    expect((await w.finishVisit(std.DR1, t1, x2)).status).toBe(200);
    const loaded = await scans.finishTrip(std.DR1, t1.id, {});
    expect(loaded.status).toBe(409);
    expect(loaded.body).toMatchObject({ code: 'TRIP_VAN_NOT_EMPTY', message: messageOf('TRIP_VAN_NOT_EMPTY', { count: 1 }) });
    expect(loaded.body.details).toEqual({
      count: 1,
      cylinders: [{ shortCode: 'AG-C0011', sizeLabel: '11.8 kg', state: 'EMPTY', came: 'TAKEN_BACK' }],
      leftoversAllowed: false,
    });
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('IN_PROGRESS');

    expect((await w.receive(11)).status).toBe(201);
    const done = await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(await w.balance()).toBe(412_000n);

    const again = await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body.status).toBe('COMPLETED');
    await w.walletClean();
  });

  it('DRV-039 Finishing a run with cylinders left on the van follows trip.allowFinishWithLeftovers', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await scans.failOrder(std.DR1, x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    const reason = 'Store closed when I got back';

    const off = await scans.finishTrip(std.DR1, t1.id, { leftoverReason: reason });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('TRIP_VAN_NOT_EMPTY');
    expect(off.body.details).toMatchObject({ count: 3, leftoversAllowed: false });
    expect(off.body.details.cylinders.map((c: { came: string }) => c.came)).toEqual(['NOT_DELIVERED', 'NOT_DELIVERED', 'NOT_DELIVERED']);

    await w.as(std.SA1).patch('/settings/trip.allowFinishWithLeftovers').send({ value: true, reason: 'Late runs' }).expect(200);
    const setting = await w.db.auditLog.findFirstOrThrow({ where: { action: 'setting.update' }, orderBy: { createdAt: 'desc' } });
    expect(setting.diff).toMatchObject({ key: 'trip.allowFinishWithLeftovers', from: false, to: true });
    expect(setting.reason).toBe('Late runs');

    const noReason = await scans.finishTrip(std.DR1, t1.id, {});
    expect(noReason.status).toBe(409);
    expect(noReason.body.details).toMatchObject({ count: 3, leftoversAllowed: true });
    const tooShort = await scans.finishTrip(std.DR1, t1.id, { leftoverReason: 'Late' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.code).toBe('VALIDATION_FAILED');

    const done = await scans.finishTrip(std.DR1, t1.id, { leftoverReason: reason }).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', leftoverReason: reason });

    const list = await w.as(std.SA1).get('/alerts?type=VAN_NOT_EMPTY&status=OPEN').expect(200);
    const listed = (list.body as Array<{ alertType: string; resourceId: string }>).filter((a) => a.alertType === 'VAN_NOT_EMPTY');
    expect(listed).toHaveLength(1);
    const alerts = await vanAlerts(std.DR1.vehicleId as string);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: 'WARNING', resourceType: 'Vehicle' });
    expect(alerts[0].context).toMatchObject({ vehicleId: std.DR1.vehicleId, plateNo: 'LEA-101', count: 3, tripId: t1.id, leftoverReason: reason });

    for (const n of [1, 2, 31]) {
      const res = await w.receive(n);
      expect(res.status).toBe(201);
      expect(await w.holder(n)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });
    }
    await w.as(std.SA1).patch('/settings/trip.allowFinishWithLeftovers').send({ value: false, reason: 'Back to normal' }).expect(200);
    expect(await w.balance()).toBe(452_000n);
    await w.walletClean();
  });

  it('DRV-043 The 03:00 van check raises a van-not-empty alert only for vans still holding cylinders', async () => {
    const { std, scans } = w;
    await w.setting('trip.allowFinishWithLeftovers', true);
    // DR1's run ends with AG-C0001 still on LEA-101 (reason given).
    const a = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const t1 = await w.assign(a, std.DR1);
    await w.load(std.DR1, t1, [1]);
    await w.doneLoading(std.DR1, t1);
    await scans.failOrder(std.DR1, a.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    await scans.finishTrip(std.DR1, t1.id, { leftoverReason: 'Shop closed at night' }).expect(200);
    // DR2's run ends with an empty van.
    const b = await w.placeOrder([{ size: '11.8', full: 1 }], 'C2');
    const t2 = await w.assign(b, std.DR2);
    await w.load(std.DR2, t2, [3]);
    await w.doneLoading(std.DR2, t2);
    await w.hand(std.DR2, t2, b, [3]);
    expect((await w.finishVisit(std.DR2, t2, b)).status).toBe(200);
    await scans.finishTrip(std.DR2, t2.id, {}).expect(200);
    const balance = await w.balance();
    const ledgerRows = await w.db.ledgerEntry.count();

    for (const alert of await vanAlerts(std.DR1.vehicleId as string)) {
      await w.as(std.SA1).patch(`/alerts/${alert.id}/resolve`).expect(200);
    }
    const job = app.get(VanCheckJob);
    const run = await job.run();
    expect(run).toEqual({ vans: 1, plates: ['LEA-101'] });
    expect(await vanAlerts(std.DR1.vehicleId as string)).toHaveLength(1);
    expect(await vanAlerts(std.DR2.vehicleId as string)).toHaveLength(0);

    await job.run();
    const once = await vanAlerts(std.DR1.vehicleId as string);
    expect(once).toHaveLength(1);
    expect(once[0].context).toMatchObject({ plateNo: 'LEA-101', count: 1, tripId: t1.id, leftoverReason: 'Shop closed at night' });
    expect(await w.balance()).toBe(balance);
    expect(await w.db.ledgerEntry.count()).toBe(ledgerRows);

    await w.as(std.SA1).patch(`/alerts/${once[0].id}/resolve`).expect(200);
    await job.run();
    const fresh = await vanAlerts(std.DR1.vehicleId as string);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(once[0].id);

    // An acknowledged alert is still the van's one unresolved alert: a new raise only refreshes it.
    await w.as(std.SA1).patch(`/alerts/${fresh[0].id}/acknowledge`).expect(200);
    await job.run();
    expect(await vanAlerts(std.DR1.vehicleId as string)).toHaveLength(0);
    expect(await vanAlerts(std.DR1.vehicleId as string, 'ACKNOWLEDGED')).toHaveLength(1);
  });

  it('DRV-040 (scan lane part) the guard refuses a driver change while the van holds cylinders, and lets it through once empty', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await expect(assertVansEmptyForDriverChange(w.db, [std.DR1.vehicleId])).rejects.toMatchObject({ code: 'VEHICLE_HAS_CYLINDERS', details: { count: 3 } });
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await expect(assertVansEmptyForDriverChange(w.db, [std.DR1.vehicleId, null])).resolves.toBeUndefined();
  });

  itWhenReady('drivers-vehicle-guard', 'DRV-040 A loaded van\'s driver can\'t be changed until the store has scanned everything in', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    const before = await w.db.auditLog.count({ where: { action: 'driver.update' } });

    const res = await w.as(std.SA1).patch(`/drivers/${std.DR1.id}/vehicle`).send({ vehicleId: null });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'VEHICLE_HAS_CYLINDERS', message: 'This van still has cylinders on it (3). Unload at the store first.' });
    expect(res.body.details).toMatchObject({ count: 3 });
    expect((await w.db.driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).currentVehicleId).toBe(std.DR1.vehicleId);
    expect(await w.db.auditLog.count({ where: { action: 'driver.update' } })).toBe(before);

    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    await w.as(std.SA1).patch(`/drivers/${std.DR1.id}/vehicle`).send({ vehicleId: null }).expect(200);
    expect(await w.db.auditLog.count({ where: { action: 'driver.update' } })).toBe(before + 1);
  });
});
