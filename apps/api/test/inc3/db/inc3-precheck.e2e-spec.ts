/**
 * The inc3 pre-check (DATA_MODEL §5.4; the automated half of the manual ops case REF-029): a refill that
 * isn't PENDING and isn't finished (COMPLETED, CANCELLED, the legacy FAILED) was started under the Inc 1
 * count steps, which Inc 3 no longer offers, so the migration refuses to run. It names the refills (at most
 * 20, then "and N more") with the fix and the resolve command, and applies nothing. Once the refills are
 * finished or cancelled and the failed migration is marked rolled back, the same release deploys.
 */
import * as path from 'path';
import { describeDb } from '../../helpers/describe-db';
import {
  appliedMigrations,
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSqlFile,
  INC2_MIGRATION,
  INC3_MIGRATION,
  makeRelease,
  prisma,
  removeScratchRoot,
  runMigrateSh,
  type ScratchDb,
} from '../../helpers/migrations';

const ID = (suffix: string) => `20000000-0000-4000-8000-${suffix}`;
const AG = ID('00000000da00');
const STATION = ID('0000000005f1');
const SIZE = ID('0000000000a9');
const STORE = ID('0000000005a1');
const IMRAN = ID('00000000e002');
const LEB_202 = ID('0000000000f2');

/** In-flight refills of the count steps: one per open status after PENDING. */
const IN_FLIGHT: Array<[string, string]> = [
  [ID('0000000fe001'), 'ASSIGNED'],
  [ID('0000000fe002'), 'EMPTIES_PICKED'],
  [ID('0000000fe003'), 'AT_STATION'],
  [ID('0000000fe004'), 'FILLED'],
  [ID('0000000fe005'), 'RETURNED'],
];

function inFlightRow(id: string, status: string, minute: number): string {
  return `('${id}', '${AG}', '${STATION}', '${SIZE}', 'OUR_SERVICE', 2, 0, 0, '${status}', '${IMRAN}', '${LEB_202}', '${STORE}',
           '2026-10-07T09:${String(minute).padStart(2, '0')}:00Z', '2026-10-07T09:${String(minute).padStart(2, '0')}:00Z')`;
}

async function insertRefills(db: ScratchDb, rows: Array<[string, string]>, firstMinute = 0): Promise<void> {
  await db.client().$executeRawUnsafe(
    `INSERT INTO filling_orders (id, distributor_id, filling_station_id, cylinder_type_id, service_type, requested_count,
                                 price_per_cylinder_paisa, total_cost_paisa, status, assigned_driver_id, assigned_vehicle_id,
                                 pickup_store_id, created_at, updated_at)
     VALUES ${rows.map(([id, status], i) => inFlightRow(id, status, firstMinute + i)).join(',\n')}`,
  );
}

async function inc3Objects(db: ScratchDb): Promise<{ tables: number; refillNo: number; failed: number }> {
  const client = db.client();
  const [tables] = await client.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('filling_order_cylinders', 'day_closes', 'day_close_lines')`;
  const [refillNo] = await client.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'filling_orders' AND column_name = 'refill_no'`;
  const [failed] = await client.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = ${INC3_MIGRATION} AND finished_at IS NULL AND rolled_back_at IS NULL`;
  return { tables: tables.n, refillNo: refillNo.n, failed: failed.n };
}

describeDb('inc3 pre-check: no refill in flight under the count steps', () => {
  let db: ScratchDb;
  let busy: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb('pre3');
    busy = await createScratchDb('pre3busy');
    for (const target of [db, busy]) {
      const deployed = deployRelease(target, 'inc2');
      if (deployed.code !== 0) throw new Error(`inc2 deploy failed:\n${deployed.output}`);
      const load = executeSqlFile(target.url, path.join(__dirname, 'fixtures', 'inc2-today.sql'));
      if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    }
  }, 600_000);

  afterAll(async () => {
    await db?.drop();
    await busy?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('REF-029 (automated) refuses with MIGRATION_BLOCKED inc3 naming each refill in flight, its fix and the resolve command; nothing applied', async () => {
    await insertRefills(db, IN_FLIGHT);
    const run = runMigrateSh(makeRelease('inc3'), db.url);
    expect(run.code).not.toBe(0);
    const message = /MIGRATION_BLOCKED inc3: [^\n]*/.exec(run.output)?.[0] ?? run.output;
    expect(message).toContain('MIGRATION_BLOCKED inc3: refills in progress (');
    for (const [id, status] of IN_FLIGHT) expect(message).toContain(`AG ${id} (${status})`);
    // PENDING, COMPLETED, CANCELLED and the legacy FAILED refills don't block.
    for (const ok of ['0000000fd001', '0000000fd002', '0000000fd003', '0000000fd004', '0000000fd101']) expect(message).not.toContain(ID(ok));
    expect(message).toContain("Finish each refill with the Increment 2 apps first (the driver's steps up to Returned, then the office's Mark complete");
    expect(message).toContain(`run "prisma migrate resolve --rolled-back ${INC3_MIGRATION}", then deploy again.`);
    // One transaction: no inc3 table or column exists, and the migration is recorded as failed.
    expect(await inc3Objects(db)).toEqual({ tables: 0, refillNo: 0, failed: 1 });
    expect((await appliedMigrations(db.client())).pop()).toBe(INC2_MIGRATION);
  }, 600_000);

  it('once the refills are finished or cancelled and the failed run is resolved, the same release deploys', async () => {
    const client = db.client();
    // The ops fix: the office marks the returned one complete, the others are finished the old way or cancelled.
    await client.$executeRawUnsafe(
      `UPDATE filling_orders SET status = 'COMPLETED', completed_at = updated_at WHERE id IN ('${IN_FLIGHT.slice(1).map(([id]) => id).join("','")}')`,
    );
    await client.$executeRawUnsafe(`UPDATE filling_orders SET status = 'CANCELLED', cancellation_reason = 'Old steps' WHERE id = '${IN_FLIGHT[0][0]}'`);
    const resolved = prisma(['migrate', 'resolve', '--rolled-back', INC3_MIGRATION, '--schema', 'prisma/schema.prisma'], db.url);
    expect({ code: resolved.code, output: resolved.code === 0 ? '' : resolved.output }).toEqual({ code: 0, output: '' });
    const run = runMigrateSh(makeRelease('inc3'), db.url);
    expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    expect((await appliedMigrations(client)).pop()).toBe(INC3_MIGRATION);
    const [{ tables, refillNo }] = [await inc3Objects(db)];
    expect({ tables, refillNo }).toEqual({ tables: 3, refillNo: 1 });
    // The five refills made in flight are numbered after the fixture's five (by created_at, Oct 7), and the
    // cancelled one is stamped from its updated_at.
    const rows = await client.$queryRaw<Array<{ id: string; refill_no: number; cancelled_at: Date | null }>>`
      SELECT id, refill_no, cancelled_at FROM filling_orders WHERE id::text LIKE '20000000-0000-4000-8000-0000000fe%' ORDER BY refill_no`;
    expect(rows.map((r) => r.refill_no)).toEqual([6, 7, 8, 9, 10]);
    expect(rows[0]).toEqual({ id: IN_FLIGHT[0][0], refill_no: 6, cancelled_at: new Date('2026-10-07T09:00:00.000Z') });
  }, 600_000);

  it('names at most 20 refills, then "and N more"', async () => {
    const many: Array<[string, string]> = Array.from({ length: 23 }, (_, i) => [ID(`0000000ff${String(i).padStart(3, '0')}`), 'ASSIGNED']);
    await insertRefills(busy, many);
    const run = runMigrateSh(makeRelease('inc3'), busy.url);
    expect(run.code).not.toBe(0);
    const message = /MIGRATION_BLOCKED inc3: [^\n]*/.exec(run.output)?.[0] ?? run.output;
    const named = many.filter(([id]) => message.includes(id));
    expect(named.map(([id]) => id)).toEqual(many.slice(0, 20).map(([id]) => id));
    expect(message).toContain(' and 3 more). Finish each refill');
    expect(await inc3Objects(busy)).toEqual({ tables: 0, refillNo: 0, failed: 1 });
  }, 600_000);
});
