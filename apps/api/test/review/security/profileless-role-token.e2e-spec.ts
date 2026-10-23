/**
 * Security review (Increment 1), REV-SEC-03: a DISTRIBUTOR (or DRIVER) login without its profile row.
 *
 * API_CONTRACT §3.2: "Distributor-scoped queries always filter by auth.distributorId from the token ...
 * Today `where: {distributorId: undefined}` drops the filter." Before the fix, orders, customers,
 * refills and trips cast `actor.distributorId as string` / `actor.driverId as string` and passed
 * `undefined` to Prisma, which dropped the filter: such a token read every distributor's orders and
 * customers and every driver's trips.
 *
 * Such users are legacy data: the pre-pilot `PATCH /users/:id/role` (af889bf users.service.ts setRole)
 * set any role on any user, and the old OTP verify created users for any phone. Only the legacy rows
 * (and, for the second half, the password and status the old API could have given them) are written
 * directly; everything else goes through HTTP. What must hold now:
 * - the office can't give such a user a password or make it ACTIVE (403 PERMISSION_DENIED);
 * - a legacy row that already has both can't sign in (403 AUTH_ACCOUNT_NOT_ACTIVE) or refresh;
 * - a token the old login issued (no distributorId / driverId) reads nothing: every route, and the
 *   `/drivers` socket, refuse it with 401 AUTH_SESSION_REVOKED, so the apps sign out instead of
 *   reading other tenants' rows (and the sign-in that follows is refused, so they don't loop).
 */
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus, type User } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { createTestApp } from '../../helpers/app';
import { authHeader, signAccessToken } from '../../helpers/auth';
import { getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../../helpers/standard-data';
import {
  APP_BOOT_TIMEOUT_MS,
  bearer,
  claimsOf,
  connectDrivers,
  listen,
  login,
  setPassword,
  TEST_TIMEOUT_MS,
  useMemoryRateLimits,
} from '../../security/security-helpers';

jest.setTimeout(TEST_TIMEOUT_MS);

const PASSWORD = 'Legacy#Shop2026';
const REVOKED = { status: 401, code: 'AUTH_SESSION_REVOKED' };

describeDb('review security: a role token without its profile', () => {
  let app: INestApplication;
  let baseUrl: string;
  let std: StandardData;
  const db = () => getTestPrisma();

  beforeAll(async () => {
    app = await createTestApp();
    baseUrl = await listen(app);
    useMemoryRateLimits(app);
    await resetDb();
    std = await createStandardData();
  }, APP_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  /** A legacy user row: the role, but no distributors/drivers row. */
  function legacyUser(role: UserRole, phone: string): Promise<User> {
    return db().user.create({ data: { phone, name: `Legacy ${role}`, role, status: UserStatus.PENDING } });
  }

  /** The office's two set-up calls, which must both be refused for such a user. */
  async function officeSetUp(userId: string) {
    const office = authHeader(std.SA1.actor);
    const password = await http(app).post(`/api/v1/users/${userId}/password`).set(office).send({ password: PASSWORD });
    const activate = await http(app).patch(`/api/v1/users/${userId}/status`).set(office).send({ value: 'ACTIVE', reason: 'Legacy shop onboarding' });
    return { password: [password.status, password.body.code], activate: [activate.status, activate.body.code] };
  }

  /** The pair the pre-fix login issued for such a user: the claims without the profile id, and a stored refresh token. */
  async function oldLoginTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = signAccessToken({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion });
    const refreshToken = new JwtService().sign(
      { sub: user.id, role: user.role, tv: user.tokenVersion, jti: randomUUID() },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: 3600 },
    );
    await db().refreshToken.create({
      data: { userId: user.id, tokenHash: createHash('sha256').update(refreshToken).digest('hex'), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { accessToken, refreshToken };
  }

  /** A legacy row that already has a password and ACTIVE status, as the pre-pilot API could leave it. */
  async function alreadySetUp(user: User): Promise<void> {
    await setPassword(user.id, PASSWORD);
    await db().user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } });
  }

  const outcome = (res: { status: number; body: { code?: string } }) => ({ status: res.status, code: res.body.code });

  it('REV-SEC-03 a DISTRIBUTOR token without distributorId must be refused, not read every tenant', async () => {
    // Real data of both shops: DA's order X1 (Sana), customers C1, C2 (DA) and C3 (DB), and a refill of DA.
    const x1 = await http(app).post('/api/v1/orders').set(authHeader(std.DA.actor)).send(x1OrderBody(std)).expect(201);
    const station = await http(app)
      .post('/api/v1/filling-stations')
      .set(authHeader(std.SA1.actor))
      .send({ name: 'Review Station', address: 'Ring Road', lat: 31.52, lng: 74.25 })
      .expect(201);
    await http(app)
      .post('/api/v1/filling-orders')
      .set(authHeader(std.DA.actor))
      .send({ fillingStationId: station.body.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 3 })
      .expect(201);
    expect(x1.body.id).toBeTruthy();

    const user = await legacyUser(UserRole.DISTRIBUTOR, '+923339990011');
    // The office can no longer give it a password or make it ACTIVE, and nothing changed.
    expect(await officeSetUp(user.id)).toEqual({ password: [403, 'PERMISSION_DENIED'], activate: [403, 'PERMISSION_DENIED'] });
    expect(await db().user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ passwordHash: null, status: 'PENDING', tokenVersion: 0 });

    // A row that already has both can't sign in: no tokens.
    await alreadySetUp(user);
    const signIn = await login(app, '+923339990011', PASSWORD);
    expect({ ...outcome(signIn), accessToken: signIn.body.accessToken }).toEqual({ status: 403, code: 'AUTH_ACCOUNT_NOT_ACTIVE', accessToken: undefined });

    // A token the old login issued reads nothing: the money routes and the tenant routes refuse it alike.
    const old = await oldLoginTokens(user);
    expect(claimsOf(old.accessToken)).toMatchObject({ role: 'DISTRIBUTOR' });
    expect(claimsOf(old.accessToken).distributorId).toBeUndefined();
    const seen: Record<string, unknown> = {};
    for (const path of ['/wallet', '/orders', '/clients', '/filling-orders/mine', '/users/me']) {
      const res = await http(app).get(`/api/v1${path}`).set(bearer(old.accessToken));
      seen[path] = { ...outcome(res), leaked: Array.isArray(res.body) ? res.body.length : undefined };
    }
    expect(seen).toEqual({
      '/wallet': REVOKED,
      '/orders': REVOKED,
      '/clients': REVOKED,
      '/filling-orders/mine': REVOKED,
      '/users/me': REVOKED,
    });
    // Its refresh token gets no new pair either, so the app signs out (and the sign-in above is refused).
    const refreshed = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: old.refreshToken });
    expect({ ...outcome(refreshed), accessToken: refreshed.body.accessToken }).toEqual({ ...REVOKED, accessToken: undefined });
  });

  it('REV-SEC-03 a DRIVER token without driverId must be refused, not read every driver\'s trips', async () => {
    const x1 = await db().order.findFirstOrThrow({ where: { distributorId: std.DA.id } });
    await http(app).post(`/api/v1/orders/${x1.id}/assign-driver`).set(authHeader(std.SA1.actor)).send({ driverId: std.DR1.id }).expect(200);

    const user = await legacyUser(UserRole.DRIVER, '+923339990012');
    expect(await officeSetUp(user.id)).toEqual({ password: [403, 'PERMISSION_DENIED'], activate: [403, 'PERMISSION_DENIED'] });

    await alreadySetUp(user);
    expect(outcome(await login(app, '+923339990012', PASSWORD))).toEqual({ status: 403, code: 'AUTH_ACCOUNT_NOT_ACTIVE' });

    const old = await oldLoginTokens(user);
    expect(claimsOf(old.accessToken).driverId).toBeUndefined();
    const trips = await http(app).get('/api/v1/trips/mine').set(bearer(old.accessToken));
    const suggestions = await http(app).get('/api/v1/trips/next-suggestions').set(bearer(old.accessToken));
    const refills = await http(app).get('/api/v1/filling-orders/driver/mine').set(bearer(old.accessToken));
    expect({ trips: outcome(trips), suggestions: outcome(suggestions), refills: outcome(refills) }).toEqual({
      trips: REVOKED,
      suggestions: REVOKED,
      refills: REVOKED,
    });
    expect(outcome(await http(app).post('/api/v1/auth/refresh').send({ refreshToken: old.refreshToken }))).toEqual(REVOKED);

    // The live-position socket refuses it the same way.
    const socket = connectDrivers(baseUrl, old.accessToken);
    try {
      expect(await socket.next('error')).toEqual({ code: 'AUTH_SESSION_REVOKED' });
      await socket.next('disconnect');
    } finally {
      socket.socket.disconnect();
    }
  });
});
