/**
 * The whole upgrade path on the database sub-lane's legacy fixture (test/migrations/fixtures/legacy-full.sql):
 * the old `db push` database goes through migrate.sh at the baseline, inc1a and inc2 releases, as
 * production will. Every blocker shows in its turn, with its rows and its fix, and nothing is applied
 * until it is fixed (DATA_MODEL §2.6, §3.8 invariants 16 and 20, §4.4):
 *
 *   inc1a  a shared home store (DD and DE)                → DE leaves it
 *   inc1b  distributors without a store (D03, D05, D06)   → each gets its store
 *   inc1b  a negative balance (D06, an old refill debit)  → a super-admin correction
 *   inc1b  two spellings of one phone (D01's Fatima)      → the customers are merged
 *   inc2   a run in progress (ISB-102)                    → the run is finished
 *
 * Afterwards the database is exactly schema.prisma, every wallet adds up, and the API runs on it.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import {
  appliedMigrations,
  createScratchDb,
  disconnectAdmin,
  executeSqlFile,
  FIXTURES_DIR,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  makeRelease,
  prisma,
  pushAf889bfSchema,
  releaseSchema,
  removeScratchRoot,
  runMigrateSh,
  type CommandResult,
  type ScratchDb,
} from '../../helpers/migrations';

const LID = (suffix: string) => `00000000-0000-0000-0000-${suffix}`;
const D = { D01: LID('00000000d001'), D03: LID('00000000d003'), D05: LID('00000000d005'), D06: LID('00000000d006') };
const OFFICE = LID('0000000000a1');

describeDb('migrations: the legacy database through baseline, inc1a and the inc2 release', () => {
  let legacy: ScratchDb;
  let inc2Release: string;

  const ok = (run: CommandResult) => expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
  const rolledBack = (migration: string) => {
    const resolve = prisma(['migrate', 'resolve', '--rolled-back', migration, '--schema', releaseSchema(inc2Release)], legacy.url);
    ok(resolve);
  };

  beforeAll(async () => {
    legacy = await createScratchDb('chain');
    pushAf889bfSchema(legacy);
    const load = executeSqlFile(legacy.url, path.join(FIXTURES_DIR, 'legacy-full.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    ok(runMigrateSh(makeRelease('baseline'), legacy.url));
    const inc1a = makeRelease('inc1a');
    expect(runMigrateSh(inc1a, legacy.url).output).toContain('MIGRATION_BLOCKED inc1a');
    await legacy.client().$executeRawUnsafe(`UPDATE distributors SET home_store_id = NULL WHERE id = '${D.D05}'`);
    ok(prisma(['migrate', 'resolve', '--rolled-back', INC1A_MIGRATION, '--schema', releaseSchema(inc1a)], legacy.url));
    ok(runMigrateSh(inc1a, legacy.url));
    inc2Release = makeRelease('inc2');
  }, 900_000);

  afterAll(async () => {
    await legacy?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('every inc1b and inc2 blocker stops the release in turn, naming its rows and fix, until it is fixed', async () => {
    const db = legacy.client();
    const expectOnlyInc1a = async () => expect(await appliedMigrations(db)).toEqual(['0_baseline', INC1A_MIGRATION]);

    // inc1b 1.1: three distributors without a store.
    const noStore = runMigrateSh(inc2Release, legacy.url);
    expect(noStore.code).not.toBe(0);
    expect(noStore.output).toContain(`MIGRATION_BLOCKED inc1b: distributors without a store (D03 ${D.D03}, D05 ${D.D05}, D06 ${D.D06}).`);
    await expectOnlyInc1a();
    for (const [i, id] of [D.D03, D.D05, D.D06].entries()) {
      const store = LID(`0000000005f${i}`);
      await db.$executeRawUnsafe(`
        INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
        VALUES ('${store}', 'Own store ${i}', '${LID('0000000000b1')}', 'Own road', ST_SetSRID(ST_MakePoint(${73.04 + i * 0.001}, 33.72), 4326), true, now(), now())`);
      await db.$executeRawUnsafe(`UPDATE distributors SET home_store_id = '${store}' WHERE id = '${id}'`);
    }
    rolledBack(INC1B_MIGRATION);

    // inc1b 1.2: D06's balance is below zero (an old refill debit); the office corrects it.
    const negative = runMigrateSh(inc2Release, legacy.url);
    expect(negative.code).not.toBe(0);
    expect(negative.output).toContain('MIGRATION_BLOCKED inc1b: distributors with a negative balance (D06 -50000 paisa). Fix with a super-admin correction');
    await expectOnlyInc1a();
    await db.$executeRawUnsafe(`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + 50000 WHERE id = '${D.D06}'`);
    await db.$executeRawUnsafe(`
      INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, reason_code, note, created_by_user_id, created_at)
      VALUES (gen_random_uuid(), '${D.D06}', 'ADJUSTMENT', 50000, 0, 'adjust:${LID('0000000ad0f6')}', 'SYSTEM_ERROR', 'Refills carry no money (ADR-16)', '${OFFICE}', now())`);
    rolledBack(INC1B_MIGRATION);

    // inc1b 1.3: Fatima was added twice, as "0300 1234567" and "03001234567" (inc1a normalised both).
    const duplicates = runMigrateSh(inc2Release, legacy.url);
    expect(duplicates.code).not.toBe(0);
    expect(duplicates.output).toContain(
      `MIGRATION_BLOCKED inc1b: customers of one distributor sharing a phone number (D01 +923001234567 (customers ${LID('0000000c0001')} ${LID('0000000c0008')})). Merge or correct them`,
    );
    await expectOnlyInc1a();
    await db.$executeRawUnsafe(`UPDATE orders SET client_id = '${LID('0000000c0001')}' WHERE client_id = '${LID('0000000c0008')}'`);
    await db.$executeRawUnsafe(`UPDATE client_addresses SET client_id = '${LID('0000000c0001')}' WHERE client_id = '${LID('0000000c0008')}'`);
    await db.$executeRawUnsafe(`DELETE FROM clients WHERE id = '${LID('0000000c0008')}'`);
    rolledBack(INC1B_MIGRATION);

    // inc1b applies; inc2 stops on the run in progress (ISB-102), and nothing of inc2 is applied.
    const inProgress = runMigrateSh(inc2Release, legacy.url);
    expect(inProgress.code).not.toBe(0);
    expect(inProgress.output).toContain(`MIGRATION_BLOCKED inc2: runs in progress (${LID('00000000a102')} (ISB-102)).`);
    expect(inProgress.output).toContain(`run "prisma migrate resolve --rolled-back ${INC2_MIGRATION}", then deploy again.`);
    expect(await appliedMigrations(db)).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION]);
    expect(await db.$queryRaw`SELECT tablename FROM pg_tables WHERE tablename = 'stop_cylinders'`).toEqual([]);
    expect(await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'cylinders' AND column_name = 'short_no'`).toEqual([]);
    // The fix with the Increment 1 apps: its order is cancelled, the driver finishes the trip.
    await db.$executeRawUnsafe(`
      UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancel_reason_code = 'OTHER', cancellation_reason = 'Run closed before the update'
      WHERE trip_id = '${LID('00000000a102')}' AND status NOT IN ('DELIVERED', 'CANCELLED', 'FAILED')`);
    await db.$executeRawUnsafe(`UPDATE trip_stops SET status = 'CANCELLED', cancelled_at = now() WHERE trip_id = '${LID('00000000a102')}' AND status IN ('PENDING', 'ARRIVED')`);
    await db.$executeRawUnsafe(`UPDATE trips SET status = 'COMPLETED', completed_at = now() WHERE id = '${LID('00000000a102')}'`);
    rolledBack(INC2_MIGRATION);

    const applied = runMigrateSh(inc2Release, legacy.url);
    ok(applied);
    expect(await appliedMigrations(db)).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION]);
  }, 900_000);

  it('the upgraded legacy database is exactly schema.prisma, its wallets add up, and the old refused top-ups are REJECTED', async () => {
    const db = legacy.client();
    const live = prisma(['migrate', 'diff', '--from-url', legacy.url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], legacy.url);
    ok(live);
    const mismatches = await db.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
    const statuses = await db.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text FROM payments WHERE id IN (${LID('0000000fa005')}::uuid, ${LID('0000000fa006')}::uuid) ORDER BY id`;
    expect(statuses.map((p) => p.status)).toEqual(['REJECTED', 'REJECTED']);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM distributors WHERE code IS NULL OR home_store_id IS NULL`).toEqual([{ n: 0 }]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM expenses WHERE type_id IS NULL`).toEqual([{ n: 0 }]);
  });

  it('the API runs on the upgraded legacy database', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = legacy.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      expect((await http(app).get('/api/v1/health').expect(200)).body.status).toBe('ok');
      expect((await http(app).get('/api/v1/app/config').expect(200)).body.features.scanFlow).toBe(true);
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  });
});
