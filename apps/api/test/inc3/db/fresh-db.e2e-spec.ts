/**
 * The Increment 3 migration on a fresh database (MIG-001's checks, carried to inc3): an empty PostGIS
 * database migrates from empty through inc3_refills_dayend with no drift (both CI checks), every CHECK of
 * inc1a to inc3 exists with the right validation, every inc3 table, column, key and foreign key is there,
 * the hand-written steps are safe on an empty database and safe to run again, and the API runs on it with
 * the Increment 3 settings live (day-end on by default).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import {
  appliedMigrations,
  createScratchDb,
  disconnectAdmin,
  executeSql,
  inc1aBackfillSql,
  inc1bRederiveSql,
  inc2BackfillSql,
  inc3BackfillSql,
  inc3PrecheckSql,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  INC3_MIGRATION,
  migrationNames,
  prisma,
  removeScratchRoot,
  tableDigest,
  type ScratchDb,
} from '../../helpers/migrations';

const ALL_CHECKS = [
  // inc1a
  'audit_logs_actor_chk',
  'distributors_code_chk',
  'distributors_counters_chk',
  'dzp_base_chk',
  // (dzps_amount_chk went with the per-size price rows: flat_delivery_cost, 2026-10-26.)
  'expense_types_name_chk',
  'expenses_amount_chk',
  'expenses_void_chk',
  'order_lines_counts_chk',
  'orders_fee_chk',
  'payments_amount_chk',
  'stored_files_size_chk',
  // inc1b
  'distributors_balance_chk',
  'ledger_entries_sign_chk',
  // inc2
  'cylinder_events_reason_chk',
  'delivery_confirmations_answer_chk',
  'stop_cylinders_return_state_chk',
  'stop_unlabelled_returns_count_chk',
  // inc3
  'day_closes_locked_chk',
  'dcl_unknown_chk',
  'filling_orders_count_chk',
  'foc_pickup_state_chk',
  'foc_steps_chk',
];

/** NOT VALID only where old rows might break them (DATA_MODEL §2.4). */
const NOT_VALID = ['expenses_amount_chk', 'filling_orders_count_chk', 'ledger_entries_sign_chk', 'order_lines_counts_chk', 'orders_fee_chk', 'payments_amount_chk'];

// Every step here starts the Prisma CLI in a new process (deploy, diffs, `db execute` once per hand-written
// step), so how long it takes depends on the machine more than on the database: the hand-written steps took
// 13 s on a quiet machine and 49.5 s while another job kept every core busy, past jest's 30-second default.
// The suite gets 10 minutes per test and hook; what it proves is unchanged.
jest.setTimeout(600_000);

describeDb('migrations: a fresh database through inc3', () => {
  let fresh: ScratchDb;
  let shadow: ScratchDb;

  beforeAll(async () => {
    fresh = await createScratchDb('fresh3');
    shadow = await createScratchDb('shadow3');
  });

  afterAll(async () => {
    await fresh?.drop();
    await shadow?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('migrates from empty through inc3_refills_dayend with no drift, and the API runs on it with day-end on', async () => {
    const deploy = prisma(['migrate', 'deploy'], fresh.url);
    expect({ code: deploy.code, output: deploy.code === 0 ? '' : deploy.output }).toEqual({ code: 0, output: '' });
    // The Increment 3 release's five migrations, in this order (later increments add theirs after them).
    expect(migrationNames().slice(0, 5)).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION, INC3_MIGRATION]);
    expect(await appliedMigrations(fresh.client())).toEqual(migrationNames());
    expect(prisma(['migrate', 'status'], fresh.url).output).toContain('Database schema is up to date');
    // The CI check (DATA_MODEL §2.5): schema.prisma against the migrations, on a shadow database.
    const drift = prisma(
      ['migrate', 'diff', '--from-schema-datamodel', 'prisma/schema.prisma', '--to-migrations', 'prisma/migrations', '--shadow-database-url', shadow.url, '--exit-code'],
      fresh.url,
    );
    expect({ code: drift.code, output: drift.output.trim() }).toEqual({ code: 0, output: expect.stringContaining('No difference detected') });
    const live = prisma(['migrate', 'diff', '--from-url', fresh.url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], fresh.url);
    expect(live.code).toBe(0);

    const db = fresh.client();
    const checks = await db.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname, convalidated FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname`;
    expect(checks.map((c) => c.conname)).toEqual(expect.arrayContaining(ALL_CHECKS));
    for (const check of checks.filter((c) => ALL_CHECKS.includes(c.conname))) {
      expect(check).toEqual({ conname: check.conname, convalidated: !NOT_VALID.includes(check.conname) });
    }
    // Nothing made rows on an empty database except the seeded expense types.
    for (const table of ['distributors', 'filling_orders', 'filling_order_cylinders', 'day_closes', 'day_close_lines', 'cylinder_events']) {
      expect({ table, rows: (await tableDigest(db, table)).rows }).toEqual({ table, rows: 0 });
    }

    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = fresh.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      expect((await http(app).get('/api/v1/health').expect(200)).body.status).toBe('ok');
      const config = await http(app).get('/api/v1/app/config').expect(200);
      expect(config.body.features).toMatchObject({ refills: true, scanFlow: true, confirmations: false, typedCylinderNumber: true, dayEnd: true });
      expect(config.body.refill).toEqual({ maxCylinders: 30 });
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  }, 600_000);

  it('the inc3 tables, keys and foreign keys are as DATA_MODEL §5 says', async () => {
    const db = fresh.client();
    const columns = await db.$queryRaw<Array<{ c: string; nullable: string; type: string; dflt: string | null }>>`
      SELECT table_name || '.' || column_name AS c, is_nullable AS nullable, udt_name AS type, column_default AS dflt
      FROM information_schema.columns
      WHERE table_schema = 'public' AND (table_name, column_name) IN (
        ('filling_orders','refill_no'), ('filling_orders','client_request_id'), ('filling_orders','picked_up_at'),
        ('filling_orders','cancelled_at'), ('filling_orders','cancelled_by_user_id'), ('cylinder_events','filling_order_id'),
        ('users','is_test'), ('distributors','is_test'), ('vehicles','is_test'), ('day_closes','business_date'),
        ('day_closes','upload_version'), ('day_close_lines','diff'), ('filling_order_cylinders','status'))
      ORDER BY 1`;
    expect(columns).toEqual([
      { c: 'cylinder_events.filling_order_id', nullable: 'YES', type: 'uuid', dflt: null },
      { c: 'day_close_lines.diff', nullable: 'NO', type: 'DayCloseDiff', dflt: `'MATCH'::"DayCloseDiff"` },
      { c: 'day_closes.business_date', nullable: 'NO', type: 'date', dflt: null },
      { c: 'day_closes.upload_version', nullable: 'NO', type: 'int4', dflt: '0' },
      { c: 'distributors.is_test', nullable: 'NO', type: 'bool', dflt: 'false' },
      { c: 'filling_order_cylinders.status', nullable: 'NO', type: 'FillingOrderCylinderStatus', dflt: `'PICKED_UP'::"FillingOrderCylinderStatus"` },
      { c: 'filling_orders.cancelled_at', nullable: 'YES', type: 'timestamp', dflt: null },
      { c: 'filling_orders.cancelled_by_user_id', nullable: 'YES', type: 'uuid', dflt: null },
      { c: 'filling_orders.client_request_id', nullable: 'YES', type: 'uuid', dflt: null },
      { c: 'filling_orders.picked_up_at', nullable: 'YES', type: 'timestamp', dflt: null },
      { c: 'filling_orders.refill_no', nullable: 'YES', type: 'int4', dflt: null },
      { c: 'users.is_test', nullable: 'NO', type: 'bool', dflt: 'false' },
      { c: 'vehicles.is_test', nullable: 'NO', type: 'bool', dflt: 'false' },
    ]);
    const unique = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexname IN (
        'filling_orders_distributor_id_refill_no_key', 'filling_orders_distributor_id_client_request_id_key',
        'filling_order_cylinders_filling_order_id_cylinder_id_key', 'day_closes_distributor_id_business_date_key',
        'day_close_lines_day_close_id_sheet_key_key', 'day_close_lines_applied_event_id_key')
      ORDER BY 1`;
    expect(unique).toHaveLength(6);
    const fks = await db.$queryRaw<Array<{ conname: string; confdeltype: string }>>`
      SELECT conname, confdeltype FROM pg_constraint WHERE contype = 'f' AND conname IN (
        'cylinder_events_filling_order_id_fkey', 'filling_order_cylinders_filling_order_id_fkey', 'filling_order_cylinders_cylinder_id_fkey',
        'day_closes_distributor_id_fkey', 'day_closes_sheet_file_id_fkey', 'day_closes_upload_file_id_fkey', 'day_close_lines_day_close_id_fkey',
        'day_close_lines_cylinder_id_fkey', 'day_close_lines_cylinder_type_id_fkey', 'day_close_lines_applied_event_id_fkey')
      ORDER BY 1`;
    // Every one RESTRICT: nothing deletes refill or day-end rows by cascade (the pilot reset deletes in key order).
    expect(fks).toHaveLength(10);
    for (const fk of fks) expect(fk).toEqual({ conname: fk.conname, confdeltype: 'r' });
    const values = await db.$queryRaw<Array<{ type: string; value: string }>>`
      SELECT t.typname AS type, e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE (t.typname, e.enumlabel) IN (('CylinderEventType','FILLED'), ('CylinderEventType','ADJUSTED'),
                                         ('CylinderEventSource','DAY_END_FIX'), ('AlertType','DAY_END_SUBMITTED'))
      ORDER BY 1, 2`;
    expect(values).toEqual([
      { type: 'AlertType', value: 'DAY_END_SUBMITTED' },
      { type: 'CylinderEventSource', value: 'DAY_END_FIX' },
      { type: 'CylinderEventType', value: 'ADJUSTED' },
      { type: 'CylinderEventType', value: 'FILLED' },
    ]);
  });

  it('every hand-written step, inc3 included, is safe on an empty database and changes nothing when run again', async () => {
    const db = fresh.client();
    const tables = ['distributors', 'orders', 'payments', 'ledger_entries', 'expenses', 'expense_types', 'cylinders', 'filling_orders', 'audit_logs'];
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of tables) out[table] = await tableDigest(db, table);
      return out;
    };
    const first = await digest();
    for (const sql of [inc1aBackfillSql(), inc1bRederiveSql(), inc2BackfillSql(), inc3PrecheckSql(), inc3BackfillSql()]) {
      const run = executeSql(fresh.url, sql);
      expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    }
    expect(await digest()).toEqual(first);
  });
});
