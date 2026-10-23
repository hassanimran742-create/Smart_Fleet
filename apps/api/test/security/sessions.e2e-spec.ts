/**
 * Tokens and sessions (API_CONTRACT §3.3, §7.1): SEC-005, SEC-009 and SEC-010.
 */
import type { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app';
import { authHeader, signAccessToken } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createUser } from '../helpers/factories';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES, type StandardData } from '../helpers/standard-data';
import {
  advanceClock,
  bearer,
  login,
  setPassword,
  useMemoryRateLimits,
  type MemoryRateLimitStore, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

const DEFAULT_LOCKED = ['ADMIN', 'DISPATCHER', 'STORE_KEEPER', 'CLIENT'];

describeDb('auth: tokens and sessions', () => {
  let app: INestApplication;
  let limits: MemoryRateLimitStore;
  let std: StandardData;
  const db = () => getTestPrisma();
  const me = (token: string) => http(app).get('/api/v1/auth/me').set(bearer(token));
  const refresh = (refreshToken: string) => http(app).post('/api/v1/auth/refresh').send({ refreshToken });

  beforeAll(async () => {
    app = await createTestApp();
    limits = useMemoryRateLimits(app);
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    limits.clear();
    std = await createStandardData();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  it('SEC-005 changing auth.lockedRoles takes effect for sign-in, refresh and open sessions', async () => {
    const keeper = await createUser({ role: UserRole.STORE_KEEPER, name: 'Store Keeper Test' });
    await setPassword(keeper.id, 'Keeper#2026');
    const office = authHeader(std.SA1.actor);
    const setLocked = (value: unknown, reason: string) =>
      http(app).patch('/api/v1/settings/auth.lockedRoles').set(office).send({ value, reason });

    // Step 1.
    await setLocked(['ADMIN', 'DISPATCHER', 'CLIENT'], 'Lock test: allow store keeper').expect(200);
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: 'setting.update' }, orderBy: { createdAt: 'desc' } });
    expect(audit.diff).toMatchObject({ key: 'auth.lockedRoles', from: DEFAULT_LOCKED, to: ['ADMIN', 'DISPATCHER', 'CLIENT'] });
    // Step 2.
    const signedIn = await login(app, keeper.phone, 'Keeper#2026').expect(200);
    await me(signedIn.body.accessToken).expect(200);
    // Step 3.
    await setLocked(DEFAULT_LOCKED, 'Lock test: back to the default').expect(200);
    // Step 4: within 60 seconds (the lock applies on the next request).
    expect((await me(signedIn.body.accessToken).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    // Step 5.
    expect((await refresh(signedIn.body.refreshToken).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    expect((await login(app, keeper.phone, 'Keeper#2026').expect(403)).body.code).toBe('AUTH_ROLE_LOCKED');
    // Step 6: the office can't lock itself out, nor repeat a role.
    for (const value of [['ADMIN', 'SUPER_ADMIN'], ['ADMIN', 'ADMIN']]) {
      expect((await setLocked(value, 'Lock test: refused values').expect(400)).body.code).toBe('SETTING_INVALID_VALUE');
    }
    const settings = await http(app).get('/api/v1/settings').set(office).expect(200);
    const row = (settings.body as Array<{ key: string; value: unknown }>).find((r) => r.key === 'auth.lockedRoles');
    expect(row?.value).toEqual(DEFAULT_LOCKED);
  });

  it('SEC-009 bad access tokens are refused, and reusing an old refresh token ends the session', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    const signedIn = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
    // Step 1: no token, garbage, another secret, an edited payload and an expired token.
    const [header, , signature] = (signedIn.body.accessToken as string).split('.');
    const payload = JSON.parse(Buffer.from((signedIn.body.accessToken as string).split('.')[1], 'base64url').toString('utf8'));
    const edited = `${header}.${Buffer.from(JSON.stringify({ ...payload, role: 'SUPER_ADMIN' })).toString('base64url')}.${signature}`;
    const bad = [
      undefined,
      'garbage',
      signAccessToken(std.DA.actor, { secret: 'another_secret_that_is_long_enough_000000' }),
      edited,
      signAccessToken(std.DA.actor, { expiresIn: -10 }),
    ];
    for (const token of bad) {
      const req = http(app).get('/api/v1/auth/me');
      const res = await (token ? req.set(bearer(token)) : req).expect(401);
      expect(res.body).toMatchObject({ code: 'AUTH_TOKEN_INVALID', message: 'Please sign in again.' });
    }
    // The edited token never reaches an office route.
    expect((await http(app).get('/api/v1/users').set(bearer(edited)).expect(401)).body.code).toBe('AUTH_TOKEN_INVALID');
    // Step 2.
    const R1 = signedIn.body.refreshToken as string;
    const rotated = await refresh(R1).expect(200);
    const R2 = rotated.body.refreshToken as string;
    expect(rotated.body).toMatchObject({ role: 'DISTRIBUTOR', accessToken: expect.any(String) });
    expect(R2).not.toBe(R1);
    // Step 3: R1 again is a reuse.
    expect((await refresh(R1).expect(401)).body.code).toBe('AUTH_REFRESH_INVALID');
    // Step 4: the reuse revoked the whole chain.
    expect((await refresh(R2).expect(401)).body.code).toBe('AUTH_REFRESH_INVALID');
    // A malformed refresh token is the same 401, never a 500.
    expect((await refresh('not-a-token').expect(401)).body.code).toBe('AUTH_REFRESH_INVALID');
    // Step 5.
    await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
  });

  it('SEC-010 suspending a user or changing a password ends that user\'s other sessions within 60 seconds', async () => {
    await setPassword(std.DR2.userId, 'Driver#2026');
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    const dr2 = await login(app, STANDARD_PHONES.DR2, 'Driver#2026', 'driver').expect(200);
    const phone1 = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026', 'distributor').expect(200);
    const phone2 = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026', 'distributor').expect(200);
    const tvOf = async (id: string) => (await db().user.findUniqueOrThrow({ where: { id } })).tokenVersion;
    const dr2Tv = await tvOf(std.DR2.userId);
    const daTv = await tvOf(std.DA.userId);

    // Step 1.
    await http(app)
      .patch(`/api/v1/users/${std.DR2.userId}/status`)
      .set(authHeader(std.SA1.actor))
      .send({ value: 'SUSPENDED', reason: 'Session end test' })
      .expect(200);
    expect(await tvOf(std.DR2.userId)).toBe(dr2Tv + 1);
    const statusRow = await db().auditLog.findFirstOrThrow({ where: { action: 'user.status_change', resourceId: std.DR2.userId } });
    expect(statusRow.reason).toBe('Session end test');
    // Step 2.
    const trips = await http(app).get('/api/v1/trips/mine').set(bearer(dr2.body.accessToken)).expect(401);
    expect(trips.body).toMatchObject({ code: 'AUTH_SESSION_REVOKED', message: 'Please sign in again.' });
    expect((await refresh(dr2.body.refreshToken).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    // Step 3.
    const changed = await http(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(phone1.body.accessToken))
      .send({ currentPassword: 'Shop!Pass2026', newPassword: 'NewPass#2026' })
      .expect(200);
    expect(changed.body).toMatchObject({ role: 'DISTRIBUTOR', accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(await tvOf(std.DA.userId)).toBe(daTv + 1);
    // Step 4.
    expect((await http(app).get('/api/v1/wallet').set(bearer(phone2.body.accessToken)).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    expect((await refresh(phone2.body.refreshToken).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    // Step 5: the new tokens pass the session check (the wallet itself is the money lane's).
    await http(app).get('/api/v1/users/me').set(bearer(changed.body.accessToken)).expect(200);
    expect((await http(app).get('/api/v1/wallet').set(bearer(changed.body.accessToken))).status).not.toBe(401);
    // Step 6.
    const short = await http(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(changed.body.accessToken))
      .send({ currentPassword: 'NewPass#2026', newPassword: 'short12' })
      .expect(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');
    expect(short.body.details.fields).toEqual([expect.objectContaining({ path: 'newPassword', code: 'TOO_SHORT' })]);
    // Step 7.
    await http(app)
      .patch(`/api/v1/users/${std.DR2.userId}/status`)
      .set(authHeader(std.SA1.actor))
      .send({ value: 'ACTIVE', reason: 'Session end test over' })
      .expect(200);
    await login(app, STANDARD_PHONES.DR2, 'Driver#2026', 'driver').expect(200);
  });

  it('SEC-010 a change made outside this API still ends the session within 60 seconds', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    const signedIn = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
    await me(signedIn.body.accessToken).expect(200);
    // Another process suspends the user (and bumps tv) without telling this one.
    await db().user.update({ where: { id: std.DA.userId }, data: { status: UserStatus.SUSPENDED, tokenVersion: { increment: 1 } } });
    // The cached session is trusted for at most 60 seconds...
    await me(signedIn.body.accessToken).expect(200);
    // ...after which the token is refused.
    advanceClock(61_000);
    expect((await me(signedIn.body.accessToken).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
  });

  it('SEC-010 a wrong current password is a field problem, not a sign-out', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    const signedIn = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
    const res = await http(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(signedIn.body.accessToken))
      .send({ currentPassword: 'NotMine#2026', newPassword: 'NewPass#2026' })
      .expect(400);
    expect(res.body.details.fields).toEqual([expect.objectContaining({ path: 'currentPassword', code: 'INVALID_VALUE' })]);
    await me(signedIn.body.accessToken).expect(200);
  });
});
