/**
 * Sign-in (API_CONTRACT §3.3, §7.1): SEC-001, SEC-002, SEC-003, SEC-004 and SEC-006.
 */
import type { INestApplication } from '@nestjs/common';
import { DistributorStatus, UserRole, UserStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createDistributor, createUser } from '../helpers/factories';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES, type StandardData } from '../helpers/standard-data';
import { bearer, claimsOf, login, secretsIn, setPassword, useMemoryRateLimits, type MemoryRateLimitStore, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

const OTP_WORDS = /OTP|one-time code/i;

describeDb('auth: sign-in', () => {
  let app: INestApplication;
  let limits: MemoryRateLimitStore;
  let std: StandardData;
  const db = () => getTestPrisma();

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

  it('SEC-001 a distributor signs in with the phone typed in any normal form', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    // Step 1: local form with a space.
    const first = await login(app, '0321 1234567', 'Shop!Pass2026', 'distributor').expect(200);
    expect(Object.keys(first.body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken', 'role']);
    expect(first.body).toMatchObject({ role: 'DISTRIBUTOR', expiresIn: 43200 });
    // Step 2: the claims.
    const user = await db().user.findUniqueOrThrow({ where: { id: std.DA.userId } });
    const claims = claimsOf(first.body.accessToken);
    expect(claims).toMatchObject({ sub: std.DA.userId, role: 'DISTRIBUTOR', distributorId: std.DA.id, tv: user.tokenVersion });
    expect(claims.driverId).toBeUndefined();
    // Step 3: the other forms.
    await login(app, '+923211234567', 'Shop!Pass2026', 'distributor').expect(200);
    await login(app, '0321-1234567', 'Shop!Pass2026', 'distributor').expect(200);
    // Step 4: the profile, with no secrets at any depth.
    for (const url of ['/api/v1/auth/me', '/api/v1/users/me']) {
      const res = await http(app).get(url).set(bearer(first.body.accessToken)).expect(200);
      expect(res.body).toMatchObject({ id: std.DA.userId, phone: STANDARD_PHONES.DA, role: 'DISTRIBUTOR' });
      expect({ url, secrets: secretsIn(res.body) }).toEqual({ url, secrets: [] });
    }
  });

  it('SEC-002 an unknown phone or a wrong password is refused the same way, and no account is created', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    const before = { users: await db().user.count(), tokens: await db().refreshToken.count() };
    const unknown = await login(app, '0300 9999999', 'Anything123').expect(401);
    const wrong = await login(app, STANDARD_PHONES.DA, 'WrongPass123').expect(401);
    for (const res of [unknown, wrong]) {
      expect(res.body).toMatchObject({ statusCode: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'Wrong phone number or password.' });
      expect(res.body.accessToken).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(OTP_WORDS);
    }
    const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined, timestamp: undefined });
    expect(strip(unknown.body)).toEqual(strip(wrong.body));
    // Step 3.
    expect({ users: await db().user.count(), tokens: await db().refreshToken.count() }).toEqual(before);
    expect(await db().user.findUnique({ where: { phone: '+923009999999' } })).toBeNull();
  });

  it('SEC-003 accounts that aren\'t active can\'t sign in', async () => {
    const pending = await createDistributor({ businessName: 'Pending Gas', code: 'PG', zone: std.zones.North, status: DistributorStatus.PENDING });
    await db().user.update({ where: { id: pending.userId }, data: { status: UserStatus.PENDING } });
    const pendingPhone = (await db().user.findUniqueOrThrow({ where: { id: pending.userId } })).phone;
    await setPassword(pending.userId, 'Pending#2026');
    await setPassword(std.DR2.userId, 'Driver#2026');
    const office = authHeader(std.SA1.actor);
    await http(app)
      .patch(`/api/v1/users/${std.DR2.userId}/status`)
      .set(office)
      .send({ value: 'SUSPENDED', reason: 'Inactive sign-in test' })
      .expect(200);

    // Steps 1-2.
    for (const [phone, password, variant] of [
      [pendingPhone, 'Pending#2026', 'distributor'],
      [STANDARD_PHONES.DR2, 'Driver#2026', 'driver'],
    ] as const) {
      const res = await login(app, phone, password, variant).expect(403);
      expect(res.body).toMatchObject({ code: 'AUTH_ACCOUNT_NOT_ACTIVE', message: "This account isn't active. Call the office." });
      expect(res.body.accessToken).toBeUndefined();
    }
    // Step 3: a wrong password reveals nothing about the status.
    expect((await login(app, STANDARD_PHONES.DR2, 'Wrong#Pass1', 'driver').expect(401)).body.code).toBe('AUTH_INVALID_CREDENTIALS');
    // Step 4.
    await http(app).patch(`/api/v1/users/${std.DR2.userId}/status`).set(office).send({ value: 'ACTIVE', reason: 'Back on the road' }).expect(200);
    const back = await login(app, STANDARD_PHONES.DR2, 'Driver#2026', 'driver').expect(200);
    expect(back.body.accessToken).toEqual(expect.any(String));
  });

  it('SEC-004 locked roles can\'t sign in, including the seeded branch admin', async () => {
    const people = [
      await createUser({ role: UserRole.ADMIN, name: 'LPG Branch Admin' }),
      await createUser({ role: UserRole.DISPATCHER, name: 'Dispatcher Test' }),
      await createUser({ role: UserRole.STORE_KEEPER, name: 'Store Keeper Test' }),
      await createUser({ role: UserRole.CLIENT, name: 'Client Test' }),
    ];
    for (const person of people) await setPassword(person.id, 'Locked#2026');
    const attempts: Array<[string, string | undefined]> = [
      ...people.map((p) => [p.phone, 'admin-web'] as [string, string]),
      [people[3].phone, 'distributor'],
      ...people.map((p) => [p.phone, undefined] as [string, undefined]),
    ];
    for (const [phone, variant] of attempts) {
      limits.clear();
      const res = await login(app, phone, 'Locked#2026', variant).expect(403);
      expect({ variant, code: res.body.code }).toEqual({ variant, code: 'AUTH_ROLE_LOCKED' });
      expect(res.body.message).toBe("This account can't sign in. Call the office.");
      expect(res.body.accessToken).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(OTP_WORDS);
    }
  });

  it('SEC-006 signing in on the wrong app is refused with the name of the right app', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    await setPassword(std.DR1.userId, 'Driver#2026');
    await setPassword(std.SA1.id, 'Office#2026');
    const wrong = async (phone: string, password: string, variant: string, role: string, app_: string) => {
      const res = await login(app, phone, password, variant).expect(403);
      expect(res.body).toMatchObject({ code: 'AUTH_WRONG_APP', details: { role, app: app_ }, message: `This account is for the ${app_}.` });
      expect(res.body.accessToken).toBeUndefined();
    };
    // Step 1.
    await wrong(STANDARD_PHONES.DA, 'Shop!Pass2026', 'driver', 'DISTRIBUTOR', 'Smart Fleet shop app');
    await wrong(STANDARD_PHONES.DA, 'Shop!Pass2026', 'admin-web', 'DISTRIBUTOR', 'Smart Fleet shop app');
    // Step 2.
    await wrong(STANDARD_PHONES.DR1, 'Driver#2026', 'distributor', 'DRIVER', 'Smart Fleet Driver app');
    // Step 3.
    await wrong(STANDARD_PHONES.SA1, 'Office#2026', 'distributor', 'SUPER_ADMIN', 'Smart Fleet Office website');
    await wrong(STANDARD_PHONES.SA1, 'Office#2026', 'driver', 'SUPER_ADMIN', 'Smart Fleet Office website');
    limits.clear();
    // Step 4.
    await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026', 'distributor').expect(200);
    await login(app, STANDARD_PHONES.DR1, 'Driver#2026', 'driver').expect(200);
    await login(app, STANDARD_PHONES.SA1, 'Office#2026', 'admin-web').expect(200);
    // Step 5: installed 0.1.0 apps send no variant.
    await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
    await login(app, STANDARD_PHONES.DR1, 'Driver#2026').expect(200);
  });
});
