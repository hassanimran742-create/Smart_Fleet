// Unit tests for the test harness itself (no database): `npm test`.
import * as fs from 'fs';
import * as path from 'path';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { accessSecret, authHeader, signAccessToken, tokenFor } from './auth';
import { API_DIR, SEEDED_EXPENSE_TYPES, assertSafeTestDatabase } from './db';
import { uniqueDistributorCode, uniquePhone } from './factories';

const jwt = new JwtService();
const decode = (token: string) => jwt.verify<Record<string, unknown>>(token, { secret: accessSecret() });

describe('assertSafeTestDatabase', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('accepts a database whose name contains "test"', () => {
    expect(assertSafeTestDatabase('postgresql://u:p@localhost:5432/smartfleet_test?schema=public')).toBe('smartfleet_test');
    expect(assertSafeTestDatabase('postgresql://u:p@localhost:55432/sf_e2e_TEST')).toBe('sf_e2e_TEST');
  });

  it('refuses any other database unless E2E_ALLOW_DB names it', () => {
    expect(() => assertSafeTestDatabase('postgresql://u:p@localhost:5432/smartfleet')).toThrow(/Refusing to truncate database "smartfleet"/);
    process.env.E2E_ALLOW_DB = 'scratch_db';
    expect(assertSafeTestDatabase('postgresql://u:p@localhost:5432/scratch_db')).toBe('scratch_db');
    expect(() => assertSafeTestDatabase('postgresql://u:p@localhost:5432/smartfleet')).toThrow();
  });

  it('refuses production and staging, a missing URL and a URL with no database', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertSafeTestDatabase('postgresql://u:p@h/smartfleet_test')).toThrow(/NODE_ENV=production/);
    process.env.NODE_ENV = 'staging';
    expect(() => assertSafeTestDatabase('postgresql://u:p@h/smartfleet_test')).toThrow(/NODE_ENV=staging/);
    process.env.NODE_ENV = 'test';
    expect(() => assertSafeTestDatabase('')).toThrow(/not set/);
    expect(() => assertSafeTestDatabase('postgresql://u:p@h/')).toThrow(/names no database/);
  });
});

describe('token helpers', () => {
  it('signs the claims AuthService issues, plus the token version', () => {
    const claims = decode(
      signAccessToken({ userId: 'u-1', role: UserRole.DISTRIBUTOR, distributorId: 'd-1', tokenVersion: 3 }),
    );
    expect(claims).toMatchObject({ sub: 'u-1', role: 'DISTRIBUTOR', distributorId: 'd-1', tv: 3 });
    expect(claims).not.toHaveProperty('driverId');
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
  });

  it('has one helper per role', () => {
    expect(decode(tokenFor.superAdmin({ userId: 'a' }))).toMatchObject({ sub: 'a', role: 'SUPER_ADMIN', tv: 0 });
    expect(decode(tokenFor.admin({ userId: 'b' })).role).toBe('ADMIN');
    expect(decode(tokenFor.dispatcher({ userId: 'c' })).role).toBe('DISPATCHER');
    expect(decode(tokenFor.storeKeeper({ userId: 'd' })).role).toBe('STORE_KEEPER');
    expect(decode(tokenFor.distributor({ userId: 'e', distributorId: 'de' }))).toMatchObject({ role: 'DISTRIBUTOR', distributorId: 'de' });
    expect(decode(tokenFor.driver({ userId: 'f', driverId: 'df' }))).toMatchObject({ role: 'DRIVER', driverId: 'df' });
    expect(decode(tokenFor.client({ userId: 'g', clientId: 'cg' }))).toMatchObject({ role: 'CLIENT', clientId: 'cg' });
  });

  it('builds a bearer header', () => {
    const { Authorization } = authHeader({ userId: 'u', role: UserRole.DRIVER, driverId: 'x' });
    expect(Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(decode(Authorization.slice('Bearer '.length)).driverId).toBe('x');
  });

  it('can make expired and forged tokens for negative tests', () => {
    const actor = { userId: 'u', role: UserRole.SUPER_ADMIN };
    expect(() => decode(signAccessToken(actor, { expiresIn: -60 }))).toThrow(/expired/);
    expect(() => decode(signAccessToken(actor, { secret: 'someone-else' }))).toThrow(/signature/);
  });

  it('uses the secret the test setup provides', () => {
    expect(accessSecret()).toBe(process.env.JWT_ACCESS_SECRET);
    expect(accessSecret().length).toBeGreaterThanOrEqual(32);
  });
});

describe('factories (no database)', () => {
  it('makes unique E.164 phones and valid distributor codes', () => {
    const phones = new Set(Array.from({ length: 50 }, () => uniquePhone()));
    const codes = new Set(Array.from({ length: 50 }, () => uniqueDistributorCode()));
    expect(phones.size).toBe(50);
    expect(codes.size).toBe(50);
    for (const p of phones) expect(p).toMatch(/^\+923[0-9]{9}$/);
    for (const c of codes) expect(c).toMatch(/^[A-Z][A-Z0-9]{1,5}$/);
  });
});

describe('reference rows restored by resetDb()', () => {
  it('match the expense types the migrations seed', () => {
    const dir = path.join(API_DIR, 'prisma', 'migrations');
    const seeded: Array<{ code: string; name: string; nameKey: string; isSystem: boolean; sortOrder: number }> = [];
    for (const m of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, m, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      const sql = fs.readFileSync(file, 'utf8');
      const insert = /INSERT INTO expense_types \(id, code, name, name_key, is_system, sort_order, created_at, updated_at\) VALUES([\s\S]*?)ON CONFLICT/g;
      for (const block of sql.matchAll(insert)) {
        for (const row of block[1].matchAll(/\(gen_random_uuid\(\),'([^']+)','([^']+)','([^']+)',(true|false),(\d+),now\(\),now\(\)\)/g)) {
          seeded.push({ code: row[1], name: row[2], nameKey: row[3], isSystem: row[4] === 'true', sortOrder: Number(row[5]) });
        }
      }
    }
    expect(seeded).toEqual(SEEDED_EXPENSE_TYPES.map((t) => ({ ...t })));
  });
});
