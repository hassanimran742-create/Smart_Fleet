/**
 * Driver profiles and the office's driver controls (API_CONTRACT §3.5, §7.2): SEC-027, OFF-015 and
 * OFF-016. The assignment steps of OFF-016 use the orders lane's routes and wait for it.
 */
import type { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES, x2OrderBody, type StandardData } from '../helpers/standard-data';
import { bearer, login, secretsIn, setPassword, useMemoryRateLimits, type MemoryRateLimitStore, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

describeDb('drivers: profiles and the office controls', () => {
  let app: INestApplication;
  let limits: MemoryRateLimitStore;
  let std: StandardData;
  const db = () => getTestPrisma();
  const office = () => authHeader(std.SA1.actor);

  beforeAll(async () => {
    app = await createTestApp();
    limits = useMemoryRateLimits(app);
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    limits.clear();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SEC-027 driver profiles: the office sees and edits them; a driver sees only their own and changes only name and photo', async () => {
    const dr1 = authHeader(std.DR1.actor);
    // Step 1.
    const own = await http(app).get(`/api/v1/drivers/${std.DR1.id}`).set(dr1).expect(200);
    expect(own.body).toMatchObject({ id: std.DR1.id, user: { id: std.DR1.userId, phone: STANDARD_PHONES.DR1 } });
    expect(secretsIn(own.body)).toEqual([]);
    expect(own.body).not.toHaveProperty('cnicMasked');
    expect((await http(app).get(`/api/v1/drivers/${std.DR2.id}`).set(dr1).expect(404)).body.code).toBe('NOT_FOUND');
    // Step 2.
    const shop = authHeader(std.DA.actor);
    expect((await http(app).get('/api/v1/drivers').set(shop).expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect((await http(app).get(`/api/v1/drivers/${std.DR1.id}`).set(shop).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 3.
    const renamed = await http(app).patch(`/api/v1/drivers/${std.DR1.id}/profile`).set(dr1).send({ name: 'Kashif Ali' }).expect(200);
    expect(renamed.body.user.name).toBe('Kashif Ali');
    const phoneEdit = await http(app).patch(`/api/v1/drivers/${std.DR1.id}/profile`).set(dr1).send({ phone: '0300 5556667' }).expect(403);
    expect(phoneEdit.body).toMatchObject({ code: 'USER_FIELD_OFFICE_ONLY', message: 'Ask the office to change this.' });
    expect((await db().user.findUniqueOrThrow({ where: { id: std.DR1.userId } })).phone).toBe(STANDARD_PHONES.DR1);
    expect((await http(app).patch(`/api/v1/drivers/${std.DR2.id}/profile`).set(dr1).send({ name: 'X' }).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await db().user.findUniqueOrThrow({ where: { id: std.DR2.userId } })).name).toBe('Imran');
    // Step 4.
    const byOffice = await http(app).patch(`/api/v1/drivers/${std.DR1.id}/profile`).set(office()).send({ name: 'Kashif' }).expect(200);
    expect(byOffice.body.user.name).toBe('Kashif');
    const updates = await db().auditLog.findMany({ where: { action: 'driver.update', resourceId: std.DR1.id }, orderBy: { createdAt: 'asc' } });
    const officeRow = updates.find((row) => row.actorUserId === std.SA1.id);
    expect(officeRow?.diff).toMatchObject({ before: { name: 'Kashif Ali' }, after: { name: 'Kashif' } });
    // Step 5.
    expect((await http(app).patch(`/api/v1/drivers/${std.DR1.id}/vehicle`).set(dr1).send({ vehicleId: std.DR1.vehicleId }).expect(403)).body.code).toBe(
      'PERMISSION_DENIED',
    );
    expect((await http(app).patch(`/api/v1/drivers/${std.DR1.id}/availability`).set(dr1).send({ availability: 'OFF_DUTY' }).expect(403)).body.code).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('OFF-015 the office adds a driver: the phone is normalised and unique, the change is audited, and only the office can do it', async () => {
    // Step 1.
    const created = await http(app).post('/api/v1/drivers').set(office()).send({ name: 'Faisal', phone: '0345 1112223', licenceNo: 'LHR-2026-0001' }).expect(201);
    expect(created.body).toMatchObject({ user: { name: 'Faisal', phone: '+923451112223', status: 'ACTIVE' }, availability: 'AVAILABLE', cnicMasked: null });
    const faisal = await db().user.findUniqueOrThrow({ where: { phone: '+923451112223' } });
    expect({ role: faisal.role, passwordHash: faisal.passwordHash }).toEqual({ role: UserRole.DRIVER, passwordHash: null });
    // Step 2.
    const taken = await http(app)
      .post('/api/v1/drivers')
      .set(office())
      .send({ name: 'Second Driver', phone: STANDARD_PHONES.DA, licenceNo: 'LHR-2026-0002' })
      .expect(409);
    expect(taken.body).toMatchObject({
      code: 'USER_PHONE_IN_USE',
      message: 'This phone number is already used by another account.',
      details: { existingRole: 'DISTRIBUTOR' },
    });
    expect((await db().user.findUniqueOrThrow({ where: { phone: STANDARD_PHONES.DA } })).role).toBe(UserRole.DISTRIBUTOR);
    // Step 3.
    const short = await http(app).post('/api/v1/drivers').set(office()).send({ name: 'Third Driver', phone: '0345 111222', licenceNo: 'LHR-2026-0003' }).expect(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');
    expect(short.body.details.fields).toEqual([expect.objectContaining({ path: 'phone', code: 'INVALID_PHONE' })]);
    // Step 4.
    const asShop = await http(app)
      .post('/api/v1/drivers')
      .set(authHeader(std.DA.actor))
      .send({ name: 'Fourth Driver', phone: '0345 1112224', licenceNo: 'LHR-2026-0004' })
      .expect(403);
    expect(asShop.body.code).toBe('PERMISSION_DENIED');
    expect(await db().driver.count({ where: { licenceNo: { in: ['LHR-2026-0002', 'LHR-2026-0003', 'LHR-2026-0004'] } } })).toBe(0);
    // Step 5.
    const list = await http(app).get('/api/v1/drivers').set(office()).expect(200);
    expect((list.body as Array<{ id: string }>).map((d) => d.id)).toContain(created.body.id);
    expect(secretsIn(list.body)).toEqual([]);
    const one = await http(app).get(`/api/v1/drivers/${created.body.id}`).set(office()).expect(200);
    expect(secretsIn(one.body)).toEqual([]);
    const logs = await http(app).get('/api/v1/audit-logs').query({ action: 'driver.create' }).set(office()).expect(200);
    expect(logs.body.items).toHaveLength(1);
    expect(logs.body.items[0]).toMatchObject({ resourceId: created.body.id, actor: { kind: 'USER', userId: std.SA1.id } });
    // A licence number already used is a duplicate.
    const sameLicence = await http(app).post('/api/v1/drivers').set(office()).send({ name: 'Fifth', phone: '0345 1112225', licenceNo: 'LHR-2026-0001' }).expect(409);
    expect(sameLicence.body.code).toBe('CONFLICT_DUPLICATE');
  });

  it('OFF-015 a driver\'s CNIC is kept as 13 digits, encrypted and unique across users, and comes back only masked', async () => {
    const created = await http(app)
      .post('/api/v1/drivers')
      .set(office())
      .send({ name: 'Zahid', phone: '0345 2223334', licenceNo: 'LHR-2026-0101', cnic: '35202-7654321-3' })
      .expect(201);
    expect(created.body.cnicMasked).toBe('*****-****321-3');
    expect(JSON.stringify(created.body)).not.toMatch(/3520276543213|35202-7654321-3/);
    const user = await db().user.findUniqueOrThrow({ where: { phone: '+923452223334' } });
    expect(user.cnic).toBeNull();
    expect(user.cnicIndex).toMatch(/^[0-9a-f]{64}$/);
    expect(user.cnicEncrypted).not.toBeNull();
    // The same CNIC without dashes is the same CNIC.
    const again = await http(app)
      .post('/api/v1/drivers')
      .set(office())
      .send({ name: 'Other', phone: '0345 2223335', licenceNo: 'LHR-2026-0102', cnic: '3520276543213' })
      .expect(409);
    expect(again.body).toMatchObject({ code: 'USER_CNIC_IN_USE', message: 'This CNIC is already registered.' });
    expect(await db().user.findUnique({ where: { phone: '+923452223335' } })).toBeNull();
    // A CNIC left in the legacy plain column of another account counts too.
    await db().user.update({ where: { id: std.DB.userId }, data: { cnic: '35202-1111111-1' } });
    const legacy = await http(app).patch(`/api/v1/drivers/${created.body.id}/profile`).set(office()).send({ cnic: '3520211111111' }).expect(409);
    expect(legacy.body.code).toBe('USER_CNIC_IN_USE');
    // A bad CNIC is a field problem; the office can clear one.
    const bad = await http(app).patch(`/api/v1/drivers/${created.body.id}/profile`).set(office()).send({ cnic: '12345' }).expect(400);
    expect(bad.body.details.fields).toEqual([expect.objectContaining({ path: 'cnic', code: 'INVALID_CNIC' })]);
    // A blank CNIC (a form pre-filled from a response, which never carries it) changes nothing.
    const blank = await http(app).patch(`/api/v1/drivers/${created.body.id}/profile`).set(office()).send({ name: 'Zahid Khan', cnic: '' }).expect(200);
    expect(blank.body).toMatchObject({ user: { name: 'Zahid Khan' }, cnicMasked: '*****-****321-3' });
    const cleared = await http(app).patch(`/api/v1/drivers/${created.body.id}/profile`).set(office()).send({ cnic: null }).expect(200);
    expect(cleared.body.cnicMasked).toBeNull();
    const rows = await db().auditLog.findMany({ where: { action: 'driver.update', resourceId: created.body.id } });
    const diffs = rows.map((row) => row.diff as { before?: Record<string, unknown>; after?: Record<string, unknown> });
    // The blank CNIC wrote only the name; clearing wrote only that a CNIC is no longer stored. Each row
    // also names the driver, for the Activity sentence "Edited driver Zahid Khan".
    expect(diffs).toEqual(
      expect.arrayContaining([
        { name: 'Zahid Khan', before: { name: 'Zahid' }, after: { name: 'Zahid Khan' } },
        { name: 'Zahid Khan', before: { cnicSet: true }, after: { cnicSet: false } },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/3520276543213|7654321/);
  });

  it('OFF-016 archiving a driver needs a reason, ends their sessions, and keeps them off sign-in until reactivated', async () => {
    await setPassword(std.DR2.userId, 'Driver#2026');
    const signedIn = await login(app, STANDARD_PHONES.DR2, 'Driver#2026', 'driver').expect(200);
    const tvBefore = (await db().user.findUniqueOrThrow({ where: { id: std.DR2.userId } })).tokenVersion;
    // Step 1.
    const noReason = await http(app).delete(`/api/v1/drivers/${std.DR2.id}`).set(office()).expect(400);
    expect(noReason.body.code).toBe('VALIDATION_FAILED');
    expect((await db().user.findUniqueOrThrow({ where: { id: std.DR2.userId } })).status).toBe(UserStatus.ACTIVE);
    // Step 2.
    const archived = await http(app).delete(`/api/v1/drivers/${std.DR2.id}`).set(office()).send({ reason: 'Left the company' }).expect(200);
    expect(archived.body).toMatchObject({ id: std.DR2.id, isOnline: false, currentVehicleId: null, user: { status: 'SUSPENDED' } });
    const user = await db().user.findUniqueOrThrow({ where: { id: std.DR2.userId } });
    expect({ status: user.status, tv: user.tokenVersion }).toEqual({ status: UserStatus.SUSPENDED, tv: tvBefore + 1 });
    expect((await db().driver.findUniqueOrThrow({ where: { id: std.DR2.id } })).currentVehicleId).toBeNull();
    const repeat = await http(app).delete(`/api/v1/drivers/${std.DR2.id}`).set(office()).send({ reason: 'Left the company' }).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    // Step 3.
    expect((await http(app).get('/api/v1/trips/mine').set(bearer(signedIn.body.accessToken)).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    const again = await login(app, STANDARD_PHONES.DR2, 'Driver#2026', 'driver').expect(403);
    expect(again.body).toMatchObject({ code: 'AUTH_ACCOUNT_NOT_ACTIVE', message: "This account isn't active. Call the office." });
    // Step 5.
    const noReactivateReason = await http(app).patch(`/api/v1/drivers/${std.DR2.id}/reactivate`).set(office()).send({}).expect(400);
    expect(noReactivateReason.body.code).toBe('VALIDATION_FAILED');
    await http(app).patch(`/api/v1/drivers/${std.DR2.id}/reactivate`).set(office()).send({ reason: 'Back at work' }).expect(200);
    await login(app, STANDARD_PHONES.DR2, 'Driver#2026', 'driver').expect(200);
    const van = await http(app).patch(`/api/v1/drivers/${std.DR2.id}/vehicle`).set(office()).send({ vehicleId: std.DR2.vehicleId }).expect(200);
    expect(van.body.currentVehicle).toMatchObject({ id: std.DR2.vehicleId, plateNo: 'LEB-202' });
    const reactivateRepeat = await http(app).patch(`/api/v1/drivers/${std.DR2.id}/reactivate`).set(office()).send({ reason: 'Back at work' }).expect(200);
    expect(reactivateRepeat.headers['x-already-applied']).toBe('true');
    // Step 6.
    for (const [action, reason] of [
      ['driver.archive', 'Left the company'],
      ['driver.reactivate', 'Back at work'],
    ]) {
      const logs = await http(app).get('/api/v1/audit-logs').query({ action }).set(office()).expect(200);
      expect(logs.body.items).toHaveLength(1);
      expect(logs.body.items[0]).toMatchObject({ resourceId: std.DR2.id, reason, actor: { userId: std.SA1.id } });
    }
  });

  it('OFF-016 the office gives and takes vans and sets availability, each audited', async () => {
    const vehicle = await http(app).patch(`/api/v1/drivers/${std.DR1.id}/vehicle`).set(office()).send({ vehicleId: std.DR2.vehicleId }).expect(200);
    expect(vehicle.body.currentVehicle).toMatchObject({ id: std.DR2.vehicleId });
    // The van moved from DR2, who has none now.
    expect((await db().driver.findUniqueOrThrow({ where: { id: std.DR2.id } })).currentVehicleId).toBeNull();
    expect(await db().auditLog.count({ where: { action: 'driver.update', resourceId: { in: [std.DR1.id, std.DR2.id] } } })).toBe(2);
    const same = await http(app).patch(`/api/v1/drivers/${std.DR1.id}/vehicle`).set(office()).send({ vehicleId: std.DR2.vehicleId }).expect(200);
    expect(same.headers['x-already-applied']).toBe('true');
    const unknown = await http(app).patch(`/api/v1/drivers/${std.DR1.id}/vehicle`).set(office()).send({ vehicleId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'vehicleId' } });
    const leave = await http(app)
      .patch(`/api/v1/drivers/${std.DR1.id}/availability`)
      .set(office())
      .send({ availability: 'ON_LEAVE', leaveStart: '2026-10-24', leaveEnd: '2026-10-26', reason: 'Wedding' })
      .expect(200);
    expect(leave.body).toMatchObject({ availability: 'ON_LEAVE', isOnline: false });
    const backwards = await http(app)
      .patch(`/api/v1/drivers/${std.DR1.id}/availability`)
      .set(office())
      .send({ availability: 'ON_LEAVE', leaveStart: '2026-10-26', leaveEnd: '2026-10-24' })
      .expect(400);
    expect(backwards.body.details.fields).toEqual([expect.objectContaining({ path: 'leaveEnd', code: 'END_BEFORE_START' })]);
  });

  it('OFF-016 an archived driver can\'t take jobs until reactivated and given a van again', async () => {
    const shop = authHeader(std.DA.actor);
    const x2 = await http(app).post('/api/v1/orders').set(shop).set('Idempotency-Key', '44444444-dddd-4ddd-8ddd-000000000001').send(x2OrderBody(std)).expect(201);
    await http(app).delete(`/api/v1/drivers/${std.DR2.id}`).set(office()).send({ reason: 'Left the company' }).expect(200);
    // Step 4.
    const refused = await http(app).post(`/api/v1/orders/${x2.body.id}/assign-driver`).set(office()).send({ driverId: std.DR2.id }).expect(409);
    expect(refused.body).toMatchObject({ code: 'ASSIGN_DRIVER_NOT_AVAILABLE', message: "Imran can't take trips right now." });
    expect((await db().order.findUniqueOrThrow({ where: { id: x2.body.id } })).status).toBe('PENDING');
    // Step 5.
    await http(app).patch(`/api/v1/drivers/${std.DR2.id}/reactivate`).set(office()).send({ reason: 'Back at work' }).expect(200);
    await http(app).patch(`/api/v1/drivers/${std.DR2.id}/vehicle`).set(office()).send({ vehicleId: std.DR2.vehicleId }).expect(200);
    await http(app).post(`/api/v1/orders/${x2.body.id}/assign-driver`).set(office()).send({ driverId: std.DR2.id }).expect(200);
  });
});
