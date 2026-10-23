/**
 * The `/drivers` socket (API_CONTRACT §7.14): SEC-015 and SEC-016.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { authHeader, signAccessToken } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { DriversService } from '../../src/modules/drivers/drivers.service';
import { advanceClock, connectDrivers, emitWithAck, listen, pause, type SocketEvents, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

interface Point {
  lat: number;
  lng: number;
}

describeDb('drivers socket', () => {
  let app: INestApplication;
  let baseUrl: string;
  let std: StandardData;
  const open: SocketEvents[] = [];
  const db = () => getTestPrisma();

  const connect = (token: string | null) => {
    const client = connectDrivers(baseUrl, token);
    open.push(client);
    return client;
  };

  async function locationOf(driverId: string): Promise<Point | null> {
    const rows = await db().$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT ST_Y(current_location) AS lat, ST_X(current_location) AS lng FROM drivers WHERE id = ${driverId}::uuid`;
    return rows[0]?.lat == null ? null : { lat: Number(rows[0].lat), lng: Number(rows[0].lng) };
  }

  beforeAll(async () => {
    app = await createTestApp();
    baseUrl = await listen(app);
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

  it('SEC-015 the /drivers socket accepts only a valid driver or office session, and only the office hears locations', async () => {
    // Steps 1-2: no token, garbage, an expired token, then a distributor.
    const refused: Array<[string | null, string]> = [
      [null, 'AUTH_TOKEN_INVALID'],
      ['garbage', 'AUTH_TOKEN_INVALID'],
      [signAccessToken(std.DR1.actor, { expiresIn: -10 }), 'AUTH_TOKEN_INVALID'],
      [signAccessToken(std.DA.actor), 'PERMISSION_DENIED'],
    ];
    for (const [token, code] of refused) {
      const client = connect(token);
      expect(await client.next('error')).toEqual({ code });
      await client.next('disconnect');
      expect(client.events.some((e) => e.event === 'drivers:snapshot')).toBe(false);
    }
    // Step 3.
    await db().driver.update({ where: { id: std.DR2.id }, data: { isOnline: true } });
    await app.get(DriversService).applyLocation(std.DR2.id, 31.51, 74.21);
    const dr1 = connect(signAccessToken(std.DR1.actor));
    const dr2 = connect(signAccessToken(std.DR2.actor));
    const office = connect(signAccessToken(std.SA1.actor));
    await Promise.all([dr1.next('connect'), dr2.next('connect'), office.next('connect')]);
    const snapshot = (await office.next('drivers:snapshot')) as Array<{ id: string }>;
    expect(snapshot.map((row) => row.id)).toEqual([std.DR2.id]);
    // Step 4.
    expect(await emitWithAck(dr1.socket, 'location:update', { lat: 31.5204, lng: 74.3587 })).toEqual({ ok: true });
    expect(await office.next('driver:location')).toMatchObject({ driverId: std.DR1.id, lat: 31.5204, lng: 74.3587 });
    await pause(300);
    expect(dr2.events.some((e) => e.event === 'driver:location')).toBe(false);
    expect(dr1.events.some((e) => e.event === 'driver:location')).toBe(false);
    expect([dr1, dr2, office].every((client) => !client.closed())).toBe(true);
    // Step 5: DR1 is suspended; a reconnect with the old token is refused.
    await http(app)
      .patch(`/api/v1/users/${std.DR1.userId}/status`)
      .set(authHeader(std.SA1.actor))
      .send({ value: 'SUSPENDED', reason: 'Socket revoke test' })
      .expect(200);
    const again = connect(signAccessToken(std.DR1.actor));
    expect(await again.next('error')).toEqual({ code: 'AUTH_SESSION_REVOKED' });
    await again.next('disconnect');
    // The open socket of the suspended driver can't report a position either.
    expect(await emitWithAck(dr1.socket, 'location:update', { lat: 31.53, lng: 74.36 }).catch(() => ({ ok: false }))).toMatchObject({ ok: false });
  });

  it('SEC-016 a driver\'s location is taken only from that driver\'s own session', async () => {
    const L2 = { lat: 31.51, lng: 74.21 };
    await db().driver.updateMany({ where: { id: { in: [std.DR1.id, std.DR2.id] } }, data: { isOnline: true } });
    await app.get(DriversService).applyLocation(std.DR2.id, L2.lat, L2.lng);
    const dr1 = connect(signAccessToken(std.DR1.actor));
    const office = connect(signAccessToken(std.SA1.actor));
    await Promise.all([dr1.next('connect'), office.next('drivers:snapshot')]);

    // Step 1: the payload's driverId is ignored.
    expect(await emitWithAck(dr1.socket, 'location:update', { driverId: std.DR2.id, lat: 31.5204, lng: 74.3587 })).toEqual({ ok: true });
    expect(await office.next('driver:location')).toMatchObject({ driverId: std.DR1.id });
    expect(await locationOf(std.DR1.id)).toEqual({ lat: 31.5204, lng: 74.3587 });
    expect(await locationOf(std.DR2.id)).toEqual(L2);
    // Step 2.
    expect(await emitWithAck(dr1.socket, 'online:set', { driverId: std.DR2.id, isOnline: false })).toEqual({ ok: true });
    const online = async (id: string) => (await db().driver.findUniqueOrThrow({ where: { id } })).isOnline;
    expect({ dr1: await online(std.DR1.id), dr2: await online(std.DR2.id) }).toEqual({ dr1: false, dr2: true });
    // Step 3: three updates within 5 seconds; only the first is stored and broadcast.
    advanceClock(6_000);
    const before = office.events.filter((e) => e.event === 'driver:location').length;
    const acks = [];
    for (const [i, lat] of [31.531, 31.532, 31.533].entries()) {
      acks.push(await emitWithAck(dr1.socket, 'location:update', { lat, lng: 74.36 + i / 1000 }));
    }
    expect(acks).toEqual([{ ok: true }, { ok: false, code: 'RATE_LIMITED' }, { ok: false, code: 'RATE_LIMITED' }]);
    await pause(300);
    expect(office.events.filter((e) => e.event === 'driver:location').length - before).toBe(1);
    expect(await locationOf(std.DR1.id)).toEqual({ lat: 31.531, lng: 74.36 });
    // Step 4.
    const dr1Http = authHeader(std.DR1.actor);
    expect((await http(app).patch(`/api/v1/drivers/${std.DR2.id}/location`).set(dr1Http).send({ lat: 31.5, lng: 74.3 }).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await http(app).patch(`/api/v1/drivers/${std.DR2.id}/online`).set(dr1Http).send({ isOnline: false }).expect(404)).body.code).toBe('NOT_FOUND');
    // The office can't report a driver's position either.
    expect((await http(app).patch(`/api/v1/drivers/${std.DR2.id}/location`).set(authHeader(std.SA1.actor)).send({ lat: 31.5, lng: 74.3 }).expect(403)).body.code).toBe(
      'PERMISSION_DENIED',
    );
    // Step 5.
    const viewed = await http(app).get(`/api/v1/drivers/${std.DR2.id}`).set(authHeader(std.SA1.actor)).expect(200);
    expect(viewed.body).toMatchObject({ isOnline: true, currentLocation: L2 });
    await http(app).get(`/api/v1/drivers/${std.DR1.id}`).set(authHeader(std.SA1.actor)).expect(200);
    // A driver's own REST update works.
    expect((await http(app).patch(`/api/v1/drivers/${std.DR1.id}/location`).set(dr1Http).send({ lat: 31.52, lng: 74.22 }).expect(200)).body).toMatchObject({
      ok: true,
      zoneId: std.zones.North.id,
    });
  });

  it('SEC-016 an online:set that arrives too soon is applied when the 5-second window ends', async () => {
    await db().driver.update({ where: { id: std.DR1.id }, data: { isOnline: false } });
    const dr1 = connect(signAccessToken(std.DR1.actor));
    await dr1.next('connect');
    expect(await emitWithAck(dr1.socket, 'online:set', { isOnline: true })).toEqual({ ok: true });
    expect(await emitWithAck(dr1.socket, 'online:set', { isOnline: false })).toEqual({ ok: true });
    expect((await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).isOnline).toBe(true);
    await pause(5_500);
    expect((await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).isOnline).toBe(false);
  });
});
