/**
 * The database sub-lane's legacy proof, automated: its full legacy fixture (every inc1a backfill
 * path: trip stops, nested, border and inactive zones, refill debits, gateway ids, phone forms) goes
 * through migrate.sh at both releases; the shared home store blocks inc1a until it is fixed; then every
 * check of fixtures/legacy-full-invariants.sql passes and a second run of the backfills changes no
 * table (DATA_MODEL §3.4, §3.8 invariants 1–16). It re-proves inc1a after the in-place change of
 * 2026-10-22 (G15-01, G17-03), together with MIG-002 to MIG-008.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describeDb } from '../helpers/describe-db';
import {
  createScratchDb,
  disconnectAdmin,
  executeSql,
  executeSqlFile,
  FIXTURES_DIR,
  inc1aBackfillSql,
  INC1A_MIGRATION,
  makeRelease,
  prisma,
  pushAf889bfSchema,
  releaseSchema,
  removeScratchRoot,
  runMigrateSh,
  tableDigest,
  type ScratchDb,
} from '../helpers/migrations';

describeDb('migrations: inc1a on the database sub-lane legacy fixture', () => {
  let legacy: ScratchDb;

  beforeAll(async () => {
    legacy = await createScratchDb('full');
    pushAf889bfSchema(legacy);
    const load = executeSqlFile(legacy.url, path.join(FIXTURES_DIR, 'legacy-full.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
  }, 300_000);

  afterAll(async () => {
    await legacy?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('applies inc1a after the shared-store fix, with every legacy check passing and re-runnable backfills', async () => {
    const baseline = runMigrateSh(makeRelease('baseline'), legacy.url);
    expect({ code: baseline.code, output: baseline.code === 0 ? '' : baseline.output }).toEqual({ code: 0, output: '' });

    const inc1a = makeRelease('inc1a');
    const blocked = runMigrateSh(inc1a, legacy.url);
    expect(blocked.code).not.toBe(0);
    expect(blocked.output).toContain('MIGRATION_BLOCKED inc1a: a store is the home store of more than one distributor (00000000-0000-0000-0000-0000000000c3 x2)');

    // The fix: Eagle Gas (DE) leaves the shared depot; it gets its store from the office later.
    const db = legacy.client();
    await db.$executeRawUnsafe(`UPDATE distributors SET home_store_id = NULL WHERE id = '00000000-0000-0000-0000-00000000d005'`);
    const resolve = prisma(['migrate', 'resolve', '--rolled-back', INC1A_MIGRATION, '--schema', releaseSchema(inc1a)], legacy.url);
    expect(resolve.code).toBe(0);
    const applied = runMigrateSh(inc1a, legacy.url);
    expect({ code: applied.code, output: applied.code === 0 ? '' : applied.output }).toEqual({ code: 0, output: '' });

    const checks = await db.$queryRawUnsafe<Array<{ name: string; ok: boolean }>>(
      fs.readFileSync(path.join(FIXTURES_DIR, 'legacy-full-invariants.sql'), 'utf8'),
    );
    expect(checks.length).toBeGreaterThan(20);
    expect(checks.filter((check) => !check.ok).map((check) => check.name)).toEqual([]);

    // Invariant 15: a second run of the backfills changes no table.
    const tables = (
      await db.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys') ORDER BY 1`
    ).map((row) => row.tablename);
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of tables) out[table] = await tableDigest(db, table);
      return out;
    };
    const first = await digest();
    const rerun = executeSql(legacy.url, inc1aBackfillSql());
    expect({ code: rerun.code, output: rerun.code === 0 ? '' : rerun.output }).toEqual({ code: 0, output: '' });
    expect(await digest()).toEqual(first);
  }, 900_000);
});
