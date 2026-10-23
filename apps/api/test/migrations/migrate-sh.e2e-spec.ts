/**
 * MIG-009: migrate.sh takes an old database over once, at the baseline release only, and refuses one
 * that was never baselined (DATA_MODEL §0, §2.2, §2.3).
 *
 * (A) a `db push`-ed af889bf database, the baseline release; (B) the same kind of database, the inc1a
 * release; (C) a database already baselined (A afterwards), the inc1a release; (D) a copy of A with
 * one extra column added by hand, the baseline release.
 */
import { describeDb } from '../helpers/describe-db';
import {
  createScratchDb,
  disconnectAdmin,
  INC1A_MIGRATION,
  makeRelease,
  pushAf889bfSchema,
  removeScratchRoot,
  runMigrateSh,
  type ScratchDb,
} from '../helpers/migrations';

const BASELINE_MESSAGE = 'Baseline release: last db push (refuses data loss), drift check, mark 0_baseline applied';

async function history(db: ScratchDb): Promise<string[]> {
  const exists = await db.client().$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations'`;
  if (exists[0].n === 0) return [];
  const rows = await db.client().$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  return rows.map((row) => row.migration_name);
}

describeDb('migrations: migrate.sh', () => {
  const dbs: ScratchDb[] = [];

  afterAll(async () => {
    for (const db of dbs) await db.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  async function oldDatabase(label: string): Promise<ScratchDb> {
    const db = await createScratchDb(label);
    dbs.push(db);
    pushAf889bfSchema(db);
    return db;
  }

  it('MIG-009 migrate.sh brings an old database to the baseline once, and refuses one that was never baselined', async () => {
    const baseline = makeRelease('baseline');
    const inc1a = makeRelease('inc1a');

    // A: the baseline release takes the old database over.
    const a = await oldDatabase('a');
    const runA = runMigrateSh(baseline, a.url);
    expect({ code: runA.code, output: runA.code === 0 ? '' : runA.output }).toEqual({ code: 0, output: '' });
    expect(runA.output).toContain(BASELINE_MESSAGE);
    expect(runA.output).not.toMatch(/accept-data-loss|will be lost|data loss warning/i);
    expect(await history(a)).toEqual(['0_baseline']);
    expect(runA.output).toMatch(/No pending migrations to apply|All migrations have been successfully applied|already in sync|up to date/i);

    // B: the inc1a release refuses a database that was never baselined, and changes nothing.
    const b = await oldDatabase('b');
    const runB = runMigrateSh(inc1a, b.url);
    expect(runB.code).toBe(1);
    expect(runB.output).toContain('DB_NOT_BASELINED: deploy the baseline release first');
    expect(await history(b)).toEqual([]);
    const columns = await b.client().$queryRaw`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'distributors' AND column_name = 'code'`;
    expect(columns).toEqual([]);

    // C: A is now baselined: the check passes and only migrate deploy runs.
    const runC = runMigrateSh(inc1a, a.url);
    expect({ code: runC.code, output: runC.code === 0 ? '' : runC.output }).toEqual({ code: 0, output: '' });
    expect(runC.output).not.toContain(BASELINE_MESSAGE);
    expect(await history(a)).toEqual(['0_baseline', INC1A_MIGRATION]);

    // D: an extra column by hand (with data in it): db push refuses to drop it, and 0_baseline is not marked applied.
    const d = await oldDatabase('d');
    await d.client().$executeRawUnsafe(`ALTER TABLE users ADD COLUMN extra_note text`);
    await d.client().$executeRawUnsafe(
      `INSERT INTO users (id, phone, name, role, status, extra_note, created_at, updated_at)
       VALUES (gen_random_uuid(), '+923000000077', 'Hand-made', 'SUPER_ADMIN', 'ACTIVE', 'keep me', now(), now())`,
    );
    const runD = runMigrateSh(baseline, d.url);
    expect(runD.code).not.toBe(0);
    expect(await history(d)).toEqual([]);
    const kept = await d.client().$queryRaw`SELECT extra_note FROM users WHERE phone = '+923000000077'`;
    expect(kept).toEqual([{ extra_note: 'keep me' }]);
  }, 900_000);
});
