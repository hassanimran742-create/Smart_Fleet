/**
 * MIG-008: inc1a's pre-check stops the migration on a shared home store and leaves the database
 * untouched; after the fix and `migrate resolve --rolled-back`, the next deploy applies it
 * (DATA_MODEL §2.4, §2.6, invariant 16).
 */
import * as path from 'path';
import { describeDb } from '../helpers/describe-db';
import {
  createScratchDb,
  disconnectAdmin,
  executeSqlFile,
  FIXTURES_DIR,
  INC1A_MIGRATION,
  makeRelease,
  prisma,
  pushAf889bfSchema,
  releaseSchema,
  removeScratchRoot,
  runMigrateSh,
  type ScratchDb,
} from '../helpers/migrations';

const SHARED_STORE = '00000000-0000-4000-8000-0000000005b1';
const SPARE_STORE = '00000000-0000-4000-8000-0000000005b2';
const SECOND = '00000000-0000-4000-8000-00000000e002';

describeDb('migrations: the inc1a pre-check', () => {
  let legacy: ScratchDb;

  beforeAll(async () => {
    legacy = await createScratchDb('precheck');
    pushAf889bfSchema(legacy);
    const load = executeSqlFile(legacy.url, path.join(FIXTURES_DIR, 'legacy-shared-store.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
  }, 300_000);

  afterAll(async () => {
    await legacy?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('MIG-008 the pre-check stops the migration on bad data and leaves the database untouched', async () => {
    const baseline = runMigrateSh(makeRelease('baseline'), legacy.url);
    expect({ code: baseline.code, output: baseline.code === 0 ? '' : baseline.output }).toEqual({ code: 0, output: '' });

    // Step 1.
    const inc1a = makeRelease('inc1a');
    const blocked = runMigrateSh(inc1a, legacy.url);
    expect(blocked.code).not.toBe(0);
    expect(blocked.output).toContain('MIGRATION_BLOCKED inc1a:');
    expect(blocked.output).toContain(`${SHARED_STORE} x2`);
    expect(blocked.output).toContain('Give each distributor its own store');
    expect(blocked.output).toContain(`prisma migrate resolve --rolled-back ${INC1A_MIGRATION}`);

    // Step 2: marked failed, and nothing of it applied (the file is one transaction).
    const db = legacy.client();
    const row = await db.$queryRaw<Array<{ finished: boolean; rolled_back: boolean }>>`
      SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations WHERE migration_name = ${INC1A_MIGRATION}`;
    expect(row).toEqual([{ finished: false, rolled_back: false }]);
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'distributors' AND column_name IN ('code', 'next_order_no')`;
    expect(columns).toEqual([]);
    const tables = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('app_settings', 'stored_files', 'expense_types')`;
    expect(tables).toEqual([{ n: 0 }]);

    // Step 3: fix the data, mark the attempt rolled back, deploy again.
    await db.$executeRaw`UPDATE distributors SET home_store_id = ${SPARE_STORE}::uuid WHERE id = ${SECOND}::uuid`;
    const resolve = prisma(['migrate', 'resolve', '--rolled-back', INC1A_MIGRATION, '--schema', releaseSchema(inc1a)], legacy.url);
    expect({ code: resolve.code, output: resolve.code === 0 ? '' : resolve.output }).toEqual({ code: 0, output: '' });
    const applied = runMigrateSh(inc1a, legacy.url);
    expect({ code: applied.code, output: applied.code === 0 ? '' : applied.output }).toEqual({ code: 0, output: '' });
    // The MIG-002 to MIG-005 checks on this data.
    const distributors = await db.$queryRaw<Array<{ code: string; next_order_no: number; next_topup_no: number }>>`
      SELECT code, next_order_no, next_topup_no FROM distributors ORDER BY created_at`;
    expect(distributors).toEqual([
      { code: 'D01', next_order_no: 1, next_topup_no: 1 },
      { code: 'D02', next_order_no: 1, next_topup_no: 1 },
    ]);
    expect(await db.$queryRaw`SELECT phone FROM clients`).toEqual([{ phone: '+923005556677' }]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM expense_types WHERE archived_at IS NULL`).toEqual([{ n: 6 }]);
    const finished = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = ${INC1A_MIGRATION} AND finished_at IS NOT NULL`;
    expect(finished).toEqual([{ n: 1 }]);
  }, 600_000);
});
