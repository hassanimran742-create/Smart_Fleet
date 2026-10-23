/**
 * Users and the office's account controls (API_CONTRACT §3.3, §7.2): SEC-023, SEC-024, SEC-025 and
 * SEC-026.
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
import { bearer, forgetSessions, login, secretsIn, setPassword, useMemoryRateLimits, type MemoryRateLimitStore, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

describeDb('users: own profile and the office account controls', () => {
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

  it('SEC-023 only the super admin changes a role, with a reason and an audit row, and unsafe changes are refused', async () => {
    const branchAdmin = await createUser({ role: UserRole.ADMIN, name: 'LPG Branch Admin' });
    const role = (id: string, body: Record<string, unknown>, as = office()) => http(app).patch(`/api/v1/users/${id}/role`).set(as).send(body);
    const changeRows = () => db().auditLog.count({ where: { action: { in: ['user.role_change', 'user.status_change'] } } });

    // Step 1.
    expect((await role(branchAdmin.id, { value: 'DISPATCHER', reason: 'Role change test' }, authHeader(std.DA.actor)).expect(403)).body.code).toBe(
      'PERMISSION_DENIED',
    );
    // Step 2.
    expect((await role(std.SA1.id, { value: 'DISPATCHER', reason: 'Self change test' }).expect(403)).body).toMatchObject({
      code: 'USER_SELF_CHANGE_NOT_ALLOWED',
      message: "You can't change your own account this way.",
    });
    const selfStatus = await http(app)
      .patch(`/api/v1/users/${std.SA1.id}/status`)
      .set(office())
      .send({ value: 'SUSPENDED', reason: 'Self suspend test' })
      .expect(403);
    expect(selfStatus.body.code).toBe('USER_SELF_CHANGE_NOT_ALLOWED');
    // Steps 3-4.
    expect((await role(branchAdmin.id, { value: 'SUPER_ADMIN', reason: 'Promote test' }).expect(403)).body).toMatchObject({
      code: 'USER_ROLE_CHANGE_NOT_ALLOWED',
      message: "This role change isn't allowed.",
    });
    expect((await role(std.DR2.userId, { value: 'DISTRIBUTOR', reason: 'Profile mismatch test' }).expect(403)).body.code).toBe(
      'USER_ROLE_CHANGE_NOT_ALLOWED',
    );
    // Step 5.
    const noReason = await role(branchAdmin.id, { value: 'DISPATCHER' }).expect(400);
    expect(noReason.body.code).toBe('VALIDATION_FAILED');
    expect(noReason.body.details.fields).toEqual([expect.objectContaining({ path: 'reason', code: 'REQUIRED' })]);
    expect(await changeRows()).toBe(0);
    expect((await db().user.findUniqueOrThrow({ where: { id: branchAdmin.id } })).role).toBe(UserRole.ADMIN);
    // Step 6.
    const tvBefore = (await db().user.findUniqueOrThrow({ where: { id: branchAdmin.id } })).tokenVersion;
    const changed = await role(branchAdmin.id, { value: 'DISPATCHER', reason: 'Role change test for audit' }).expect(200);
    expect(changed.body).toMatchObject({ id: branchAdmin.id, role: 'DISPATCHER' });
    expect(secretsIn(changed.body)).toEqual([]);
    const after = await db().user.findUniqueOrThrow({ where: { id: branchAdmin.id } });
    expect(after.tokenVersion).toBe(tvBefore + 1);
    const rows = await db().auditLog.findMany({ where: { action: 'user.role_change', resourceId: branchAdmin.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: std.SA1.id, reason: 'Role change test for audit' });
    expect(rows[0].diff).toMatchObject({ before: { role: 'ADMIN' }, after: { role: 'DISPATCHER' } });
    await role(branchAdmin.id, { value: 'ADMIN', reason: 'Back to the seeded role' }).expect(200);
    // A repeat changes nothing.
    const repeat = await role(branchAdmin.id, { value: 'ADMIN', reason: 'Back to the seeded role' }).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(await db().auditLog.count({ where: { action: 'user.role_change', resourceId: branchAdmin.id } })).toBe(2);
  });

  it('SEC-024 two super admins suspending each other at the same time can\'t lock the office out', async () => {
    for (let run = 0; run < 20; run++) {
      const [sa1, sa2] = await Promise.all(
        [std.SA1.id, std.SA2.id].map((id) => db().user.findUniqueOrThrow({ where: { id } })),
      );
      const token1 = signAccessToken({ ...std.SA1.actor, tokenVersion: sa1.tokenVersion });
      const token2 = signAccessToken({ ...std.SA2.actor, tokenVersion: sa2.tokenVersion });
      const rowsBefore = await db().auditLog.count({ where: { action: 'user.status_change' } });
      const results = await Promise.all([
        http(app).patch(`/api/v1/users/${std.SA2.id}/status`).set(bearer(token1)).send({ value: 'SUSPENDED', reason: 'Race test A' }),
        http(app).patch(`/api/v1/users/${std.SA1.id}/status`).set(bearer(token2)).send({ value: 'SUSPENDED', reason: 'Race test B' }),
      ]);
      const outcome = results.map((r) => (r.status === 200 ? 'ok' : `${r.status} ${r.body.code}`)).sort();
      expect({ run, outcome }).toEqual({ run, outcome: ['401 AUTH_SESSION_REVOKED', 'ok'] });
      const active = await db().user.count({ where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE } });
      expect({ run, active }).toEqual({ run, active: 1 });
      expect(await db().auditLog.count({ where: { action: 'user.status_change' } })).toBe(rowsBefore + 1);
      // Reactivate the suspended one directly, as ops would, for the next run.
      await db().user.updateMany({ where: { role: UserRole.SUPER_ADMIN }, data: { status: UserStatus.ACTIVE } });
      forgetSessions(app, std.SA1.id, std.SA2.id);
    }
  }, 180_000);

  it('SEC-025 a user can change only their own name and email; phone, CNIC and business name are office-only', async () => {
    const shop = authHeader(std.DA.actor);
    const before = await db().user.findUniqueOrThrow({ where: { id: std.DA.userId }, include: { distributorProfile: true } });
    // Step 1.
    const updated = await http(app).patch('/api/v1/users/me').set(shop).send({ name: 'Ahmed Raza', email: 'ahmed@example.com' }).expect(200);
    expect(updated.body).toMatchObject({ name: 'Ahmed Raza', email: 'ahmed@example.com' });
    expect(secretsIn(updated.body)).toEqual([]);
    // Steps 2-4.
    const refused = [
      [shop, { phone: '0321 7654321' }],
      [shop, { cnic: '35202-1234567-1' }],
      [shop, { businessName: 'Ahmed Gas & Sons' }],
      [shop, { name: 'Ahmed', phone: '0321 7654321' }],
      [authHeader(std.DR1.actor), { phone: '0333 1112222' }],
    ] as const;
    for (const [as, body] of refused) {
      const res = await http(app).patch('/api/v1/users/me').set(as).send(body).expect(403);
      expect(res.body).toMatchObject({ code: 'USER_FIELD_OFFICE_ONLY', message: 'Ask the office to change this.' });
    }
    // Step 5.
    const profile = await http(app).get('/api/v1/users/me').set(shop).expect(200);
    expect(profile.body).toMatchObject({ name: 'Ahmed Raza', email: 'ahmed@example.com', phone: STANDARD_PHONES.DA });
    const after = await db().user.findUniqueOrThrow({ where: { id: std.DA.userId }, include: { distributorProfile: true } });
    expect({ phone: after.phone, cnic: after.cnic, cnicIndex: after.cnicIndex, tv: after.tokenVersion }).toEqual({
      phone: before.phone,
      cnic: before.cnic,
      cnicIndex: before.cnicIndex,
      tv: before.tokenVersion,
    });
    expect(after.distributorProfile?.businessName).toBe(before.distributorProfile?.businessName);
    // An email another account uses is a duplicate.
    await db().user.update({ where: { id: std.DB.userId }, data: { email: 'bilal@example.com' } });
    expect((await http(app).patch('/api/v1/users/me').set(shop).send({ email: 'bilal@example.com' }).expect(409)).body.code).toBe('CONFLICT_DUPLICATE');
  });

  it('SEC-026 the office resets an app password: old sessions end, it is audited, and unsafe targets are refused', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    const client = await createUser({ role: UserRole.CLIENT, name: 'Client Test' });
    await setPassword(std.SA2.id, 'Ops#Pass2026');
    await setPassword(client.id, 'Client#Pass2026');
    const phone = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
    const tvBefore = (await db().user.findUniqueOrThrow({ where: { id: std.DA.userId } })).tokenVersion;
    const reset = (id: string, password: string, as = office()) => http(app).post(`/api/v1/users/${id}/password`).set(as).send({ password });

    // Step 1.
    expect((await reset(std.DA.userId, 'NewShop#2026').expect(200)).body).toEqual({ ok: true });
    expect((await db().user.findUniqueOrThrow({ where: { id: std.DA.userId } })).tokenVersion).toBe(tvBefore + 1);
    // Step 2.
    expect((await http(app).get('/api/v1/wallet').set(bearer(phone.body.accessToken)).expect(401)).body.code).toBe('AUTH_SESSION_REVOKED');
    expect((await http(app).post('/api/v1/auth/refresh').send({ refreshToken: phone.body.refreshToken }).expect(401)).body.code).toBe(
      'AUTH_SESSION_REVOKED',
    );
    // Step 3.
    expect((await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(401)).body.code).toBe('AUTH_INVALID_CREDENTIALS');
    const again = await login(app, STANDARD_PHONES.DA, 'NewShop#2026').expect(200);
    // Step 4.
    const hashes = async () =>
      (await db().user.findMany({ where: { id: { in: [std.SA2.id, client.id] } }, select: { id: true, passwordHash: true }, orderBy: { id: 'asc' } }));
    const kept = await hashes();
    expect((await reset(std.SA2.id, 'Office#2026x').expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect((await reset(client.id, 'Client#2026x').expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect(await hashes()).toEqual(kept);
    // Step 5.
    expect((await reset(std.DR1.userId, 'Driver#2026x', bearer(again.body.accessToken)).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 6.
    expect((await reset(std.SA1.id, 'Owner#2026x').expect(403)).body.code).toBe('USER_SELF_CHANGE_NOT_ALLOWED');
    // Unknown and malformed ids.
    expect((await reset('00000000-0000-4000-8000-000000000000', 'Nobody#2026').expect(404)).body.code).toBe('NOT_FOUND');
    expect((await reset('not-an-id', 'Nobody#2026').expect(404)).body.code).toBe('NOT_FOUND');
    // Step 7.
    const logs = await http(app).get('/api/v1/audit-logs').query({ action: 'user.password_reset' }).set(office()).expect(200);
    expect(logs.body.items).toHaveLength(1);
    expect(logs.body.items[0]).toMatchObject({ resourceId: std.DA.userId, actor: { kind: 'USER', userId: std.SA1.id } });
    expect(JSON.stringify(logs.body)).not.toMatch(/NewShop#2026|\$argon2/);
    const row = await db().auditLog.findFirstOrThrow({ where: { action: 'user.password_reset' } });
    expect(JSON.stringify(row)).not.toMatch(/NewShop#2026|\$argon2/);
  });
});
