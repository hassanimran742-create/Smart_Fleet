/**
 * Database helpers for DB test suites (`npm run test:e2e`).
 *
 * - DB suites run only when DATABASE_URL is set: wrap them in `describeDb(...)`, which is
 *   `describe.skip` otherwise, so `npm run test:e2e` without a database skips cleanly.
 * - The database is migrated (or reset) once per run by global-setup.ts, and every table is
 *   truncated before each suite by e2e-setup.ts. Suites run one at a time (jest-e2e.json).
 * - Truncation refuses any database whose name doesn't contain "test" (CI: smartfleet_test), unless
 *   E2E_ALLOW_DB names it, so a mistyped DATABASE_URL can never wipe a real database.
 *
 * Local run against the Docker test server (infrastructure/docker-compose.test.yml), with a database
 * of your own (suites truncate it, so two runs must never share one):
 *   docker exec smartfleet-postgres-test psql -U smartfleet -d smartfleet_test -c "CREATE DATABASE sf_mine_test"
 *   DATABASE_URL=postgresql://smartfleet:smartfleet_test@localhost:55432/sf_mine_test npm run test:e2e
 * E2E_DB_RESET=1 rebuilds it from scratch (prisma migrate reset) instead of migrate deploy.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

export const API_DIR = path.resolve(__dirname, '..', '..');
export const SCHEMA_PATH = path.join(API_DIR, 'prisma', 'schema.prisma');

/**
 * True when DB suites can run. Read at import time, before any app module loads a .env file.
 * (describeDb lives in describe-db.ts: this module is also loaded by global-setup.ts, where Jest's
 * globals don't exist.)
 */
export const hasTestDb = Boolean(process.env.DATABASE_URL);

/**
 * The expense types the inc1a migration seeds (DATA_MODEL §3.4 item 11). resetDb() restores them
 * after truncating, so every suite starts from the state a fresh migration leaves. A unit test
 * (seeded-reference.spec.ts) keeps this list equal to the migration's.
 */
export const SEEDED_EXPENSE_TYPES = [
  { code: 'PETROL', name: 'Petrol', nameKey: 'petrol', isSystem: true, sortOrder: 10 },
  { code: 'MAINTENANCE', name: 'Maintenance', nameKey: 'maintenance', isSystem: false, sortOrder: 20 },
  { code: 'REPAIRS', name: 'Repairs', nameKey: 'repairs', isSystem: false, sortOrder: 30 },
  { code: 'TYRES', name: 'Tyres', nameKey: 'tyres', isSystem: false, sortOrder: 40 },
  { code: 'TOLL_PARKING', name: 'Toll/Parking', nameKey: 'toll/parking', isSystem: false, sortOrder: 50 },
  { code: 'OTHER', name: 'Other', nameKey: 'other', isSystem: true, sortOrder: 999 },
] as const;

/** Throws unless DATABASE_URL points at a database that is safe to truncate. Returns its name. */
export function assertSafeTestDatabase(url: string | undefined = process.env.DATABASE_URL): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    throw new Error(`Refusing to run DB tests with NODE_ENV=${process.env.NODE_ENV}`);
  }
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!name) throw new Error('DATABASE_URL names no database');
  if (!/test/i.test(name) && process.env.E2E_ALLOW_DB !== name) {
    throw new Error(
      `Refusing to truncate database "${name}": DB tests only run on a database whose name contains "test". ` +
        `Use a dedicated test database, or set E2E_ALLOW_DB=${name} if this one is disposable.`,
    );
  }
  return name;
}

let client: PrismaClient | undefined;

/** One PrismaClient per suite (Jest gives every test file its own module registry). */
export function getTestPrisma(): PrismaClient {
  if (!hasTestDb) throw new Error('DATABASE_URL is not set; wrap DB suites in describeDb()');
  client ??= new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  const c = client;
  client = undefined;
  if (c) await c.$disconnect();
}

/**
 * Brings the test database to the current migrations: `prisma migrate deploy`, or, with
 * E2E_DB_RESET=1, `prisma migrate reset` (drops everything, then applies every migration).
 * Uses the installed CLI directly, so no shell or npx is involved.
 */
export function migrateTestDb(opts: { reset?: boolean } = {}): void {
  assertSafeTestDatabase();
  const cli = require.resolve('prisma/build/index.js');
  const args = opts.reset
    ? ['migrate', 'reset', '--force', '--skip-seed', '--skip-generate', '--schema', SCHEMA_PATH]
    : ['migrate', 'deploy', '--schema', SCHEMA_PATH];
  execFileSync(process.execPath, [cli, ...args], { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
}

/**
 * Empties every application table (not _prisma_migrations, not PostGIS's own tables), then
 * restores the rows the migrations seed. Called before each suite by e2e-setup.ts; call it in a
 * beforeEach when a suite needs a clean database per test.
 */
export async function resetDb(db: PrismaClient = getTestPrisma()): Promise<void> {
  assertSafeTestDatabase();
  const tables = await db.$queryRaw<Array<{ name: string }>>`
    SELECT quote_ident(c.relname) AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relname`;
  if (tables.length) {
    // Identifiers come from the catalog, quoted by quote_ident().
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await seedReferenceRows(db);
}

/** Re-inserts the migration-seeded reference rows (idempotent). */
export async function seedReferenceRows(db: PrismaClient = getTestPrisma()): Promise<void> {
  for (const t of SEEDED_EXPENSE_TYPES) {
    await db.$executeRaw`
      INSERT INTO expense_types (id, code, name, name_key, is_system, sort_order, created_at, updated_at)
      VALUES (gen_random_uuid(), ${t.code}, ${t.name}, ${t.nameKey}, ${t.isSystem}, ${t.sortOrder}, now(), now())
      ON CONFLICT (code) DO NOTHING`;
  }
}

/**
 * The nightly wallet check (DATA_MODEL §3.6): distributors whose ledger sum differs from the
 * balance, or whose balance is negative. Empty when every wallet is consistent.
 */
export async function walletMismatches(
  db: PrismaClient = getTestPrisma(),
): Promise<Array<{ id: string; balancePaisa: bigint; ledgerPaisa: bigint }>> {
  return db.$queryRaw`
    SELECT d.id, d.advance_balance_paisa AS "balancePaisa", COALESCE(sum(l.amount_paisa), 0)::bigint AS "ledgerPaisa"
    FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
    GROUP BY d.id
    HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
}
