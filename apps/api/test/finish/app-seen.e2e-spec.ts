/**
 * OFF-020: the office's Drivers and Distributors lists say which phones still need the app update
 * (API_CONTRACT §1.4 `AppStatus`, §7.2, §7.3, §8.5 step 10; DATA_MODEL §5.6). Every signed-in shop or driver
 * call records the app it came from (`X-App-Version`, or "0.1.0" for the installed 0.1.0 JS, which sends
 * none); the lists compare it with `app.minVersion`. This turns the switch-over's phone-by-phone Help check
 * into one look at the website.
 */
import type { INestApplication } from '@nestjs/common';
import type { AppSeenDto, DistributorDto, DriverOfficeDto } from '@smartfleet/shared-types';
import { AppSeenService } from '../../src/common/app-seen/app-seen.service';
import { createTestApp } from '../helpers/app';
import { NEW_DRIVER_APP, NEW_SHOP_APP } from '../helpers/app-headers';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

jest.setTimeout(180_000);

const API = '/api/v1';
const NOT_SEEN: AppSeenDto = { status: 'NOT_SEEN', version: null, seenAt: null };

describeDb('OFF-020 the office sees which phones still need the app update', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const office = () => authHeader(std.SA1.actor);

  async function drivers(): Promise<Map<string, AppSeenDto | undefined>> {
    const res = await http(app).get(`${API}/drivers`).set(office()).expect(200);
    return new Map((res.body as DriverOfficeDto[]).map((d) => [d.id, d.app]));
  }

  async function distributors(): Promise<Map<string, AppSeenDto | undefined>> {
    const res = await http(app).get(`${API}/distributors`).set(office()).expect(200);
    return new Map((res.body as DistributorDto[]).map((d) => [d.id, d.app]));
  }

  async function setMinimum(value: string): Promise<void> {
    for (const variant of ['driver', 'distributor']) {
      await http(app).patch(`${API}/settings/app.minVersion.${variant}`).set(office()).send({ value, reason: 'Switch-over phone check' }).expect(200);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
  }, 120_000);

  beforeEach(async () => {
    await resetDb();
    app.get(AppSeenService).forgetAll();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('OFF-020 each driver and distributor row shows the app their latest call came from, against app.minVersion', async () => {
    // Step 1: nobody has called since this release.
    expect([...(await drivers()).values()]).toEqual([NOT_SEEN, NOT_SEEN]);
    expect([...(await distributors()).values()]).toEqual([NOT_SEEN, NOT_SEEN]);

    // Step 2: Kashif on the Inc 2/3 driver app; Ahmed Gas still on the installed 0.1.0 JS (no X-App-* header).
    const usersBefore = await db().user.findMany({ where: { id: { in: [std.DA.userId, std.DR1.userId] } }, select: { id: true, updatedAt: true } });
    await http(app).get(`${API}/driver/home`).set(authHeader(std.DR1.actor)).set(NEW_DRIVER_APP).expect(200);
    await http(app).get(`${API}/distributor/home`).set(authHeader(std.DA.actor)).expect(200);
    let driversNow = await drivers();
    let shopsNow = await distributors();
    expect(driversNow.get(std.DR1.id)).toEqual({ status: 'UP_TO_DATE', version: NEW_DRIVER_APP['X-App-Version'], seenAt: expect.any(String) });
    expect(shopsNow.get(std.DA.id)).toEqual({ status: 'UP_TO_DATE', version: '0.1.0', seenAt: expect.any(String) });
    expect(driversNow.get(std.DR2.id)).toEqual(NOT_SEEN);
    expect(shopsNow.get(std.DB.id)).toEqual(NOT_SEEN);
    expect(Date.now() - Date.parse(driversNow.get(std.DR1.id)?.seenAt ?? '')).toBeLessThan(60_000);

    // Step 3: the switch-over raises the minimum to the over-the-air release.
    await setMinimum(NEW_SHOP_APP['X-App-Version']);
    driversNow = await drivers();
    shopsNow = await distributors();
    expect(shopsNow.get(std.DA.id)).toMatchObject({ status: 'NEEDS_UPDATE', version: '0.1.0' });
    expect(driversNow.get(std.DR1.id)).toMatchObject({ status: 'UP_TO_DATE' });

    // Step 4: the 0.1.0 JS is told to restart, and still reads "needs update"; after the restart it is up to date at once.
    const refused = await http(app).get(`${API}/distributor/home`).set(authHeader(std.DA.actor)).expect(426);
    expect(refused.body.code).toBe('APP_RESTART_TO_UPDATE');
    expect((await distributors()).get(std.DA.id)).toMatchObject({ status: 'NEEDS_UPDATE', version: '0.1.0' });
    await http(app).get(`${API}/distributor/home`).set(authHeader(std.DA.actor)).set(NEW_SHOP_APP).expect(200);
    expect((await distributors()).get(std.DA.id)).toMatchObject({ status: 'UP_TO_DATE', version: NEW_SHOP_APP['X-App-Version'] });

    // Step 5: the columns are written, updated_at is not; the shop's and the driver's own reads carry no app; the office records nothing.
    const rows = await db().user.findMany({
      where: { id: { in: [std.DA.userId, std.DR1.userId, std.SA1.id] } },
      select: { id: true, appVariant: true, appVersion: true, appSeenAt: true, updatedAt: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(std.DA.userId)).toMatchObject({ appVariant: 'distributor', appVersion: NEW_SHOP_APP['X-App-Version'], appSeenAt: expect.any(Date) });
    expect(byId.get(std.DR1.userId)).toMatchObject({ appVariant: 'driver', appVersion: NEW_DRIVER_APP['X-App-Version'], appSeenAt: expect.any(Date) });
    expect(byId.get(std.SA1.id)).toMatchObject({ appVariant: null, appVersion: null, appSeenAt: null });
    for (const before of usersBefore) expect(byId.get(before.id)?.updatedAt).toEqual(before.updatedAt);
    const me = await http(app).get(`${API}/distributors/me`).set(authHeader(std.DA.actor)).set(NEW_SHOP_APP).expect(200);
    expect(me.body).not.toHaveProperty('app');
    const self = await http(app).get(`${API}/drivers/${std.DR1.id}`).set(authHeader(std.DR1.actor)).set(NEW_DRIVER_APP).expect(200);
    expect(self.body).not.toHaveProperty('app');
    const one = await http(app).get(`${API}/drivers/${std.DR1.id}`).set(office()).expect(200);
    expect(one.body.app).toMatchObject({ status: 'UP_TO_DATE' });
    const page = await http(app).get(`${API}/distributors/${std.DA.id}`).set(office()).expect(200);
    expect(page.body.app).toMatchObject({ status: 'UP_TO_DATE' });

    await setMinimum('0.0.0');
  });

  it('OFF-020 each list compares with the minimum of its own app', async () => {
    await http(app).get(`${API}/driver/home`).set(authHeader(std.DR2.actor)).set({ 'X-App-Variant': 'driver', 'X-App-Version': '0.1.0' }).expect(200);
    await http(app).get(`${API}/distributor/home`).set(authHeader(std.DB.actor)).set({ 'X-App-Variant': 'distributor', 'X-App-Version': '0.1.0' }).expect(200);
    // Only the driver minimum moves: Imran needs the update, Bilal Gas doesn't.
    await http(app).patch(`${API}/settings/app.minVersion.driver`).set(office()).send({ value: '0.1.1', reason: 'Driver phones first' }).expect(200);
    expect((await drivers()).get(std.DR2.id)).toMatchObject({ status: 'NEEDS_UPDATE', version: '0.1.0' });
    expect((await distributors()).get(std.DB.id)).toMatchObject({ status: 'UP_TO_DATE', version: '0.1.0' });
    await http(app).patch(`${API}/settings/app.minVersion.driver`).set(office()).send({ value: '0.0.0', reason: 'Back to the default' }).expect(200);
  });
});
