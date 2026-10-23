/**
 * MIG-001: an empty PostGIS database migrates to the current schema with no drift, and the API runs
 * on it (DATA_MODEL §2.2-§2.5, invariants 12 and 14 on an empty database).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { SEEDED_EXPENSE_TYPES } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createScratchDb, disconnectAdmin, INC1A_MIGRATION, prisma, removeScratchRoot, type ScratchDb } from '../helpers/migrations';

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
    expect(tables.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['distributor_zone_prices', 'distributor_zone_price_sizes', 'app_settings', 'stored_files', 'expense_types']),
    );
    const types = await db.$queryRaw<Array<{ code: string; name: string; is_system: boolean; sort_order: number }>>`
      SELECT code, name, is_system, sort_order FROM expense_types WHERE archived_at IS NULL ORDER BY sort_order`;
    expect(types).toEqual(SEEDED_EXPENSE_TYPES.map(({ code, name, isSystem, sortOrder }) => ({ code, name, is_system: isSystem, sort_order: sortOrder })));
    const history = await db.$queryRaw<Array<{ migration_name: string; finished: boolean; rolled_back: boolean }>>`
      SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
      FROM _prisma_migrations ORDER BY migration_name`;
    expect(history).toEqual([
      { migration_name: '0_baseline', finished: true, rolled_back: false },
      { migration_name: INC1A_MIGRATION, finished: true, rolled_back: false },
    ]);
    // Invariant 14: the inc1a CHECK constraints exist.
    const checks = await db.$queryRaw<Array<{ conname: string }>>`SELECT conname FROM pg_constraint WHERE contype = 'c' ORDER BY conname`;
    expect(checks.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
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
      ]),
    );

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
