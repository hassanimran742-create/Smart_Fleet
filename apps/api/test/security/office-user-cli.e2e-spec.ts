/**
 * The office-user CLI (API_CONTRACT §8.5 step 8): SET-001.
 */
import type { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { runCreateOfficeUserCli } from '../../src/modules/users/cli/create-office-user';
import { createTestApp } from '../helpers/app';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createUser } from '../helpers/factories';
import { http } from '../helpers/http';
import { APP_BOOT_TIMEOUT_MS, bearer, login, setPassword, useMemoryRateLimits, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

const OWNER_PHONE = '+923331000001';
const OPS_PHONE = '+923331000002';

/** Runs the CLI and returns its exit code and printed lines. */
async function runCli(...argv: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await runCreateOfficeUserCli(argv, (line) => lines.push(line));
  return { code, lines };
}

function passwordIn(lines: string[]): string {
  const line = lines.find((l) => l.startsWith('Password, shown only this once: '));
  if (!line) throw new Error(`no password printed: ${lines.join(' | ')}`);
  return line.slice('Password, shown only this once: '.length);
}

describeDb('users: the office-user CLI', () => {
  let app: INestApplication;
  const db = () => getTestPrisma();

  beforeAll(async () => {
    app = await createTestApp();
    useMemoryRateLimits(app);
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SET-001 the office-user command creates the two named super admins', async () => {
    const branchAdmin = await createUser({ role: UserRole.ADMIN, name: 'LPG Branch Admin' });
    await setPassword(branchAdmin.id, 'Branch#2026');
    // Steps 1-2.
    const owner = await runCli('--name', 'Owner', '--phone', OWNER_PHONE);
    expect(owner.code).toBe(0);
    const ops = await runCli('--name=Ops', '--phone=0333 1000002');
    expect(ops.code).toBe(0);
    for (const [phone, name] of [
      [OWNER_PHONE, 'Owner'],
      [OPS_PHONE, 'Ops'],
    ]) {
      const user = await db().user.findUniqueOrThrow({ where: { phone } });
      expect({ name: user.name, role: user.role, status: user.status, hasPassword: user.passwordHash !== null }).toEqual({
        name,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        hasPassword: true,
      });
    }
    const ownerPassword = passwordIn(owner.lines);
    expect(ownerPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(owner.lines.filter((line) => line.includes(ownerPassword))).toHaveLength(1);
    expect(passwordIn(ops.lines)).not.toBe(ownerPassword);
    // Step 3.
    const again = await runCli('--name', 'Owner again', '--phone', '0333 1000001');
    expect(again.code).toBe(1);
    expect(again.lines.join('\n')).toContain('USER_PHONE_IN_USE: This phone number is already used by another account.');
    expect(await db().user.count({ where: { phone: OWNER_PHONE } })).toBe(1);
    expect(await db().user.count({ where: { role: UserRole.SUPER_ADMIN } })).toBe(2);
    // Step 4.
    const signedIn = await login(app, OWNER_PHONE, ownerPassword, 'admin-web').expect(200);
    expect(signedIn.body.role).toBe('SUPER_ADMIN');
    const locked = await login(app, branchAdmin.phone, 'Branch#2026', 'admin-web').expect(403);
    expect(locked.body).toMatchObject({ code: 'AUTH_ROLE_LOCKED', message: "This account can't sign in. Call the office." });
    // Step 5.
    const logs = await http(app).get('/api/v1/audit-logs').query({ action: 'user.create_office' }).set(bearer(signedIn.body.accessToken)).expect(200);
    expect(logs.body.items).toHaveLength(2);
    for (const row of logs.body.items) expect(row.actor).toEqual({ kind: 'SYSTEM', label: 'cli:create-office' });
    expect(JSON.stringify(logs.body)).not.toContain(ownerPassword);
  });

  it('SET-001 the command refuses bad arguments and creates nothing', async () => {
    for (const argv of [[], ['--name', 'Owner'], ['--phone', OWNER_PHONE], ['--name', 'Owner', '--phone', '12345'], ['--name', 'Owner', '--phone', OWNER_PHONE, '--role', 'ADMIN']]) {
      const run = await runCli(...argv);
      expect({ argv, code: run.code }).toEqual({ argv, code: 2 });
    }
    expect(await db().user.count()).toBe(0);
  });
});
