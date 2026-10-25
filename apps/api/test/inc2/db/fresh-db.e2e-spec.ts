/**
 * The Increment 2 migrations on a fresh database (MIG-001's checks, carried to inc1b and inc2): an empty
 * PostGIS database migrates from empty through inc2_driver_flow with no drift (both CI checks), every
 * inc1a, inc1b and inc2 CHECK exists, the hand-written steps are safe on an empty database and safe to
 * run again, and the API runs on it with the Increment 2 settings live.
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
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
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
  'dzps_amount_chk',
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
];

// Every step here starts the Prisma CLI in a new process, so how long it takes depends on the machine more
// than on the database (the Inc 3 suite's hand-written steps took 49.5 s, past jest's 30-second default,
// while another job kept every core busy). The suite gets 10 minutes per test and hook.
jest.setTimeout(600_000);

describeDb('migrations: a fresh database through inc2', () => {
  let fresh: ScratchDb;
  let shadow: ScratchDb;

  beforeAll(async () => {
    fresh = await createScratchDb('fresh2');
    shadow = await createScratchDb('shadow2');
  });

  afterAll(async () => {
    await fresh?.drop();
    await shadow?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('migrates from empty through inc2_driver_flow with no drift, and the API runs on it', async () => {
    const deploy = prisma(['migrate', 'deploy'], fresh.url);
    expect({ code: deploy.code, output: deploy.code === 0 ? '' : deploy.output }).toEqual({ code: 0, output: '' });
    // The Increment 2 release's four migrations, in this order (later increments add theirs after them).
    expect(migrationNames().slice(0, 4)).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION]);
    expect(await appliedMigrations(fresh.client())).toEqual(migrationNames());
    const status = prisma(['migrate', 'status'], fresh.url);
    expect(status.output).toContain('Database schema is up to date');
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
    // NOT VALID only where old rows might break them (DATA_MODEL §2.4): inc1a's four old-table checks and
    // inc1b's ledger sign check. The balance check and the inc2 checks are validated.
    const notValid = ['expenses_amount_chk', 'ledger_entries_sign_chk', 'order_lines_counts_chk', 'orders_fee_chk', 'payments_amount_chk'];
    for (const check of checks.filter((c) => ALL_CHECKS.includes(c.conname))) {
      expect(check).toEqual({ conname: check.conname, convalidated: !notValid.includes(check.conname) });
    }
    // Nothing made rows on an empty database except the seeded expense types.
    for (const table of ['distributors', 'cylinders', 'cylinder_events', 'stop_cylinders', 'delivery_confirmations', 'outbound_messages']) {
      expect({ table, rows: (await tableDigest(db, table)).rows }).toEqual({ table, rows: 0 });
    }

    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = fresh.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      expect((await http(app).get('/api/v1/health').expect(200)).body.status).toBe('ok');
      const config = await http(app).get('/api/v1/app/config').expect(200);
      // From the Inc 3 release day-end is on by default (API_CONTRACT §6).
      expect(config.body.features).toMatchObject({ scanFlow: true, confirmations: false, typedCylinderNumber: true, dayEnd: true });
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  }, 600_000);

  it('every hand-written backfill and re-derive is safe on an empty database and changes nothing when run again', async () => {
    const db = fresh.client();
    const tables = ['distributors', 'orders', 'payments', 'ledger_entries', 'expenses', 'expense_types', 'cylinders', 'audit_logs'];
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of tables) out[table] = await tableDigest(db, table);
      return out;
    };
    const first = await digest();
    for (const sql of [inc1aBackfillSql(), inc1bRederiveSql(), inc2BackfillSql()]) {
      const run = executeSql(fresh.url, sql);
      expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    }
    expect(await digest()).toEqual(first);
  });
});
