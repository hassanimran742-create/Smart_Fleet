/**
 * MIG-021: flat_delivery_cost (DATA_MODEL §5.7; ADR-08, 2026-10-26) on today's data. A database at the
 * users_app_seen release, loaded with Increment 2-shaped rows (inc3/db/fixtures/inc2-today.sql, then migrate.sh
 * with inc3 and with the follow-ups' release), with a per-size price row and order lines carrying size amounts
 * added the way the Inc 1–3 code wrote them, goes on through migrate.sh with the current release. Proves that it
 * applies with no drift from schema.prisma, that the per-size rows and their table are gone, that the order
 * lines lost only their two size amounts, that every other table is as it was (placed orders keep their cost),
 * and that no money moved. The file's own shape is checked in flat-delivery-cost-contracts.spec.ts.
 */
import * as path from 'path';
import { describeDb } from '../helpers/describe-db';
import {
  APP_SEEN_MIGRATION,
  appliedMigrations,
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSql,
  executeSqlFile,
  FLAT_COST_MIGRATION,
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

/** The fixture's 11.8 kg size, Ahmed Gas's price in North and its delivered order line (inc2-today.sql). */
const KG11_8 = '20000000-0000-4000-8000-0000000000a9';
const AG_NORTH_PRICE = '20000000-0000-4000-8000-0000000002a1';
const X_LINE = '20000000-0000-4000-8000-0000000001b1';

describeDb('MIG-021 flat_delivery_cost on a users_app_seen database', () => {
  let today: ScratchDb;
  let run: CommandResult;
  let before: { tables: string[]; digests: Record<string, { rows: number; md5: string }>; lines: unknown[]; orders: unknown[] };

  /** Every order line without the two size amounts, as JSON, by id. */
  const lineRows = (db: ReturnType<ScratchDb['client']>) =>
    db.$queryRawUnsafe<Array<{ row: unknown }>>(
      `SELECT jsonb_build_object('id', id, 'order_id', order_id, 'cylinder_type_id', cylinder_type_id,
                                 'full_count', full_count, 'expected_return_count', expected_return_count) AS row
       FROM order_lines ORDER BY id`,
    );
  /** Each order's own copy of its cost. */
  const orderCosts = (db: ReturnType<ScratchDb['client']>) =>
    db.$queryRawUnsafe<Array<{ row: unknown }>>(
      `SELECT jsonb_build_object('id', id, 'fee', delivery_fee_paisa, 'status', fee_status, 'base', fee_base_paisa) AS row FROM orders ORDER BY id`,
    );

  beforeAll(async () => {
    today = await createScratchDb('flatcost');
    const deployed = deployRelease(today, 'inc2');
    if (deployed.code !== 0) throw new Error(`inc2 deploy failed:\n${deployed.output}`);
    const load = executeSqlFile(today.url, path.join(__dirname, '..', 'inc3', 'db', 'fixtures', 'inc2-today.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    for (const kind of ['inc3', 'appseen'] as const) {
      const step = runMigrateSh(makeRelease(kind), today.url);
      if (step.code !== 0) throw new Error(`${kind} release failed:\n${step.output}`);
    }
    // What the Inc 1–3 code wrote: Rs 40 per 11.8 kg cylinder on the North price, and the order line's copy.
    const sizes = executeSql(
      today.url,
      `INSERT INTO distributor_zone_price_sizes (id, price_id, cylinder_type_id, per_cylinder_paisa)
       VALUES (gen_random_uuid(), '${AG_NORTH_PRICE}', '${KG11_8}', 4000);
       UPDATE order_lines SET fee_per_cylinder_paisa = 4000, fee_paisa = 4000 WHERE id = '${X_LINE}';`,
    );
    if (sizes.code !== 0) throw new Error(`size rows failed:\n${sizes.output}`);
    const db = today.client();
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM distributor_zone_price_sizes`).toEqual([{ n: 1 }]);
    const tables = (
      await db.$queryRaw<Array<{ name: string }>>`
        SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name NOT IN ('_prisma_migrations', 'order_lines', 'distributor_zone_price_sizes', 'spatial_ref_sys')
        ORDER BY 1`
    ).map((t) => t.name);
    const digests: Record<string, { rows: number; md5: string }> = {};
    for (const table of tables) digests[table] = await tableDigest(db, table);
    before = { tables, digests, lines: (await lineRows(db)).map((r) => r.row), orders: (await orderCosts(db)).map((r) => r.row) };
    run = runMigrateSh(makeRelease('current'), today.url);
  }, 600_000);

  afterAll(async () => {
    await today?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('MIG-021 migrate.sh applies flat_delivery_cost after users_app_seen, with no drift from schema.prisma', async () => {
    expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    expect(run.output).toContain(FLAT_COST_MIGRATION);
    expect(await appliedMigrations(today.client())).toEqual([
      '0_baseline',
      INC1A_MIGRATION,
      INC1B_MIGRATION,
      INC2_MIGRATION,
      INC3_MIGRATION,
      APP_SEEN_MIGRATION,
      FLAT_COST_MIGRATION,
    ]);
    const live = prisma(['migrate', 'diff', '--from-url', today.url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], today.url);
    expect({ code: live.code, output: live.code === 0 ? '' : live.output }).toEqual({ code: 0, output: '' });
  });

  it('MIG-021 the per-size rows and their table are gone, and the order lines lost only their two size amounts', async () => {
    const db = today.client();
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'distributor_zone_price_sizes'`).toEqual([{ n: 0 }]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'dzps_amount_chk'`).toEqual([{ n: 0 }]);
    const columns = await db.$queryRaw<Array<{ c: string }>>`
      SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_lines' ORDER BY 1`;
    expect(columns.map((row) => row.c)).toEqual(['cylinder_type_id', 'expected_return_count', 'full_count', 'id', 'order_id']);
    expect((await lineRows(db)).map((r) => r.row)).toEqual(before.lines);
    expect(before.lines.length).toBeGreaterThan(0);
  });

  it('MIG-021 nothing else changed: every other table, each placed order\'s cost, and no money moved', async () => {
    const db = today.client();
    expect(before.tables.length).toBeGreaterThan(40);
    for (const table of before.tables) expect({ table, digest: await tableDigest(db, table) }).toEqual({ table, digest: before.digests[table] });
    expect((await orderCosts(db)).map((r) => r.row)).toEqual(before.orders);
    // Ahmed Gas's North price is still there, one cost per order.
    expect(await db.$queryRaw`SELECT base_paisa::text AS base FROM distributor_zone_prices WHERE id = ${AG_NORTH_PRICE}::uuid`).toEqual([{ base: '40000' }]);
    const mismatches = await db.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
  });
});
