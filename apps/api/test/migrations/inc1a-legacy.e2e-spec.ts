/**
 * MIG-002 to MIG-007: a copy of the old (af889bf, `db push`) database goes through migrate.sh at the
 * baseline release, then at the inc1a release, and comes out with the DATA_MODEL §3.8 invariants
 * (1–15). The fixture is test/migrations/fixtures/legacy-mig.sql.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import {
  createScratchDb,
  disconnectAdmin,
  executeSql,
  executeSqlFile,
  FIXTURES_DIR,
  inc1aBackfillSql,
  makeRelease,
  pushAf889bfSchema,
  removeScratchRoot,
  runMigrateSh,
  tableDigest,
  type CommandResult,
  type ScratchDb,
} from '../helpers/migrations';

const ID = (suffix: string) => `00000000-0000-4000-8000-${suffix}`;
const D01 = ID('00000000d001');
const D02 = ID('00000000d002');
const D03 = ID('00000000d003');
const D04 = ID('00000000d004');

const LEGACY_TABLES = [
  'distributors',
  'orders',
  'payments',
  'ledger_entries',
  'trip_stops',
  'client_addresses',
  'clients',
  'expense_types',
  'expenses',
  'audit_logs',
  'alert_rules',
];

describeDb('migrations: inc1a on a copy of the old database', () => {
  let legacy: ScratchDb;
  let db: PrismaClient;
  let baselineRun: CommandResult;
  let inc1aRun: CommandResult;
  let before: {
    balances: Map<string, bigint>;
    ledger: Array<{ id: string; amount: bigint; balance_after: bigint; created_at: Date }>;
  };

  beforeAll(async () => {
    legacy = await createScratchDb('legacy');
    pushAf889bfSchema(legacy);
    const load = executeSqlFile(legacy.url, path.join(FIXTURES_DIR, 'legacy-mig.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    db = legacy.client();
    const balances = await db.$queryRaw<Array<{ id: string; b: bigint }>>`SELECT id, advance_balance_paisa AS b FROM distributors`;
    before = {
      balances: new Map(balances.map((row) => [row.id, row.b])),
      ledger: await db.$queryRaw`SELECT id, amount_paisa AS amount, balance_after_paisa AS balance_after, created_at FROM ledger_entries ORDER BY id`,
    };
    baselineRun = runMigrateSh(makeRelease('baseline'), legacy.url);
    inc1aRun = runMigrateSh(makeRelease('inc1a'), legacy.url);
  }, 600_000);

  afterAll(async () => {
    await legacy?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('migrate.sh brings the old database to the baseline, then applies inc1a', () => {
    expect({ code: baselineRun.code, output: baselineRun.output }).toMatchObject({ code: 0 });
    expect(baselineRun.output).toContain('Baseline release: last db push (refuses data loss), drift check, mark 0_baseline applied');
    expect({ code: inc1aRun.code, output: inc1aRun.output }).toMatchObject({ code: 0 });
    expect(inc1aRun.output).toMatch(/20261021195005_inc1a_foundations/);
  });

  it('MIG-002 migrating a copy of the old database gives every distributor a code and correct counters', async () => {
    const distributors = await db.$queryRaw<
      Array<{ id: string; code: string; next_order_no: number; next_topup_no: number; next_refill_no: number; next_cylinder_no: number }>
    >`SELECT id, code, next_order_no, next_topup_no, next_refill_no, next_cylinder_no FROM distributors ORDER BY created_at, id`;
    expect(distributors.map((d) => [d.id, d.code])).toEqual([
      [D01, 'D01'],
      [D02, 'D02'],
      [D03, 'D03'],
      [D04, 'D04'],
    ]);
    for (const d of distributors) expect(d.code).toMatch(/^[A-Z][A-Z0-9]{1,5}$/);
    expect(distributors.map((d) => [d.code, d.next_order_no, d.next_topup_no, d.next_refill_no, d.next_cylinder_no])).toEqual([
      ['D01', 13, 5, 1, 1],
      ['D02', 1, 1, 1, 1],
      ['D03', 2, 1, 1, 1],
      ['D04', 1, 1, 1, 1],
    ]);
    const orders = await db.$queryRaw<Array<{ id: string; order_no: number }>>`
      SELECT id, order_no FROM orders WHERE distributor_id = ${D01}::uuid ORDER BY created_at, id`;
    expect(orders.map((o) => o.order_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // O11 and O12 share a created_at: the id decides.
    expect(orders[10].id).toBe(ID('00000000b011'));
    const requests = await db.$queryRaw<Array<{ request_no: number }>>`
      SELECT request_no FROM payments WHERE distributor_id = ${D01}::uuid ORDER BY created_at, id`;
    expect(requests.map((p) => p.request_no)).toEqual([1, 2, 3, 4]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM orders WHERE order_no IS NULL`).toEqual([{ n: 0 }]);
    const checks = await db.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('distributors_code_chk', 'distributors_counters_chk') ORDER BY conname`;
    expect(checks).toEqual([
      { conname: 'distributors_code_chk', convalidated: true },
      { conname: 'distributors_counters_chk', convalidated: true },
    ]);
  });

  it('MIG-003 after migration every distributor ledger adds up to its cached balance', async () => {
    const openings = await db.$queryRaw<Array<{ distributor_id: string; amount: bigint; balance_after: bigint; key: string; reason: string }>>`
      SELECT distributor_id, amount_paisa AS amount, balance_after_paisa AS balance_after, idempotency_key AS key, reason_code AS reason
      FROM ledger_entries WHERE reason_code = 'OPENING_BALANCE' ORDER BY distributor_id`;
    expect(openings).toEqual([
      { distributor_id: D01, amount: 50_000n, balance_after: 500_000n, key: `opening:${D01}`, reason: 'OPENING_BALANCE' },
      { distributor_id: D03, amount: 200_000n, balance_after: 200_000n, key: `opening:${D03}`, reason: 'OPENING_BALANCE' },
      { distributor_id: D04, amount: -20_000n, balance_after: 10_000n, key: `opening:${D04}`, reason: 'OPENING_BALANCE' },
    ]);
    const keys = await db.$queryRaw<Array<{ id: string; key: string | null }>>`SELECT id, idempotency_key AS key FROM ledger_entries`;
    for (const row of keys) {
      expect(row.key).not.toBeNull();
      if (before.ledger.some((old) => old.id === row.id)) expect(row.key).toBe(`legacy:${row.id}`);
    }
    // The nightly check (DATA_MODEL §3.6) finds nothing.
    const mismatches = await db.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
    const audits = await db.$queryRaw<Array<{ resource_id: string; actor_kind: string; actor_label: string; actor_user_id: string | null }>>`
      SELECT resource_id, actor_kind::text, actor_label, actor_user_id FROM audit_logs WHERE action = 'wallet.opening_entry' ORDER BY resource_id`;
    expect(audits).toEqual(
      [D01, D03, D04].map((id) => ({ resource_id: id, actor_kind: 'SYSTEM', actor_label: 'migration:inc1a', actor_user_id: null })),
    );
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM alerts`).toEqual([{ n: 0 }]);
  });

  it('MIG-003 the migrated wallet history shows an "Opening balance" item', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = legacy.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const actor = { userId: ID('000000000d01'), role: UserRole.DISTRIBUTOR, distributorId: D01 };
      const statement = await client(app).get('/api/v1/wallet/statement').set(authHeader(actor)).expect(200);
      expect((statement.body.items as Array<{ kind: string }>).map((item) => item.kind)).toContain('OPENING_BALANCE');
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  });

  it('MIG-004 every expense gets a type, and the six standard types exist', async () => {
    const types = await db.$queryRaw<Array<{ code: string; name: string; is_system: boolean; sort_order: number; archived: boolean }>>`
      SELECT code, name, is_system, sort_order, archived_at IS NOT NULL AS archived FROM expense_types ORDER BY sort_order, code`;
    expect(types).toEqual([
      { code: 'PETROL', name: 'Petrol', is_system: true, sort_order: 10, archived: false },
      { code: 'MAINTENANCE', name: 'Maintenance', is_system: false, sort_order: 20, archived: false },
      { code: 'REPAIRS', name: 'Repairs', is_system: false, sort_order: 30, archived: false },
      { code: 'TYRES', name: 'Tyres', is_system: false, sort_order: 40, archived: false },
      { code: 'TOLL_PARKING', name: 'Toll/Parking', is_system: false, sort_order: 50, archived: false },
      { code: 'LEGACY_FOOD', name: 'Food', is_system: false, sort_order: 900, archived: true },
      { code: 'LEGACY_RENT', name: 'Rent', is_system: false, sort_order: 900, archived: true },
      { code: 'OTHER', name: 'Other', is_system: true, sort_order: 999, archived: false },
    ]);
    const mapped = await db.$queryRaw<Array<{ category: string; code: string; n: number }>>`
      SELECT e.category::text AS category, t.code, count(*)::int AS n
      FROM expenses e JOIN expense_types t ON t.id = e.type_id GROUP BY 1, 2 ORDER BY 1`;
    expect(mapped).toEqual([
      { category: 'FOOD', code: 'LEGACY_FOOD', n: 1 },
      { category: 'FUEL', code: 'PETROL', n: 3 },
      { category: 'MAINTENANCE', code: 'MAINTENANCE', n: 2 },
      { category: 'OTHER', code: 'OTHER', n: 1 },
      { category: 'RENT', code: 'LEGACY_RENT', n: 1 },
    ]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM expenses WHERE type_id IS NULL`).toEqual([{ n: 0 }]);
    // No money moved: every balance and every old ledger row is as it was.
    const balances = await db.$queryRaw<Array<{ id: string; b: bigint }>>`SELECT id, advance_balance_paisa AS b FROM distributors`;
    for (const row of balances) expect({ id: row.id, b: row.b }).toEqual({ id: row.id, b: before.balances.get(row.id) });
    const oldRows = await db.$queryRaw<Array<{ id: string; amount: bigint; balance_after: bigint; created_at: Date }>>`
      SELECT id, amount_paisa AS amount, balance_after_paisa AS balance_after, created_at FROM ledger_entries
      WHERE idempotency_key LIKE 'legacy:%' ORDER BY id`;
    expect(oldRows).toEqual(before.ledger);
  });

  it('MIG-004 the API lists the six active types and the archived ones marked archived', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = legacy.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const office = { userId: ID('0000000000a1'), role: UserRole.SUPER_ADMIN };
      const res = await client(app).get('/api/v1/expense-types').query({ includeArchived: 'true' }).set(authHeader(office)).expect(200);
      const rows = res.body as Array<{ code: string; archived: boolean }>;
      expect(rows.filter((row) => !row.archived).map((row) => row.code).sort()).toEqual(
        ['MAINTENANCE', 'OTHER', 'PETROL', 'REPAIRS', 'TOLL_PARKING', 'TYRES'].sort(),
      );
      expect(rows.filter((row) => row.archived).map((row) => row.code).sort()).toEqual(['LEGACY_FOOD', 'LEGACY_RENT']);
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  });

  it('MIG-005 customer phones become +923XXXXXXXXX, or stay as typed and are flagged for fixing', async () => {
    const phones = await db.$queryRaw<Array<{ id: string; name: string; phone: string }>>`
      SELECT id, name, phone FROM clients WHERE distributor_id = ${D01}::uuid ORDER BY created_at`;
    expect(phones.map((c) => [c.name, c.phone])).toEqual([
      ['Sana', '+923001234567'],
      ['Usman', '+923217654321'],
      ['Rashid', '+923331112222'],
      ['Landline', '042-35761234'],
      ['Shorty', '12345'],
    ]);
    const flags = await db.$queryRaw<Array<{ resource_id: string; actor_kind: string; actor_label: string; distributor_id: string }>>`
      SELECT resource_id, actor_kind::text, actor_label, distributor_id FROM audit_logs WHERE action = 'client.phone_needs_fix' ORDER BY resource_id`;
    expect(flags).toEqual(
      [ID('0000000c0004'), ID('0000000c0005')].map((id) => ({ resource_id: id, actor_kind: 'SYSTEM', actor_label: 'migration:inc1a', distributor_id: D01 })),
    );
    // The SQL and normalizePkPhone agree on the five inputs.
    const typed: Record<string, string> = { Sana: '0300 1234567', Usman: '0321-7654321', Rashid: '923331112222', Landline: '042-35761234', Shorty: '12345' };
    for (const c of phones) expect({ name: c.name, phone: c.phone }).toEqual({ name: c.name, phone: normalizePkPhone(typed[c.name]) ?? typed[c.name] });
    // Invariant 11: every phone is E.164 or has exactly one flag.
    expect(
      await db.$queryRaw`SELECT c.id FROM clients c WHERE c.phone !~ '^\\+923[0-9]{9}$'
        AND (SELECT count(*) FROM audit_logs a WHERE a.action = 'client.phone_needs_fix' AND a.resource_id = c.id) <> 1`,
    ).toEqual([]);
  });

  it('MIG-006 old orders keep their money state and never move money after the switch-over', async () => {
    const rows = await db.$queryRaw<
      Array<{ id: string; status: string; fee_status: string; fee_strategy: string | null; delivered_at: Date | null; delivery_method: string | null; cancelled_at: Date | null; updated_at: Date }>
    >`SELECT id, status::text, fee_status::text, fee_strategy::text, delivered_at, delivery_method::text, cancelled_at, updated_at
      FROM orders WHERE id IN (${ID('00000000b001')}::uuid, ${ID('00000000b002')}::uuid, ${ID('00000000b003')}::uuid, ${ID('00000000b004')}::uuid)
      ORDER BY id`;
    const [delivered, pending, cancelled, inTransit] = rows;
    expect(delivered).toMatchObject({ status: 'DELIVERED', fee_status: 'DEDUCTED', fee_strategy: 'LEGACY_ZONE_PAIR', delivery_method: 'DRIVER_TAP' });
    expect(delivered.delivered_at?.toISOString()).toBe('2026-10-06T11:30:00.000Z');
    expect(pending).toMatchObject({ status: 'PENDING', fee_status: 'NONE', fee_strategy: null });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', fee_status: 'NONE' });
    expect(cancelled.cancelled_at?.toISOString()).toBe(cancelled.updated_at.toISOString());
    expect(inTransit).toMatchObject({ status: 'IN_TRANSIT', fee_status: 'DEDUCTED', fee_strategy: 'LEGACY_ZONE_PAIR' });
    // An old free delivery: delivered_at falls back to updated_at.
    const free = await db.$queryRaw<Array<{ delivered_at: Date; updated_at: Date; fee_status: string }>>`
      SELECT delivered_at, updated_at, fee_status::text FROM orders WHERE id = ${ID('00000000b005')}::uuid`;
    expect(free[0].delivered_at.toISOString()).toBe(free[0].updated_at.toISOString());
    expect(free[0].fee_status).toBe('NONE');
  });

  it('inc1a deactivates the retired DISTRIBUTOR_CREDIT_OVER alert rules and keeps the others (backfill 12, invariant 13)', async () => {
    const rules = await db.$queryRaw<Array<{ rule_kind: string; is_active: boolean }>>`
      SELECT rule_kind::text, is_active FROM alert_rules ORDER BY rule_kind`;
    expect(rules).toEqual([
      { rule_kind: 'DISTRIBUTOR_BALANCE_LOW', is_active: true },
      { rule_kind: 'DISTRIBUTOR_CREDIT_OVER', is_active: false },
    ]);
  });

  it('inc1a adds the client_request_id keys of POST /clients and POST /distributors (G15-01)', async () => {
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname IN ('clients_distributor_id_client_request_id_key', 'distributors_client_request_id_key')
      ORDER BY indexname`;
    expect(indexes.map((row) => row.indexname)).toEqual(['clients_distributor_id_client_request_id_key', 'distributors_client_request_id_key']);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM clients WHERE client_request_id IS NOT NULL`).toEqual([{ n: 0 }]);
  });

  it('MIG-007 running the backfills a second time changes nothing', async () => {
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of LEGACY_TABLES) out[table] = await tableDigest(db, table);
      return out;
    };
    const first = await digest();
    const rerun = executeSql(legacy.url, inc1aBackfillSql());
    expect({ code: rerun.code, output: rerun.code === 0 ? '' : rerun.output }).toEqual({ code: 0, output: '' });
    expect(await digest()).toEqual(first);
  });

  // From Inc 2 the API runs only on the current release: inc1b and inc2 ship with it (DATA_MODEL §3.5), and
  // migrate.sh applies them before the new API starts. So the old open orders are cancelled through
  // today's API once this copy has gone through the Inc 2 release too (it has no run in progress, so the
  // inc2 pre-check passes). Last in the file: the cases above read the copy at the inc1a release.
  it('MIG-006 cancelling the old open orders returns nothing and writes no ledger row (after the Inc 2 release)', async () => {
    const upgraded = runMigrateSh(makeRelease('current'), legacy.url);
    expect({ code: upgraded.code, output: upgraded.code === 0 ? '' : upgraded.output }).toEqual({ code: 0, output: '' });
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = legacy.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const actor = { userId: ID('000000000d01'), role: UserRole.DISTRIBUTOR, distributorId: D01 };
      const ledgerBefore = await db.ledgerEntry.count();
      const balanceBefore = (await db.distributor.findUniqueOrThrow({ where: { id: D01 } })).advanceBalancePaisa;
      // Step 3.
      const pending = await client(app)
        .post(`/api/v1/orders/${ID('00000000b002')}/cancel`)
        .set(authHeader(actor))
        .send({ reasonCode: 'WRONG_ORDER' })
        .expect(200);
      expect(pending.body.refundedPaisa).toBe('0');
      // Step 4.
      const view = await client(app).get(`/api/v1/orders/${ID('00000000b004')}`).set(authHeader(actor)).expect(200);
      expect(view.body.cancel).toMatchObject({ refundPaisa: '0', noRefundReason: null });
      expect(view.body.confirmation).toBeNull();
      const charged = await client(app)
        .post(`/api/v1/orders/${ID('00000000b004')}/cancel`)
        .set(authHeader(actor))
        .send({ reasonCode: 'WRONG_ORDER' })
        .expect(200);
      expect(charged.body.refundedPaisa).toBe('0');
      // Step 5.
      expect(await db.ledgerEntry.count()).toBe(ledgerBefore);
      expect((await db.distributor.findUniqueOrThrow({ where: { id: D01 } })).advanceBalancePaisa).toBe(balanceBefore);
      const audits = await db.auditLog.findMany({ where: { action: 'order.cancel' } });
      expect(audits).toHaveLength(2);
      for (const row of audits) expect(row.diff).toMatchObject({ refunded: false, refundPaisa: '0' });
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  }, 600_000);
});
