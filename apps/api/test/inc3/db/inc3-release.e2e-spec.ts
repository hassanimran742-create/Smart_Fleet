/**
 * The Increment 3 release on today's data: a database at the Increment 2 release, loaded with rows as the
 * Increment 2 code writes them (fixtures/inc2-today.sql: labelled cylinders, scans and stop rows, an
 * answered confirmation and its case, and refills of the Inc 1 count steps, none in flight), goes through
 * migrate.sh with inc3_refills_dayend (DATA_MODEL §5). Proves the backfills (refill numbers per
 * distributor by created_at and id, continuing from the counter; `cancelled_at`), the new tables, keys and
 * CHECKs, that nothing else changed and no money moved, that the backfills can run again without changing
 * anything, that the result has no drift from the schema the Increment 3 release shipped
 * (fixtures/schema.inc3.prisma; the follow-ups' users_app_seen comes after it), and that the API runs on it.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import {
  APP_SEEN_MIGRATION,
  appliedMigrations,
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSql,
  executeSqlFile,
  inc3BackfillSql,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  INC3_MIGRATION,
  INC3_SCHEMA,
  makeRelease,
  prisma,
  removeScratchRoot,
  runMigrateSh,
  tableDigest,
  type CommandResult,
  type ScratchDb,
} from '../../helpers/migrations';

const ID = (suffix: string) => `20000000-0000-4000-8000-${suffix}`;
const AG = ID('00000000da00');
const BG = ID('00000000db00');
const REFILL = {
  F1: ID('0000000fd001'),
  F2: ID('0000000fd002'),
  F3: ID('0000000fd003'),
  F4: ID('0000000fd004'),
  F5: ID('0000000fd005'),
  G1: ID('0000000fd101'),
  G2: ID('0000000fd102'),
};
const CYL_A1 = ID('00000000ca01');
const CYL_A4 = ID('00000000ca04');
const SIZE_11_8 = ID('0000000000a9');

/** The tables the inc3 migration adds no column to: every row must be byte for byte what it was. */
const UNTOUCHED = [
  'orders',
  'order_lines',
  'trips',
  'trip_stops',
  'payments',
  'ledger_entries',
  'clients',
  'client_addresses',
  'cylinders',
  'stop_cylinders',
  'delivery_confirmations',
  'outbound_messages',
  'alerts',
  'audit_logs',
  'expenses',
  'expense_types',
  'stored_files',
  'app_settings',
  'zones',
  'stores',
];

/** A raw SQL statement that must fail; returns its error text. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as Error).message ?? error);
  }
  throw new Error('expected the statement to be refused');
}

describeDb('inc3 release on today-shaped Increment 2 data', () => {
  let today: ScratchDb;
  let run: CommandResult;
  let before: {
    digests: Record<string, { rows: number; md5: string }>;
    events: { rows: number; md5: string };
    refills: Array<{ id: string; updated_at: Date }>;
  };

  const eventDigest = (db: ReturnType<ScratchDb['client']>) =>
    db.$queryRaw<Array<{ rows: number; md5: string }>>`
      SELECT count(*)::int AS rows,
             md5(coalesce(string_agg(concat_ws('|', id, cylinder_id, event_type, source, from_custody_type, from_custody_id, to_custody_type,
               to_custody_id, from_state, to_state, reason, actor_user_id, client_scan_id, trip_id, trip_stop_id, order_id, created_at), ',' ORDER BY id), '')) AS md5
      FROM cylinder_events`;

  beforeAll(async () => {
    today = await createScratchDb('today3');
    const deployed = deployRelease(today, 'inc2');
    if (deployed.code !== 0) throw new Error(`inc2 deploy failed:\n${deployed.output}`);
    const load = executeSqlFile(today.url, path.join(__dirname, 'fixtures', 'inc2-today.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    const db = today.client();
    const digests: Record<string, { rows: number; md5: string }> = {};
    for (const table of UNTOUCHED) digests[table] = await tableDigest(db, table);
    before = {
      digests,
      events: (await eventDigest(db))[0],
      refills: await db.$queryRaw`SELECT id, updated_at FROM filling_orders ORDER BY id`,
    };
    run = runMigrateSh(makeRelease('inc3'), today.url);
  }, 600_000);

  afterAll(async () => {
    await today?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('migrate.sh applies inc3_refills_dayend on the Increment 2 database, with no drift from the Inc 3 schema', async () => {
    expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    expect(run.output).toContain(INC3_MIGRATION);
    expect(await appliedMigrations(today.client())).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION, INC3_MIGRATION]);
    const live = prisma(['migrate', 'diff', '--from-url', today.url, '--to-schema-datamodel', INC3_SCHEMA, '--exit-code'], today.url);
    expect({ code: live.code, output: live.code === 0 ? '' : live.output }).toEqual({ code: 0, output: '' });
  });

  it('backfill 3.1: refill_no runs per distributor by (created_at, id), continuing from the counter, and next_refill_no follows', async () => {
    const db = today.client();
    const rows = await db.$queryRaw<Array<{ id: string; refill_no: number }>>`SELECT id, refill_no FROM filling_orders ORDER BY id`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.refill_no]))).toEqual({
      [REFILL.F1]: 1, // FAILED, Oct 2
      [REFILL.F2]: 2, // COMPLETED, Oct 3
      [REFILL.F3]: 3, // CANCELLED, Oct 4
      // F4 and F5 were created at the same moment: the id decides.
      [REFILL.F4]: 4,
      [REFILL.F5]: 5,
      // Bilal Gas's counter was already 3: its numbers continue from it.
      [REFILL.G1]: 3,
      [REFILL.G2]: 4,
    });
    const counters = await db.$queryRaw<Array<{ id: string; next_refill_no: number; next_order_no: number; next_cylinder_no: number }>>`
      SELECT id, next_refill_no, next_order_no, next_cylinder_no FROM distributors ORDER BY id`;
    expect(counters).toEqual([
      { id: AG, next_refill_no: 6, next_order_no: 2, next_cylinder_no: 5 },
      { id: BG, next_refill_no: 5, next_order_no: 1, next_cylinder_no: 2 },
    ]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM filling_orders WHERE refill_no IS NULL`).toEqual([{ n: 0 }]);
  });

  it('backfill 3.2: a cancelled refill gets cancelled_at = its updated_at; nothing else is stamped', async () => {
    const db = today.client();
    const rows = await db.$queryRaw<
      Array<{ id: string; status: string; cancelled_at: Date | null; cancelled_by_user_id: string | null; picked_up_at: Date | null; client_request_id: string | null }>
    >`SELECT id, status::text, cancelled_at, cancelled_by_user_id, picked_up_at, client_request_id FROM filling_orders ORDER BY id`;
    const updated = new Map(before.refills.map((r) => [r.id, r.updated_at]));
    for (const row of rows) {
      expect(row).toEqual({
        id: row.id,
        status: row.status,
        cancelled_at: row.status === 'CANCELLED' ? updated.get(row.id) : null,
        cancelled_by_user_id: null,
        picked_up_at: null,
        client_request_id: null,
      });
    }
    expect(rows.find((r) => r.id === REFILL.F3)?.cancelled_at).toEqual(new Date('2026-10-04T12:00:00.000Z'));
  });

  it('nothing else changed: the untouched tables, every old event, no test rows, and no money moved', async () => {
    const db = today.client();
    for (const table of UNTOUCHED) expect({ table, digest: await tableDigest(db, table) }).toEqual({ table, digest: before.digests[table] });
    expect((await eventDigest(db))[0]).toEqual(before.events);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM cylinder_events WHERE filling_order_id IS NOT NULL`).toEqual([{ n: 0 }]);
    for (const table of ['users', 'distributors', 'vehicles']) {
      expect({ table, test: await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${table} WHERE is_test`) }).toEqual({ table, test: [{ n: 0 }] });
    }
    for (const table of ['filling_order_cylinders', 'day_closes', 'day_close_lines']) {
      expect({ table, rows: (await tableDigest(db, table)).rows }).toEqual({ table, rows: 0 });
    }
    const mismatches = await db.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
    expect(await db.$queryRaw`SELECT id, advance_balance_paisa AS balance FROM distributors ORDER BY id`).toEqual([
      { id: AG, balance: 560000n },
      { id: BG, balance: 0n },
    ]);
  });

  it('the inc3 CHECKs hold: a refill has a cylinder, a line its step, a day its lock, an unknown number no cylinder, a fix its reason', async () => {
    const db = today.client();
    const dist = AG;
    expect(
      await refusal(() =>
        db.$executeRawUnsafe(
          `INSERT INTO filling_orders (id, distributor_id, cylinder_type_id, requested_count, price_per_cylinder_paisa, updated_at)
           VALUES (gen_random_uuid(), '${dist}', '${SIZE_11_8}', 0, 0, now())`,
        ),
      ),
    ).toContain('filling_orders_count_chk');
    const line = (status: string, state: string, filled: string | null, returned: string | null) =>
      db.$executeRawUnsafe(
        `INSERT INTO filling_order_cylinders (id, filling_order_id, cylinder_id, status, state_at_pickup, filled_at, returned_at)
         VALUES (gen_random_uuid(), '${REFILL.F4}', '${CYL_A4}', '${status}', '${state}', ${filled ? `'${filled}'` : 'NULL'}, ${returned ? `'${returned}'` : 'NULL'})`,
      );
    expect(await refusal(() => line('PICKED_UP', 'FULL', null, null))).toContain('foc_pickup_state_chk');
    expect(await refusal(() => line('PICKED_UP', 'EMPTY', '2026-10-07T10:00:00Z', null))).toContain('foc_steps_chk');
    expect(await refusal(() => line('FILLED', 'EMPTY', null, null))).toContain('foc_steps_chk');
    expect(await refusal(() => line('RETURNED', 'EMPTY', '2026-10-07T10:00:00Z', null))).toContain('foc_steps_chk');
    await line('RETURNED', 'PART_FILLED', null, '2026-10-07T12:00:00Z');
    // One line per refill and cylinder.
    expect(await refusal(() => line('PICKED_UP', 'EMPTY', null, null))).toContain('Key (filling_order_id, cylinder_id)');
    await db.$executeRawUnsafe(`DELETE FROM filling_order_cylinders`);

    const day = (status: string, locked: string | null, date = '2026-10-21') =>
      db.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO day_closes (id, distributor_id, business_date, status, locked_at, updated_at)
         VALUES (gen_random_uuid(), '${dist}', '${date}', '${status}', ${locked ? `'${locked}'` : 'NULL'}, now()) RETURNING id`,
      );
    expect(await refusal(() => day('APPROVED', null))).toContain('day_closes_locked_chk');
    expect(await refusal(() => day('OPEN', '2026-10-21T20:00:00Z'))).toContain('day_closes_locked_chk');
    const [open] = await day('OPEN', null);
    // One day per distributor and date.
    expect(await refusal(() => day('OPEN', null))).toContain('Key (distributor_id, business_date)');
    const dayLine = (cylinder: string | null, diff: string, key: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO day_close_lines (id, day_close_id, cylinder_id, sheet_key, diff)
         VALUES (gen_random_uuid(), '${open.id}', ${cylinder ? `'${cylinder}'` : 'NULL'}, '${key}', '${diff}')`,
      );
    expect(await refusal(() => dayLine(null, 'MATCH', 'AG-C0099'))).toContain('dcl_unknown_chk');
    expect(await refusal(() => dayLine(CYL_A1, 'UNKNOWN_CYLINDER', 'AG-C0001'))).toContain('dcl_unknown_chk');
    await dayLine(CYL_A1, 'STATE_DIFFERS', 'AG-C0001');
    await dayLine(null, 'UNKNOWN_CYLINDER', 'AG-C0099');
    // One line per day and sheet number.
    expect(await refusal(() => dayLine(CYL_A1, 'MATCH', 'AG-C0001'))).toContain('Key (day_close_id, sheet_key)');
    // A day-end fix needs its reason: inc2's cylinder_events_reason_chk covers the new DAY_END_FIX source.
    const office = ID('0000000000a1');
    const fix = (reason: string | null) =>
      db.$executeRawUnsafe(
        `INSERT INTO cylinder_events (id, cylinder_id, event_type, source, reason, actor_user_id, created_at)
         VALUES (gen_random_uuid(), '${CYL_A1}', 'ADJUSTED', 'DAY_END_FIX', ${reason ? `'${reason}'` : 'NULL'}, '${office}', now())`,
      );
    expect(await refusal(() => fix(null))).toContain('cylinder_events_reason_chk');
    await fix('Valve leaking');
    // The rows above are test-only: clean them up so the next checks see the migrated data.
    await db.$executeRawUnsafe(`DELETE FROM day_close_lines`);
    await db.$executeRawUnsafe(`DELETE FROM day_closes`);
    await db.$executeRawUnsafe(`DELETE FROM cylinder_events WHERE event_type = 'ADJUSTED'`);
  });

  it('the inc3 unique keys: refill numbers and request keys per distributor (another shop may share them)', async () => {
    const db = today.client();
    expect(await refusal(() => db.$executeRawUnsafe(`UPDATE filling_orders SET refill_no = 1 WHERE id = '${REFILL.F2}'`))).toContain(
      'Key (distributor_id, refill_no)',
    );
    // Bilal Gas may use number 1 too.
    await db.$executeRawUnsafe(`UPDATE filling_orders SET refill_no = 1 WHERE id = '${REFILL.G1}'`);
    const key = '22000000-0000-4000-8000-000000000001';
    await db.$executeRawUnsafe(`UPDATE filling_orders SET client_request_id = '${key}' WHERE id IN ('${REFILL.F4}', '${REFILL.G2}')`);
    expect(await refusal(() => db.$executeRawUnsafe(`UPDATE filling_orders SET client_request_id = '${key}' WHERE id = '${REFILL.F5}'`))).toContain(
      'Key (distributor_id, client_request_id)',
    );
    await db.$executeRawUnsafe(`UPDATE filling_orders SET refill_no = 3 WHERE id = '${REFILL.G1}'`);
    await db.$executeRawUnsafe(`UPDATE filling_orders SET client_request_id = NULL WHERE client_request_id IS NOT NULL`);
  });

  it('running the inc3 backfills again changes nothing', async () => {
    const db = today.client();
    const tables = ['distributors', 'filling_orders', 'cylinders', 'cylinder_events', 'audit_logs'];
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of tables) out[table] = await tableDigest(db, table);
      return out;
    };
    const first = await digest();
    const again = executeSql(today.url, inc3BackfillSql());
    expect({ code: again.code, output: again.code === 0 ? '' : again.output }).toEqual({ code: 0, output: '' });
    expect(await digest()).toEqual(first);
  });

  it('the API runs once the database has gone on through the current release: day-end is on, refills and Inc 2 reads still work', async () => {
    // Today's code reads the follow-ups' users columns (users_app_seen), so it runs only after that migration,
    // as every deploy migrates before it starts the new code (DATA_MODEL §2.5).
    const upgraded = runMigrateSh(makeRelease('current'), today.url);
    expect({ code: upgraded.code, output: upgraded.code === 0 ? '' : upgraded.output }).toEqual({ code: 0, output: '' });
    expect(await appliedMigrations(today.client())).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION, INC3_MIGRATION, APP_SEEN_MIGRATION]);
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = today.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const config = await http(app).get('/api/v1/app/config').expect(200);
      expect(config.body.features).toMatchObject({ refills: true, scanFlow: true, confirmations: false, typedCylinderNumber: true, dayEnd: true });
      expect(config.body.support.phone).toBe('0300 1112222');
      const shop = { userId: ID('000000000da1'), role: UserRole.DISTRIBUTOR, distributorId: AG };
      const refills = await http(app).get('/api/v1/filling-orders/mine').set(authHeader(shop)).expect(200);
      expect((refills.body as Array<{ id: string; pricePerCylinderPaisa: string }>).map((r) => r.id).sort()).toEqual(
        [REFILL.F1, REFILL.F2, REFILL.F3, REFILL.F4, REFILL.F5].sort(),
      );
      for (const refill of refills.body as Array<{ pricePerCylinderPaisa: string; totalCostPaisa: string }>) {
        expect([refill.pricePerCylinderPaisa, refill.totalCostPaisa]).toEqual(['0', '0']);
      }
      const orders = await http(app).get('/api/v1/orders').set(authHeader(shop)).expect(200);
      expect((orders.body as Array<{ shortCode: string }>).map((o) => o.shortCode)).toEqual(['AG-0001']);
      const wallet = await http(app).get('/api/v1/wallet').set(authHeader(shop)).expect(200);
      expect(wallet.body.balancePaisa).toBe('560000');
      const stock = await http(app).get('/api/v1/store/stock').set(authHeader(shop)).expect(200);
      expect(stock.body.total).toBe(3);
      const office = { userId: ID('0000000000a1'), role: UserRole.SUPER_ADMIN };
      const all = await http(app).get('/api/v1/filling-orders').set(authHeader(office)).expect(200);
      expect((all.body as unknown[]).length).toBe(7);
      const cases = await http(app).get('/api/v1/alerts').query({ type: 'CUSTOMER_PROBLEM' }).set(authHeader(office)).expect(200);
      expect(cases.body.items).toHaveLength(1);
      const history = await http(app).get('/api/v1/cylinders/AG-C0003/history').set(authHeader(office)).expect(200);
      expect((history.body.events as Array<{ action: string }>).map((e) => e.action)).toEqual(['REGISTERED', 'DELIVERED', 'PICKED_UP_EMPTY', 'SCAN_IN']);
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  });
});
