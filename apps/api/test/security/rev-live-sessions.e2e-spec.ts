/**
 * Regression tests for the review findings on live sessions (API_CONTRACT §3.3, §7.14):
 * - security-02: an office socket on `/drivers` hears every driver, so it must end with its access
 *   token and with its session, whichever way the session ends;
 * - security-04: a driver whose user isn't ACTIVE can't go online, whatever path the change takes.
 */
import type { INestApplication } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app';
import { authHeader, signAccessToken } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { DriversGateway } from '../../src/modules/drivers/drivers.gateway';
import { DriversService } from '../../src/modules/drivers/drivers.service';
import {
  advanceClock,
  APP_BOOT_TIMEOUT_MS,
  connectDrivers,
  emitWithAck,
  forgetSessions,
  listen,
  pause,
  setPassword,
  TEST_TIMEOUT_MS,
  useMemoryRateLimits,
  type SocketEvents,
} from './security-helpers';

jest.setTimeout(TEST_TIMEOUT_MS);

describeDb('live sessions on the /drivers socket', () => {
  let app: INestApplication;
  let baseUrl: string;
  let std: StandardData;
  const open: SocketEvents[] = [];
  const db = () => getTestPrisma();

  const connect = (token: string) => {
    const client = connectDrivers(baseUrl, token);
    open.push(client);
    return client;
  };
  const errorsOf = (client: SocketEvents) => client.events.filter((e) => e.event === 'error').map((e) => e.payload);
  /** Runs the gateway's 30-second office check now. */
  const recheckOffice = () => (app.get(DriversGateway) as unknown as { recheckOffice(): Promise<void> }).recheckOffice();

  beforeAll(async () => {
    app = await createTestApp();
    baseUrl = await listen(app);
    useMemoryRateLimits(app);
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
  });

  afterEach(() => {
    for (const client of open.splice(0)) client.socket.disconnect();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV security-02 a role change through the API ends the office socket at once', async () => {
    const office = connect(signAccessToken(std.SA2.actor));
    await office.next('drivers:snapshot');
    await http(app)
      .patch(`/api/v1/users/${std.SA2.id}/role`)
      .set(authHeader(std.SA1.actor))
      .send({ value: 'ADMIN', reason: 'Moved to the branch office' })
      .expect(200);
    await office.next('disconnect');
    expect(errorsOf(office)).toEqual([{ code: 'AUTH_SESSION_REVOKED' }]);
  });

  it('REV security-02 a re-check ends only the old session: one\'s own new password keeps the new socket', async () => {
    await setPassword(std.SA1.id, 'Office#Before2026');
    const before = connect(signAccessToken(std.SA1.actor));
    await before.next('drivers:snapshot');
    const changed = await http(app)
      .post('/api/v1/auth/change-password')
      .set(authHeader(std.SA1.actor))
      .send({ currentPassword: 'Office#Before2026', newPassword: 'Office#After2026' })
      .expect(200);
    // The socket of the old token (old `tv`) is dropped ...
    await before.next('disconnect');
    expect(errorsOf(before)).toEqual([{ code: 'AUTH_SESSION_REVOKED' }]);
    // ... the one opened with the new token stays, also through a later re-check of the same user.
    const after = connect(changed.body.accessToken as string);
    await after.next('drivers:snapshot');
    forgetSessions(app, std.SA1.id);
    await recheckOffice();
    await pause(300);
    expect({ closed: after.closed(), errors: errorsOf(after) }).toEqual({ closed: false, errors: [] });
  });

  it('REV security-02 the 30-second check drops an office socket whose session ended outside this API', async () => {
    const sa1 = connect(signAccessToken(std.SA1.actor));
    const sa2 = connect(signAccessToken(std.SA2.actor));
    await Promise.all([sa1.next('drivers:snapshot'), sa2.next('drivers:snapshot')]);
    // Suspended by another process (or by hand): this API's session cache isn't told.
    await db().user.update({ where: { id: std.SA2.id }, data: { status: UserStatus.SUSPENDED, tokenVersion: { increment: 1 } } });
    await recheckOffice();
    await pause(200);
    expect(sa2.closed()).toBe(false); // the cached session row is trusted for up to 60 seconds (§3.3)
    advanceClock(61_000);
    await recheckOffice();
    await sa2.next('disconnect');
    expect(errorsOf(sa2)).toEqual([{ code: 'AUTH_SESSION_REVOKED' }]);
    expect({ closed: sa1.closed(), errors: errorsOf(sa1) }).toEqual({ closed: false, errors: [] });
  });

  it('REV security-02 a driver\'s socket can\'t report a position once its token has expired', async () => {
    const before = await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } });
    const dr1 = connect(signAccessToken(std.DR1.actor, { expiresIn: 2 }));
    await dr1.next('connect');
    await pause(2_500);
    await emitWithAck(dr1.socket, 'location:update', { lat: 31.51, lng: 74.21 }, 1_000).catch(() => undefined);
    await dr1.next('disconnect');
    expect(errorsOf(dr1)).toEqual([{ code: 'AUTH_TOKEN_INVALID' }]);
    const after = await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } });
    expect(after.currentLocationUpdatedAt).toEqual(before.currentLocationUpdatedAt);
  });

  it('REV security-04 a driver whose user isn\'t ACTIVE can\'t go online, and nothing changes', async () => {
    await db().user.update({ where: { id: std.DR1.userId }, data: { status: UserStatus.SUSPENDED } });
    await expect(app.get(DriversService).applyOnline(std.DR1.id, true)).rejects.toMatchObject({ code: 'ASSIGN_DRIVER_NOT_AVAILABLE' });
    expect(await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).toMatchObject({ isOnline: false });
    expect(await db().driverShift.count({ where: { driverId: std.DR1.id, endedAt: null } })).toBe(0);
    // Going offline still works, and an ACTIVE driver goes online as before.
    await app.get(DriversService).applyOnline(std.DR1.id, false);
    await db().user.update({ where: { id: std.DR1.userId }, data: { status: UserStatus.ACTIVE } });
    await app.get(DriversService).applyOnline(std.DR1.id, true);
    expect(await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).toMatchObject({ isOnline: true });
  });
});
