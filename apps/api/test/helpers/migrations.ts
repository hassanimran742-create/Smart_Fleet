/**
 * Helpers for the migration suites (test/migrations, MIG-*): throwaway databases on the test server,
 * the Prisma CLI, old-style (af889bf, `db push`) databases and copies of the two releases that
 * `prisma/scripts/migrate.sh` is run from (DATA_MODEL §2.3):
 *
 * - the baseline release: the af889bf schema with only `0_baseline` (test/migrations/fixtures);
 * - the inc1a release: today's schema with every migration.
 *
 * Every database made here has a name containing "test" and is dropped by `drop()`. migrate.sh runs
 * under `sh` with an `npx` shim on PATH that calls the installed Prisma CLI, so nothing is downloaded.
 */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { API_DIR, assertSafeTestDatabase } from './db';

export const PRISMA_DIR = path.join(API_DIR, 'prisma');
export const MIGRATIONS_DIR = path.join(PRISMA_DIR, 'migrations');
export const FIXTURES_DIR = path.join(API_DIR, 'test', 'migrations', 'fixtures');
/** prisma/schema.prisma at af889bf, the schema 0_baseline was generated from. */
export const AF889BF_SCHEMA = path.join(FIXTURES_DIR, 'schema.af889bf.prisma');
export const INC1A_MIGRATION = '20261021195005_inc1a_foundations';

const PRISMA_CLI = require.resolve('prisma/build/index.js');

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout and stderr together, for messages. */
  output: string;
}

function result(run: ReturnType<typeof spawnSync>): CommandResult {
  const stdout = run.stdout?.toString() ?? '';
  const stderr = run.stderr?.toString() ?? '';
  return { code: run.status ?? (run.error ? 1 : 0), stdout, stderr, output: `${stdout}\n${stderr}` };
}

/** Runs the installed Prisma CLI with DATABASE_URL set to `url`. */
export function prisma(args: string[], url: string, cwd: string = API_DIR): CommandResult {
  return result(
    spawnSync(process.execPath, [PRISMA_CLI, ...args], {
      cwd,
      env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
    }),
  );
}

/** Like {@link prisma}, but throws with the CLI's output when it fails. */
export function prismaOk(args: string[], url: string, cwd?: string): CommandResult {
  const run = prisma(args, url, cwd);
  if (run.code !== 0) throw new Error(`prisma ${args.join(' ')} failed (${run.code}):\n${run.output}`);
  return run;
}

/** Runs a SQL file against `url` (`prisma db execute`). */
export function executeSqlFile(url: string, file: string): CommandResult {
  return prisma(['db', 'execute', '--url', url, '--file', file], url);
}

export function executeSql(url: string, sql: string): CommandResult {
  const file = path.join(scratchRoot(), `sql-${randomBytes(4).toString('hex')}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  try {
    return executeSqlFile(url, file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

let root: string | undefined;
/** One scratch folder per test file, outside the repository. */
export function scratchRoot(): string {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mig-tests-'));
  return root;
}

export function removeScratchRoot(): void {
  const dir = root;
  root = undefined;
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Windows may still hold a file the Prisma CLI used; the OS cleans its temp folder.
  }
}

export interface ScratchDb {
  name: string;
  url: string;
  client(): PrismaClient;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** The server's maintenance database, for CREATE and DROP DATABASE. */
function maintenanceUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set');
  assertSafeTestDatabase(base);
  return withDatabase(base, 'postgres');
}

let admin: PrismaClient | undefined;
function adminClient(): PrismaClient {
  admin ??= new PrismaClient({ datasources: { db: { url: maintenanceUrl() } } });
  return admin;
}

export async function disconnectAdmin(): Promise<void> {
  const client = admin;
  admin = undefined;
  if (client) await client.$disconnect();
}

/** A new empty database named `sfmig_<label>_<random>_test` on the test server. */
export async function createScratchDb(label: string): Promise<ScratchDb> {
  const name = `sfmig_${label.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20)}_${randomBytes(3).toString('hex')}_test`;
  await adminClient().$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = withDatabase(process.env.DATABASE_URL as string, name);
  let client: PrismaClient | undefined;
  return {
    name,
    url,
    client() {
      client ??= new PrismaClient({ datasources: { db: { url } } });
      return client;
    },
    async drop() {
      if (client) await client.$disconnect();
      client = undefined;
      await adminClient().$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/** An old database as the af889bf deploys made it: `prisma db push` of the af889bf schema, no migration history. */
export function pushAf889bfSchema(db: ScratchDb): void {
  prismaOk(['db', 'push', '--schema', AF889BF_SCHEMA, '--skip-generate'], db.url);
}

export type ReleaseKind = 'baseline' | 'inc1a';

/** A copy of `apps/api/prisma` as one release ships it; returns the path of its migrate.sh. */
export function makeRelease(kind: ReleaseKind): string {
  const dir = path.join(scratchRoot(), `${kind}-${randomBytes(3).toString('hex')}`, 'prisma');
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  fs.cpSync(path.join(PRISMA_DIR, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(MIGRATIONS_DIR, 'migration_lock.toml'), path.join(dir, 'migrations', 'migration_lock.toml'));
  if (kind === 'baseline') {
    fs.copyFileSync(AF889BF_SCHEMA, path.join(dir, 'schema.prisma'));
    fs.cpSync(path.join(MIGRATIONS_DIR, '0_baseline'), path.join(dir, 'migrations', '0_baseline'), { recursive: true });
  } else {
    fs.copyFileSync(path.join(PRISMA_DIR, 'schema.prisma'), path.join(dir, 'schema.prisma'));
    for (const entry of fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) fs.cpSync(path.join(MIGRATIONS_DIR, entry.name), path.join(dir, 'migrations', entry.name), { recursive: true });
    }
  }
  return path.join(dir, 'scripts', 'migrate.sh');
}

/** The schema file next to a release's migrate.sh. */
export function releaseSchema(migrateSh: string): string {
  return path.join(path.dirname(path.dirname(migrateSh)), 'schema.prisma');
}

/** A folder with an `npx` that runs the installed Prisma CLI (`npx prisma …` in migrate.sh). */
function npxShimDir(): string {
  const dir = path.join(scratchRoot(), 'bin');
  const shim = path.join(dir, 'npx');
  if (!fs.existsSync(shim)) {
    fs.mkdirSync(dir, { recursive: true });
    const node = process.execPath.split(path.sep).join('/');
    const cli = PRISMA_CLI.split(path.sep).join('/');
    fs.writeFileSync(
      shim,
      `#!/bin/sh\nif [ "$1" = prisma ]; then shift; exec "${node}" "${cli}" "$@"; fi\necho "npx shim: unexpected npx $*" >&2\nexit 99\n`,
      { encoding: 'utf8', mode: 0o755 },
    );
  }
  return dir;
}

/** Runs `sh <release>/prisma/scripts/migrate.sh` against `url`, as deploy.sh and Railway do. */
export function runMigrateSh(migrateSh: string, url: string): CommandResult {
  return result(
    spawnSync('sh', [migrateSh.split(path.sep).join('/')], {
      cwd: path.dirname(migrateSh),
      env: {
        ...process.env,
        DATABASE_URL: url,
        PATH: `${npxShimDir()}${path.delimiter}${process.env.PATH ?? ''}`,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300_000,
    }),
  );
}

/** The backfill section (3) of the inc1a migration, for re-running it (MIG-007, invariant 15). */
export function inc1aBackfillSql(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, INC1A_MIGRATION, 'migration.sql'), 'utf8');
  const start = sql.indexOf('-- (3) BACKFILLS');
  const end = sql.indexOf('-- (4) CHECK CONSTRAINTS');
  if (start < 0 || end < start) throw new Error('inc1a has no backfill section');
  return sql.slice(start, end);
}

/** md5 of every row of `table` (ordered by its text), and the row count. */
export async function tableDigest(db: PrismaClient, table: string): Promise<{ rows: number; md5: string }> {
  const rows = await db.$queryRawUnsafe<Array<{ rows: bigint; md5: string | null }>>(
    `SELECT count(*)::bigint AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS md5 FROM "${table}" t`,
  );
  return { rows: Number(rows[0].rows), md5: rows[0].md5 ?? '' };
}
