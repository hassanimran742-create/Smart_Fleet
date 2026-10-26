/**
 * Office routes of the api-orders lane (API_CONTRACT §7.3, §7.13): the admin summary, creating and
 * editing distributors and their one store, codes, activation and suspension, and CNICs.
 */
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authHeader } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createDistributor } from '../helpers/factories';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES } from '../helpers/standard-data';
import { API, OrdersFixture, newKey, together } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

jest.setTimeout(300_000);

const CNIC_FORMS = /3520(2|21)?[- ]?\d{7}[- ]?\d|\d{13}/;

describeDb('api-orders: office distributors and summary', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
  });

  afterAll(async () => {
    await app?.close();
  });

  const office = () => f.as(f.std.SA1);
  const cityGasBody = (over: Record<string, unknown> = {}) => ({
    phone: '0321 5550001',
    name: 'Nadeem Akhtar',
    businessName: 'City Gas',
    code: 'CG',
    cnic: '35202-1234567-1',
    store: { name: 'City Gas Store', address: '12 Main Boulevard', lat: 31.51, lng: 74.21 },
    ...over,
  });
  const counts = async () => ({ users: await f.db.user.count(), stores: await f.db.store.count(), distributors: await f.db.distributor.count() });

  it('OFF-002 GET /admin/summary counts what is waiting and what happened today', async () => {
    const { std, db } = f;
    // DA placed X1 (Rs 250) and cancelled it before loading, then X2 (Rs 400) and O3 (3 × 15 kg for Usman, Rs 400).
    const x1 = await f.x1();
    await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    const x2 = await f.x2();
    await f.x2();
    // One top-up request waiting; City Gas waiting to start; DR1 on duty, DR2 off duty.
    await db.payment.create({ data: { distributorId: std.DA.id, requestNo: 1, amountPaisa: 200_000n, provider: 'BANK_MANUAL', status: 'PENDING' } });
    await createDistributor({ code: 'CG', businessName: 'City Gas', status: 'PENDING', zone: std.zones.North });
    await db.driver.update({ where: { id: std.DR1.id }, data: { isOnline: true, availability: 'AVAILABLE' } });
    await db.driver.update({ where: { id: std.DR2.id }, data: { isOnline: false, availability: 'OFF_DUTY' } });
    const cityGas = await db.distributor.findFirstOrThrow({ where: { code: 'CG' } });

    const summary = await office().get('/admin/summary').expect(200);
    expect(summary.body.orders).toMatchObject({
      needsDriver: 2,
      oldestNeedsDriverAt: (await f.order(x2.id)).createdAt.toISOString(),
      placedToday: 3,
      deliveredToday: 0,
      costTakenTodayPaisa: '80000',
      inProgress: 0,
    });
    expect(summary.body.topups).toMatchObject({ toCheck: 1, oldestWaitingAt: expect.any(String) });
    expect(summary.body.prices.missing).toEqual([
      { distributorId: std.DA.id, distributorName: 'Ahmed Gas', zones: 1 },
      { distributorId: std.DB.id, distributorName: 'Bilal Gas', zones: 2 },
    ]);
    expect(summary.body.distributors.waitingToStart).toEqual([{ id: cityGas.id, name: 'City Gas' }]);
    expect(summary.body.drivers).toEqual({ onDuty: 1, total: 2 });
    // Office only.
    expect((await f.as(std.DA).get('/admin/summary').expect(403)).body.code).toBe('PERMISSION_DENIED');
  });

  it('OFF-004 create a distributor with exactly one store and a shop code', async () => {
    const { std } = f;
    const K1 = newKey();
    const before = await counts();
    // Step 1.
    const created = await office().post('/distributors').set('Idempotency-Key', K1).send(cityGasBody()).expect(201);
    expect(created.body).toMatchObject({
      code: 'CG',
      businessName: 'City Gas',
      status: 'PENDING',
      contact: { phone: '+923215550001', name: 'Nadeem Akhtar' },
      store: { name: 'City Gas Store', zone: { name: 'North' } },
      wallet: { balancePaisa: '0' },
      prices: { priced: 0, total: 3 },
      readiness: { storeSet: true, pricesComplete: false, appPasswordSet: false },
      codeLocked: false,
      cnicMasked: '*****-****567-1',
    });
    const text = JSON.stringify(created.body);
    expect(text).not.toMatch(/"cnic"|cnicEncrypted|cnicIndex/);
    expect(text.replace('*****-****567-1', '')).not.toMatch(CNIC_FORMS);
    // Step 2.
    const replay = await office().post('/distributors').set('Idempotency-Key', K1).send(cityGasBody()).expect(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.id).toBe(created.body.id);
    expect(await counts()).toEqual({ users: before.users + 1, stores: before.stores + 1, distributors: before.distributors + 1 });
    // Step 3.
    const read = await office().get(`/distributors/${created.body.id}`).expect(200);
    expect(read.body).toMatchObject({ id: created.body.id, store: { zone: { id: std.zones.North.id } } });
    expect(await f.db.store.count({ where: { distributor: { id: created.body.id } } })).toBe(1);
    // Step 4.
    const audits = await office().get(`/audit-logs?action=distributor.create&resourceId=${created.body.id}`).expect(200);
    const items = Array.isArray(audits.body) ? audits.body : audits.body.items;
    expect(items).toHaveLength(1);
    expect(items[0].actor.userId).toBe(std.SA1.id);
  });

  it('OFF-005 creating a distributor is refused for a bad or taken code, a used phone, or a store outside every zone', async () => {
    const { std, db } = f;
    let n = 0;
    const freshPhone = () => `0321 55501${String(++n).padStart(2, '0')}`;
    const before = await counts();
    // Step 1: a code must already be capitals (API_CONTRACT §7.3 rule 2), so "cg" is refused too.
    for (const code of ['cg', 'C', '1CG', 'ABCDEFG']) {
      const res = await office().post('/distributors').send(cityGasBody({ code, phone: freshPhone() })).expect(400);
      expect(res.body).toMatchObject({ code: 'DISTRIBUTOR_CODE_INVALID', message: 'Use 2 to 6 capital letters or digits, starting with a letter.' });
    }
    // Step 2.
    const taken = await office().post('/distributors').send(cityGasBody({ code: 'AG', phone: freshPhone() })).expect(409);
    expect(taken.body).toMatchObject({ code: 'DISTRIBUTOR_CODE_IN_USE', message: 'Another shop already uses the code AG.' });
    // Step 3.
    const used = await office().post('/distributors').send(cityGasBody({ phone: STANDARD_PHONES.DR1 })).expect(409);
    expect(used.body).toMatchObject({ code: 'USER_PHONE_IN_USE', details: { existingRole: 'DRIVER' } });
    expect((await db.user.findUniqueOrThrow({ where: { phone: STANDARD_PHONES.DR1 } })).role).toBe('DRIVER');
    // Step 4.
    const outside = await office().post('/distributors').send(cityGasBody({ phone: freshPhone(), store: { name: 'Far Store', address: 'Nowhere', ...std.outside } })).expect(422);
    expect(outside.body).toMatchObject({ code: 'STORE_OUTSIDE_ZONES', message: 'This spot is outside every active zone. Move the pin.' });
    // Step 5.
    const { store: _store, ...noStore } = cityGasBody({ phone: freshPhone() });
    expect((await office().post('/distributors').send(noStore).expect(400)).body.code).toBe('VALIDATION_FAILED');
    expect(await counts()).toEqual(before);
    // Step 6.
    const [a, b] = await together(
      office().post('/distributors').send(cityGasBody({ code: 'ZZ', phone: freshPhone(), cnic: undefined })),
      office().post('/distributors').send(cityGasBody({ code: 'ZZ', phone: freshPhone(), businessName: 'Zed Gas', cnic: undefined })),
    );
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((a.status === 409 ? a : b).body.code).toBe('DISTRIBUTOR_CODE_IN_USE');
    // Step 7.
    const initials = await office().post('/distributors').send(cityGasBody({ code: undefined, businessName: 'Asif Gas', phone: freshPhone(), cnic: undefined })).expect(201);
    expect(initials.body.code).toBe('AG2');
    expect(await counts()).toEqual({ users: before.users + 2, stores: before.stores + 2, distributors: before.distributors + 2 });
  });

  it('OFF-006 the code changes only before the first order, the store cannot be removed, activate and suspend are audited', async () => {
    const { std, db } = f;
    const created = await office().post('/distributors').set('Idempotency-Key', newKey()).send(cityGasBody()).expect(201);
    const cityGas = created.body.id as string;
    const cityUser = (await db.distributor.findUniqueOrThrow({ where: { id: cityGas } })).userId;
    for (const zone of [std.zones.North, std.zones.South, std.zones.East]) {
      await office().put(`/pricing/prices/${cityGas}/${zone.id}`).send({ basePaisa: 30000 }).expect(200);
    }
    await db.user.update({ where: { id: cityUser }, data: { passwordHash: await argon2.hash('City!Pass123') } });
    await f.x2(); // Ahmed Gas has orders.
    // Step 1.
    const renamed = await office().patch(`/distributors/${cityGas}/code`).send({ code: 'CY' }).expect(200);
    expect(renamed.body).toMatchObject({ code: 'CY', codeLocked: false, readiness: { pricesComplete: true, appPasswordSet: true } });
    // Step 2.
    const locked = await office().patch(`/distributors/${std.DA.id}/code`).send({ code: 'AH' }).expect(409);
    expect(locked.body).toMatchObject({ code: 'DISTRIBUTOR_CODE_LOCKED', message: "The shop code can't change after the first order." });
    expect((await office().get(`/distributors/${std.DA.id}`).expect(200)).body).toMatchObject({ code: 'AG', codeLocked: true });
    // Step 3.
    const inUse = await office().delete(`/stores/${std.DA.homeStoreId}`).expect(409);
    expect(inUse.body).toMatchObject({ code: 'STORE_IN_USE', message: "This store belongs to a shop and can't be removed." });
    // Step 4.
    const moved = await office().patch(`/distributors/${cityGas}/store`).send({ lat: 31.51, lng: 74.27 }).expect(200);
    expect(moved.body.store.zone.name).toBe('South');
    expect((await office().patch(`/distributors/${cityGas}/store`).send(std.outside).expect(422)).body.code).toBe('STORE_OUTSIDE_ZONES');
    expect((await office().get(`/distributors/${cityGas}`).expect(200)).body.store).toMatchObject({ lat: 31.51, lng: 74.27, zone: { name: 'South' } });
    // Step 5.
    expect((await office().patch(`/distributors/${cityGas}/approve`).expect(200)).body.status).toBe('ACTIVE');
    expect((await db.user.findUniqueOrThrow({ where: { id: cityUser } })).status).toBe('ACTIVE');
    // Step 6.
    expect((await office().patch(`/distributors/${cityGas}/suspend`).send({}).expect(400)).body.code).toBe('VALIDATION_FAILED');
    const tvBefore = (await db.user.findUniqueOrThrow({ where: { id: cityUser } })).tokenVersion;
    expect((await office().patch(`/distributors/${cityGas}/suspend`).send({ reason: 'Test suspend' }).expect(200)).body.status).toBe('SUSPENDED');
    const suspendedUser = await db.user.findUniqueOrThrow({ where: { id: cityUser } });
    expect([suspendedUser.status, suspendedUser.tokenVersion]).toEqual(['SUSPENDED', tvBefore + 1]);
    expect((await office().patch(`/distributors/${cityGas}/suspend`).send({ reason: 'Test suspend' }).expect(200)).headers['x-already-applied']).toBe('true');
    // Step 7.
    const noReason = await office().patch(`/distributors/${cityGas}/approve`).expect(400);
    expect(noReason.body.details.fields).toEqual([expect.objectContaining({ path: 'reason' })]);
    expect((await office().patch(`/distributors/${cityGas}/approve`).send({ reason: 'Test reactivate' }).expect(200)).body.status).toBe('ACTIVE');
    expect((await db.user.findUniqueOrThrow({ where: { id: cityUser } })).status).toBe('ACTIVE');
    // Step 8.
    const rows = await db.auditLog.findMany({ where: { distributorId: cityGas, action: { startsWith: 'distributor.' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(rows.map((row) => row.action)).toEqual([
      'distributor.create',
      'distributor.code_change',
      'distributor.store_update',
      'distributor.activate',
      'distributor.suspend',
      'distributor.activate',
    ]);
    expect(rows.every((row) => row.actorUserId === std.SA1.id)).toBe(true);
    expect(rows[4].reason).toBe('Test suspend');
    expect(rows[5].diff).toMatchObject({ from: 'SUSPENDED' });
    expect(rows[5].reason).toBe('Test reactivate');
  });

  it('OFF-006 a suspended shop is signed out within 60 seconds and cannot sign in again', async () => {
    const { db } = f;
    const created = await office().post('/distributors').set('Idempotency-Key', newKey()).send(cityGasBody()).expect(201);
    const row = await db.distributor.findUniqueOrThrow({ where: { id: created.body.id }, include: { user: true } });
    await db.user.update({ where: { id: row.userId }, data: { passwordHash: await argon2.hash('City!Pass123') } });
    await office().patch(`/distributors/${row.id}/approve`).expect(200);
    const login = await http(app).post(`${API}/auth/login`).send({ phone: '0321 5550001', password: 'City!Pass123' }).expect(200);
    await office().patch(`/distributors/${row.id}/suspend`).send({ reason: 'Test suspend' }).expect(200);
    const old = await http(app).get(`${API}/distributors/me`).set('Authorization', `Bearer ${login.body.accessToken}`);
    expect([old.status, old.body.code]).toEqual([401, 'AUTH_SESSION_REVOKED']);
    const again = await http(app).post(`${API}/auth/login`).send({ phone: '0321 5550001', password: 'City!Pass123' }).expect(403);
    expect(again.body).toMatchObject({ code: 'AUTH_ACCOUNT_NOT_ACTIVE', message: "This account isn't active. Call the office." });
    await office().patch(`/distributors/${row.id}/approve`).send({ reason: 'Test reactivate' }).expect(200);
    await http(app).post(`${API}/auth/login`).send({ phone: '0321 5550001', password: 'City!Pass123' }).expect(200);
  });

  it('OFF-013 a CNIC can belong to only one account, and it never comes back in a response', async () => {
    const { db } = f;
    const before = await counts();
    const body = (over: Record<string, unknown>) =>
      cityGasBody({ store: { name: 'Store', address: '5 Canal Road', lat: 31.52, lng: 74.21 }, ...over });
    // Step 1.
    const kamran = await office()
      .post('/distributors')
      .set('Idempotency-Key', newKey())
      .send(body({ phone: '0321 5550010', name: 'Kamran Ali', businessName: 'Kamran Gas', code: 'KG', cnic: '35202-7654321-3' }))
      .expect(201);
    expect(kamran.body.cnicMasked).toBe('*****-****321-3');
    expect(JSON.stringify(kamran.body)).not.toMatch(/"cnic"|cnicEncrypted|cnicIndex/);
    // Steps 2 and 3.
    for (const [phone, businessName, code, cnic] of [
      ['0321 5550011', 'Second Gas', 'SG', '35202-7654321-3'],
      ['0321 5550012', 'Third Gas', 'TG', '3520276543213'],
    ]) {
      const res = await office().post('/distributors').set('Idempotency-Key', newKey()).send(body({ phone, businessName, code, cnic })).expect(409);
      expect(res.body).toMatchObject({ code: 'USER_CNIC_IN_USE', message: 'This CNIC is already registered.' });
    }
    expect(await db.distributor.count({ where: { code: { in: ['SG', 'TG'] } } })).toBe(0);
    // Step 4.
    const list = await office().get('/distributors').expect(200);
    const one = await office().get(`/distributors/${kamran.body.id}`).expect(200);
    for (const text of [JSON.stringify(list.body), JSON.stringify(one.body)]) {
      expect(text).not.toContain('3520276543213');
      expect(text).not.toContain('35202-7654321-3');
      expect(text).not.toMatch(/"cnic"|cnicEncrypted|cnicIndex/);
    }
    expect(one.body.cnicMasked).toBe('*****-****321-3');
    // Step 5.
    expect(await counts()).toEqual({ users: before.users + 1, stores: before.stores + 1, distributors: before.distributors + 1 });
  });

  it('OFF-014 editing a distributor contact is audited, and a phone change signs the shop out', async () => {
    const { std, db } = f;
    const balance = await f.balance();
    // Step 1.
    const edited = await office().patch(`/distributors/${std.DA.id}`).send({ businessName: 'Ahmed Gas Lahore', email: 'shop@ahmedgas.example' }).expect(200);
    expect(edited.body).toMatchObject({ businessName: 'Ahmed Gas Lahore', contact: { email: 'shop@ahmedgas.example' }, code: 'AG' });
    // Step 2.
    const taken = await office().patch(`/distributors/${std.DA.id}`).send({ phone: STANDARD_PHONES.DR1 }).expect(409);
    expect(taken.body).toMatchObject({ code: 'USER_PHONE_IN_USE', message: 'This phone number is already used by another account.', details: { existingRole: 'DRIVER' } });
    // Step 3.
    const tvBefore = (await db.user.findUniqueOrThrow({ where: { id: std.DA.userId } })).tokenVersion;
    const moved = await office().patch(`/distributors/${std.DA.id}`).send({ phone: '0321 9998887' }).expect(200);
    expect(moved.body.contact.phone).toBe('+923219998887');
    expect((await db.user.findUniqueOrThrow({ where: { id: std.DA.userId } })).tokenVersion).toBe(tvBefore + 1);
    // Step 4, with a token issued after the phone change, so the request reaches the role check.
    const signedInAgain = { actor: { ...std.DA.actor, tokenVersion: tvBefore + 1 } };
    expect((await f.as(signedInAgain).patch(`/distributors/${std.DA.id}`).send({ businessName: 'Mine now' }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 5.
    const rows = await f.audits('distributor.update', std.DA.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.actorUserId).toBe(std.SA1.id);
      expect(row.diff).toMatchObject({ before: expect.any(Object), after: expect.any(Object) });
    }
    expect((rows[1].diff as { before: { phone: string }; after: { phone: string } }).after.phone).toBe('+923219998887');
    // Put it back.
    await office().patch(`/distributors/${std.DA.id}`).send({ businessName: 'Ahmed Gas', email: null, phone: STANDARD_PHONES.DA }).expect(200);
    expect(await f.balance()).toBe(balance);
  });

  it('OFF-014 the old token is refused once the phone changes (tv bumped)', async () => {
    const { std } = f;
    const tokenA = authHeader(std.DA.actor);
    await office().patch(`/distributors/${std.DA.id}`).send({ phone: '0321 9998887' }).expect(200);
    const res = await http(app).get(`${API}/wallet`).set(tokenA);
    expect([res.status, res.body.code]).toEqual([401, 'AUTH_SESSION_REVOKED']);
  });
});
