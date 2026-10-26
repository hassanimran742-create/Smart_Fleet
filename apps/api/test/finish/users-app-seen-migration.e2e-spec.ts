/**
 * MIG-020: users_app_seen (DATA_MODEL §5.6) on today's data. A database at the Increment 3 release, loaded with
 * Increment 2-shaped rows (inc3/db/fixtures/inc2-today.sql, then migrate.sh with inc3), goes on through
 * migrate.sh with the follow-ups' release (`appseen`): three nullable `users` columns and two CHECKs, no
 * pre-check, no backfill. Proves that it applies with no drift from the schema it shipped with
 * (fixtures/schema.appseen.prisma; flat_delivery_cost comes after it), that every row of every table is as it
 * was (users' old columns included, the new ones NULL), that no money moved, and that the CHECKs hold the
 * columns to what AppSeenService writes. The file's own shape is checked in users-app-seen-contracts.spec.ts.
 */
import * as path from 'path';
import { describeDb } from '../helpers/describe-db';
import {
  APP_SEEN_MIGRATION,
  APP_SEEN_SCHEMA,
  appliedMigrations,
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSqlFile,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  INC3_MIGRATION,
  makeRelease,
  prisma,
  removeScratchRoot,
  runMigrateSh,
  tableDigest,
  type CommandResult,
  type ScratchDb,
} from '../helpers/migrations';

jest.setTimeout(600_000);

const NEW_COLUMNS = ['app_seen_at', 'app_variant', 'app_version'];

/** A raw SQL statement that must fail; returns its error text. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as Error).message ?? error);
  }
  throw new Error('expected the statement to be refused');
}

describeDb('MIG-020 users_app_seen on an Increment 3 database', () => {
  let today: ScratchDb;
  let run: CommandResult;
  let before: { tables: string[]; digests: Record<string, { rows: number; md5: string }>; users: unknown[] };

  /** Every users row without the three new columns, as JSON, by id. */
  const oldUserColumns = (db: ReturnType<ScratchDb['client']>) =>
    db.$queryRawUnsafe<Array<{ row: unknown }>>(
      `SELECT to_jsonb(u) - ${NEW_COLUMNS.map((c) => `'${c}'`).join(' - ')} AS row FROM users u ORDER BY id`,
    );

  beforeAll(async () => {
    today = await createScratchDb('appseen');
    const deployed = deployRelease(today, 'inc2');
    if (deployed.code !== 0) throw new Error(`inc2 deploy failed:\n${deployed.output}`);
    const load = executeSqlFile(today.url, path.join(__dirname, '..', 'inc3', 'db', 'fixtures', 'inc2-today.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    const inc3 = runMigrateSh(makeRelease('inc3'), today.url);
    if (inc3.code !== 0) throw new Error(`inc3 release failed:\n${inc3.output}`);
    const db = today.client();
    const tables = (
      await db.$queryRaw<Array<{ name: string }>>`
        SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('_prisma_migrations', 'users', 'spatial_ref_sys')
        ORDER BY 1`
    ).map((t) => t.name);
    const digests: Record<string, { rows: number; md5: string }> = {};
    for (const table of tables) digests[table] = await tableDigest(db, table);
    before = { tables, digests, users: (await oldUserColumns(db)).map((r) => r.row) };
    run = runMigrateSh(makeRelease('appseen'), today.url);
  }, 600_000);

  afterAll(async () => {
    await today?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('MIG-020 migrate.sh applies users_app_seen after inc3_refills_dayend, with no drift from the schema it shipped with', async () => {
    expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    expect(run.output).toContain(APP_SEEN_MIGRATION);
    expect(await appliedMigrations(today.client())).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION, INC3_MIGRATION, APP_SEEN_MIGRATION]);
    const live = prisma(['migrate', 'diff', '--from-url', today.url, '--to-schema-datamodel', APP_SEEN_SCHEMA, '--exit-code'], today.url);
    expect({ code: live.code, output: live.code === 0 ? '' : live.output }).toEqual({ code: 0, output: '' });
  });

  it('MIG-020 nothing else changed: every other table, every users row and no money moved; the new columns are NULL', async () => {
    const db = today.client();
    expect(before.tables.length).toBeGreaterThan(40);
    for (const table of before.tables) expect({ table, digest: await tableDigest(db, table) }).toEqual({ table, digest: before.digests[table] });
    expect((await oldUserColumns(db)).map((r) => r.row)).toEqual(before.users);
    expect(before.users.length).toBeGreaterThan(0);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM users WHERE app_variant IS NOT NULL OR app_version IS NOT NULL OR app_seen_at IS NOT NULL`).toEqual([{ n: 0 }]);
    const mismatches = await db.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
  });

  it('MIG-020 the three columns are nullable text and time, and both CHECKs exist, validated', async () => {
    const db = today.client();
    const columns = await db.$queryRaw<Array<{ c: string; nullable: string; type: string; dflt: string | null }>>`
      SELECT column_name AS c, is_nullable AS nullable, udt_name AS type, column_default AS dflt
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name LIKE 'app\\_%' ORDER BY 1`;
    expect(columns).toEqual([
      { c: 'app_seen_at', nullable: 'YES', type: 'timestamp', dflt: null },
      { c: 'app_variant', nullable: 'YES', type: 'text', dflt: null },
      { c: 'app_version', nullable: 'YES', type: 'text', dflt: null },
    ]);
    const checks = await db.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c' AND conname LIKE 'users_app_%' ORDER BY 1`;
    expect(checks).toEqual([
      { conname: 'users_app_seen_chk', convalidated: true },
      { conname: 'users_app_version_chk', convalidated: true },
    ]);
  });

  it('MIG-020 the CHECKs take only what AppSeenService writes: a phone app, an x.y.z version, the three together', async () => {
    const db = today.client();
    const [{ id }] = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM users ORDER BY id LIMIT 1`;
    const set = (variant: string | null, version: string | null, seen: boolean) =>
      db.$executeRawUnsafe(
        `UPDATE users SET app_variant = $1, app_version = $2, app_seen_at = ${seen ? "(now() AT TIME ZONE 'UTC')" : 'NULL'} WHERE id = $3::uuid`,
        variant,
        version,
        id,
      );
    expect(await refusal(() => set('admin-web', '0.1.1', true))).toContain('users_app_seen_chk');
    expect(await refusal(() => set('driver', null, true))).toContain('users_app_seen_chk');
    expect(await refusal(() => set('driver', '0.1.1', false))).toContain('users_app_seen_chk');
    expect(await refusal(() => set('driver', 'latest', true))).toContain('users_app_version_chk');
    expect(await refusal(() => set('distributor', '0.1', true))).toContain('users_app_version_chk');
    await expect(set('driver', '0.1.1', true)).resolves.toBe(1);
    await expect(set('distributor', '0.1.0', true)).resolves.toBe(1);
    await expect(set('driver', '1.2.3-beta.1', true)).resolves.toBe(1);
    await expect(set(null, null, false)).resolves.toBe(1);
  });
});
