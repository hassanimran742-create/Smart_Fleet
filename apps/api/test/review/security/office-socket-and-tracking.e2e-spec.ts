/**
 * Security review (Increment 1): live driver positions reach callers whose access has ended.
 * Each test asserts the secure behaviour, so it FAILS on today's code; the failure shows the hole.
 *
 * REV-SEC-01 An office (SUPER_ADMIN) socket on /drivers is checked only at connect. After the office
 *            user is suspended (or the access token expires) the open socket keeps receiving every
 *            driver's `driver:location`, although every HTTP call of that session already gets 401.
 * REV-SEC-02 `GET /orders/:id/tracking` returns the driver's live position for any order the
 *            distributor owns that ever had a driver, also once it is DELIVERED or CANCELLED (a
 *            cancel before the start is free: full refund). The driver then works for the other
 *            distributor, so the first one watches the driver stand at the other distributor's
 *            customer's door. The installed 0.1.0 shop app opens this screen for every order in its
 *            History tab (af889bf OrderHistoryScreen.tsx:58 → TrackOrderScreen, polled every 10 s).
 * REV-SEC-04 An early `online:set` is deferred and applied 5 s later without a session check, so
 *            it undoes an archive made in between: an archived (SUSPENDED) driver is put back online
 *            with a new open shift, and the office map is told he is online.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { authHeader, signAccessToken } from '../../helpers/auth';
import { getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, x1OrderBody, x2OrderBody, type StandardData } from '../../helpers/standard-data';
import {
  APP_BOOT_TIMEOUT_MS,
  connectDrivers,
  emitWithAck,
  listen,
  pause,
  TEST_TIMEOUT_MS,
  type SocketEvents,
} from '../../security/security-helpers';

jest.setTimeout(TEST_TIMEOUT_MS);

const KEY = (n: number) => `9e5e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describeDb('review security: live positions after access ended', () => {
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
  const locations = (client: SocketEvents) => client.events.filter((e) => e.event === 'driver:location');

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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV-SEC-01 a suspended office user must stop receiving driver positions on an open socket', async () => {
    const sa2Token = signAccessToken(std.SA2.actor);
    const office = connect(sa2Token);
    await office.next('drivers:snapshot');
    const dr1 = connect(signAccessToken(std.DR1.actor));
    await dr1.next('connect');

    // SA1 suspends SA2 (the switch-over checklist suspends the seeded super admin the same way).
    await http(app)
      .patch(`/api/v1/users/${std.SA2.id}/status`)
      .set(authHeader(std.SA1.actor))
      .send({ value: 'SUSPENDED', reason: 'Left the company' })
      .expect(200);
    // The session is over for HTTP.
    const refused = await http(app).get('/api/v1/admin/summary').set({ Authorization: `Bearer ${sa2Token}` });
    expect({ status: refused.status, code: refused.body.code }).toEqual({ status: 401, code: 'AUTH_SESSION_REVOKED' });

    // DR1 reports a position; a revoked office socket must not hear it.
    expect(await emitWithAck(dr1.socket, 'location:update', { lat: 31.512345, lng: 74.281234 })).toEqual({ ok: true });
    await pause(500);
    expect({ closed: office.closed(), heard: locations(office).map((e) => e.payload) }).toEqual({ closed: true, heard: [] });
  });

  it('REV-SEC-01 an office socket must not outlive its access token', async () => {
    const office = connect(signAccessToken(std.SA1.actor, { expiresIn: 2 }));
    await office.next('drivers:snapshot');
    const dr1 = connect(signAccessToken(std.DR1.actor));
    await dr1.next('connect');
    await pause(3_000); // the office token has expired: HTTP with it is 401 AUTH_TOKEN_INVALID
    expect(await emitWithAck(dr1.socket, 'location:update', { lat: 31.5222, lng: 74.2333 })).toEqual({ ok: true });
    await pause(500);
    expect({ closed: office.closed(), heard: locations(office).length }).toEqual({ closed: true, heard: 0 });
  });

  it('REV-SEC-02 DA must not see the driver once its order is delivered (he is now at DB\'s customer)', async () => {
    const shopA = authHeader(std.DA.actor);
    const shopB = authHeader(std.DB.actor);
    const office = authHeader(std.SA1.actor);
    const driver = authHeader(std.DR1.actor);

    // DA's order X1 goes to DR1 and is delivered.
    const x1 = await http(app).post('/api/v1/orders').set(shopA).set('Idempotency-Key', KEY(1)).send(x1OrderBody(std)).expect(201);
    await http(app).post(`/api/v1/orders/${x1.body.id}/assign-driver`).set(office).send({ driverId: std.DR1.id }).expect(200);
    await http(app).patch(`/api/v1/orders/${x1.body.id}/status`).set(driver).send({ status: 'DELIVERED' }).expect(200);

    // DB (the competitor) gets money and orders for its customer Hina; the office gives it to DR1.
    await http(app)
      .post(`/api/v1/admin/distributors/${std.DB.id}/wallet/corrections`)
      .set(office)
      .set('Idempotency-Key', KEY(2))
      .send({ direction: 'ADD', amountPaisa: 100000, reasonCode: 'OTHER', note: 'Review test money for DB' })
      .expect(201);
    const y1 = await http(app)
      .post('/api/v1/orders')
      .set(shopB)
      .set('Idempotency-Key', KEY(3))
      .send({
        clientId: std.C3.id,
        addressId: std.C3.addressId,
        deliveryLabel: "Hina's house",
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
      })
      .expect(201);
    await http(app).post(`/api/v1/orders/${y1.body.id}/assign-driver`).set(office).send({ driverId: std.DR1.id }).expect(200);
    // DR1 stands at Hina's door and his phone reports it.
    const hina = std.C3.location as { lat: number; lng: number };
    await http(app).patch(`/api/v1/drivers/${std.DR1.id}/location`).set(driver).send(hina).expect(200);

    // The order DTO offers no TRACK button (§1.6: only while ON_THE_WAY) ...
    const dto = await http(app).get(`/api/v1/orders/${x1.body.id}`).set(shopA).expect(200);
    expect(dto.body.allowedActions).toEqual([]);
    // ... but the tracking route still hands DA the driver's live pin, which is DB's customer's address.
    const tracked = await http(app).get(`/api/v1/orders/${x1.body.id}/tracking`).set(shopA).expect(200);
    expect({ status: tracked.body.status, driverLocation: tracked.body.driverLocation }).toEqual({ status: 'DELIVERED', driverLocation: null });
  });

  it('REV-SEC-02 placing and at once cancelling an order (full refund) must not buy tracking of that driver', async () => {
    const shopA = authHeader(std.DA.actor);
    const office = authHeader(std.SA1.actor);
    const x2 = await http(app).post('/api/v1/orders').set(shopA).set('Idempotency-Key', KEY(4)).send(x2OrderBody(std)).expect(201);
    await http(app).post(`/api/v1/orders/${x2.body.id}/assign-driver`).set(office).send({ driverId: std.DR2.id }).expect(200);
    const cancelled = await http(app).post(`/api/v1/orders/${x2.body.id}/cancel`).set(shopA).send({ reasonCode: 'WRONG_ORDER' }).expect(200);
    expect(cancelled.body.refundedPaisa).toBe('40000');
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa).toBe(500_000n);

    // Hours later DR2 is somewhere else entirely.
    await http(app).patch(`/api/v1/drivers/${std.DR2.id}/location`).set(authHeader(std.DR2.actor)).send({ lat: 31.5401, lng: 74.3101 }).expect(200);
    const tracked = await http(app).get(`/api/v1/orders/${x2.body.id}/tracking`).set(shopA).expect(200);
    expect({ status: tracked.body.status, driverLocation: tracked.body.driverLocation }).toEqual({ status: 'CANCELLED', driverLocation: null });
  });

  it('REV-SEC-04 a deferred online:set must not put an archived driver back online', async () => {
    const dr1 = connect(signAccessToken(std.DR1.actor));
    await dr1.next('connect');
    const office = connect(signAccessToken(std.SA1.actor));
    await office.next('drivers:snapshot');
    // Goes online, then (too soon) says it again: the second one is kept for the end of the 5-second window.
    expect(await emitWithAck(dr1.socket, 'online:set', { isOnline: true })).toEqual({ ok: true });
    expect(await emitWithAck(dr1.socket, 'online:set', { isOnline: true })).toEqual({ ok: true });

    // The office archives DR1 inside that window: offline, SUSPENDED, shift closed, sessions ended.
    await http(app).delete(`/api/v1/drivers/${std.DR1.id}`).set(authHeader(std.SA1.actor)).send({ reason: 'Stopped working' }).expect(200);
    expect(await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).toMatchObject({ isOnline: false });

    await pause(5_500); // the deferred online:set fires
    const driver = await db().driver.findUniqueOrThrow({ where: { id: std.DR1.id }, include: { user: true } });
    const openShifts = await db().driverShift.count({ where: { driverId: std.DR1.id, endedAt: null } });
    const told = office.events.filter((e) => e.event === 'driver:online').map((e) => e.payload);
    expect({ status: driver.user.status, isOnline: driver.isOnline, openShifts, lastBroadcast: told[told.length - 1] }).toEqual({
      status: 'SUSPENDED',
      isOnline: false,
      openShifts: 0,
      lastBroadcast: { driverId: std.DR1.id, isOnline: true }, // the first, accepted one; no later "online" for an archived driver
    });
    expect(told).toHaveLength(1);
  });
});
