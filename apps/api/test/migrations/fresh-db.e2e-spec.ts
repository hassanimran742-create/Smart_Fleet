/**
 * MIG-001: an empty PostGIS database migrates to the current schema with no drift, and the API runs
 * on it (DATA_MODEL §2.2-§2.5, invariants 12 and 14 on an empty database).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { SEEDED_EXPENSE_TYPES } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import {
  createScratchDb,
  disconnectAdmin,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  migrationNames,
  prisma,
  removeScratchRoot,
  type ScratchDb,
} from '../helpers/migrations';

// The steps start the Prisma CLI in new processes, so their time depends on the machine more than on the
// database (another fresh-db suite's steps took 49.5 s, past jest's 30-second default, while another job
// kept every core busy). The suite gets 10 minutes per test and hook.
jest.setTimeout(600_000);

describeDb('migrations: a fresh database', () => {
  let fresh: ScratchDb;
  let shadow: ScratchDb;

  beforeAll(async () => {
    fresh = await createScratchDb('fresh');
    shadow = await createScratchDb('shadow');
  });

  afterAll(async () => {
    await fresh?.drop();
    await shadow?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('MIG-001 a fresh database migrates from empty to the current schema with no drift', async () => {
    // Step 1.
    const deploy = prisma(['migrate', 'deploy'], fresh.url);
    expect({ code: deploy.code, output: deploy.code === 0 ? '' : deploy.output }).toEqual({ code: 0, output: '' });
    expect(deploy.output).toContain('0_baseline');
    expect(deploy.output).toContain(INC1A_MIGRATION);
    // From Increment 2 the history also holds inc1b and inc2 (DATA_MODEL §3.5, §4.4).
    expect(deploy.output).toContain(INC1B_MIGRATION);
    expect(deploy.output).toContain(INC2_MIGRATION);
    // Step 2.
    const status = prisma(['migrate', 'status'], fresh.url);
    expect(status.code).toBe(0);
    expect(status.output).toContain('Database schema is up to date');
    // Step 3: the CI check. The schema is the FROM side: with --from-migrations, Prisma 5.22 ignores the
    // postgresqlExtensions preview feature on the shadow side and reports the extensions as missing.
    const drift = prisma(
      ['migrate', 'diff', '--from-schema-datamodel', 'prisma/schema.prisma', '--to-migrations', 'prisma/migrations', '--shadow-database-url', shadow.url, '--exit-code'],
      fresh.url,
    );
    expect({ code: drift.code, output: drift.output.trim() }).toEqual({ code: 0, output: expect.stringContaining('No difference detected') });
    const live = prisma(['migrate', 'diff', '--from-url', fresh.url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], fresh.url);
    expect(live.code).toBe(0);

    // Step 4.
    const db = fresh.client();
    const extensions = await db.$queryRaw<Array<{ extname: string }>>`SELECT extname FROM pg_extension ORDER BY extname`;
    expect(extensions.map((row) => row.extname)).toEqual(expect.arrayContaining(['pgcrypto', 'postgis', 'uuid-ossp']));
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    expect(tables.map((row) => row.tablename)).toEqual(expect.arrayContaining(['distributor_zone_prices', 'app_settings', 'stored_files', 'expense_types']));
    // flat_delivery_cost dropped inc1a's per-size price rows: one delivery cost per order (ADR-08).
    expect(tables.map((row) => row.tablename)).not.toContain('distributor_zone_price_sizes');
    const types = await db.$queryRaw<Array<{ code: string; name: string; is_system: boolean; sort_order: number }>>`
      SELECT code, name, is_system, sort_order FROM expense_types WHERE archived_at IS NULL ORDER BY sort_order`;
    expect(types).toEqual(SEEDED_EXPENSE_TYPES.map(({ code, name, isSystem, sortOrder }) => ({ code, name, is_system: isSystem, sort_order: sortOrder })));
    const history = await db.$queryRaw<Array<{ migration_name: string; finished: boolean; rolled_back: boolean }>>`
      SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
      FROM _prisma_migrations ORDER BY migration_name`;
    // Every migration of the release, in order: 0_baseline, inc1a, inc1b, inc2, then any later ones.
    expect(migrationNames().slice(0, 4)).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION]);
    expect(history).toEqual(migrationNames().map((migration_name) => ({ migration_name, finished: true, rolled_back: false })));
    // Invariant 14: the inc1a CHECK constraints exist.
    const checks = await db.$queryRaw<Array<{ conname: string }>>`SELECT conname FROM pg_constraint WHERE contype = 'c' ORDER BY conname`;
    expect(checks.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        'audit_logs_actor_chk',
        'distributors_code_chk',
        'distributors_counters_chk',
        'dzp_base_chk',
        'expense_types_name_chk',
        'expenses_amount_chk',
        'expenses_void_chk',
        'order_lines_counts_chk',
        'orders_fee_chk',
        'payments_amount_chk',
        'stored_files_size_chk',
      ]),
    );
    // dzps_amount_chk went with the per-size price rows (flat_delivery_cost).
    expect(checks.map((row) => row.conname)).not.toContain('dzps_amount_chk');

    // Step 5: the API runs on it.
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = fresh.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const health = await client(app).get('/api/v1/health').expect(200);
      expect(health.body.status).toBe('ok');
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  }, 600_000);
});
