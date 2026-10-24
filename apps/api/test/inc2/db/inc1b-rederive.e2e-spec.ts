/**
 * inc1b step 2, "re-derive" (DATA_MODEL §3.5): while inc1a deployed, the previous (pre-Increment 1) code
 * briefly ran on the new schema and could write rows without the inc1a columns. inc1b fills them in with
 * the inc1a rules before its SET NOT NULLs: `legacy:` ledger keys, expense types from the old category
 * (making the archived LEGACY_ type when needed, or using the office's type of that name), order and
 * top-up numbers that continue from the highest number and the counter, and D-codes that skip codes
 * already in use. Running the step again changes nothing.
 */
import { describeDb } from '../../helpers/describe-db';
import {
  appliedMigrations,
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSql,
  inc1bRederiveSql,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  makeRelease,
  removeScratchRoot,
  runMigrateSh,
  tableDigest,
  type ScratchDb,
} from '../../helpers/migrations';

const ID = (suffix: string) => `40000000-0000-4000-8000-${suffix}`;
const D01 = ID('00000000d001');
const D02 = ID('00000000d002');
const NEW1 = ID('00000000d005'); // written by the old code after inc1a: no code
const NEW2 = ID('00000000d006');
const OFFICE = ID('0000000000a1');

/** Rows as inc1a left them, plus what the old code wrote afterwards without the new columns. */
const FIXTURE = `
INSERT INTO users (id, phone, name, role, status, created_at, updated_at) VALUES
 ('${OFFICE}', '+923331000001', 'Owner', 'SUPER_ADMIN', 'ACTIVE', now(), now()),
 ('${ID('000000000001')}', '+923211000001', 'One', 'DISTRIBUTOR', 'ACTIVE', now(), now()),
 ('${ID('000000000002')}', '+923211000002', 'Two', 'DISTRIBUTOR', 'ACTIVE', now(), now()),
 ('${ID('000000000003')}', '+923211000003', 'Ahmed', 'DISTRIBUTOR', 'ACTIVE', now(), now()),
 ('${ID('000000000004')}', '+923211000004', 'Custom D04', 'DISTRIBUTOR', 'ACTIVE', now(), now()),
 ('${ID('000000000005')}', '+923211000005', 'New One', 'DISTRIBUTOR', 'PENDING', now(), now()),
 ('${ID('000000000006')}', '+923211000006', 'New Two', 'DISTRIBUTOR', 'PENDING', now(), now());
INSERT INTO cities (id, name, country_code) VALUES ('${ID('0000000000c1')}', 'Lahore', 'PK');
INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at) VALUES
 ('${ID('0000000000e1')}', '${ID('0000000000c1')}', 'North',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((74.20 31.50, 74.25 31.50, 74.25 31.55, 74.20 31.55, 74.20 31.50)))'), 4326),
  ST_SetSRID(ST_MakePoint(74.225, 31.525), 4326), true, now(), now());
INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
SELECT ('${ID('0000000005')}' || lpad(n::text, 2, '0'))::uuid, 'Store ' || n, '${ID('0000000000e1')}', 'Road ' || n,
       ST_SetSRID(ST_MakePoint(74.21 + n * 0.001, 31.52), 4326), true, now(), now()
FROM generate_series(1, 6) n;
-- D01, D02 and AG numbered by inc1a; D04 is a code the office picked; the last two came from the old code with no code.
INSERT INTO distributors (id, user_id, business_name, code, home_store_id, advance_balance_paisa, status, next_order_no, next_topup_no, created_at, updated_at) VALUES
 ('${D01}', '${ID('000000000001')}', 'One Gas',    'D01', '${ID('000000000501')}', 0, 'ACTIVE', 3, 2, '2026-10-01T08:00:00Z', now()),
 ('${D02}', '${ID('000000000002')}', 'Two Gas',    'D02', '${ID('000000000502')}', 0, 'ACTIVE', 5, 1, '2026-10-02T08:00:00Z', now()),
 ('${ID('00000000d003')}', '${ID('000000000003')}', 'Ahmed Gas', 'AG', '${ID('000000000503')}', 0, 'ACTIVE', 1, 1, '2026-10-03T08:00:00Z', now()),
 ('${ID('00000000d004')}', '${ID('000000000004')}', 'Custom Gas', 'D04', '${ID('000000000504')}', 0, 'ACTIVE', 1, 1, '2026-10-04T08:00:00Z', now()),
 ('${NEW1}', '${ID('000000000005')}', 'New One Gas', NULL, '${ID('000000000505')}', 0, 'PENDING', 1, 1, '2026-10-05T08:00:00Z', now()),
 ('${NEW2}', '${ID('000000000006')}', 'New Two Gas', NULL, '${ID('000000000506')}', 0, 'PENDING', 1, 1, '2026-10-06T08:00:00Z', now());
INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at) VALUES
 ('${ID('00000000c001')}', '${D01}', 'Sana', '+923001234567', now(), now()),
 ('${ID('00000000c002')}', '${D02}', 'Usman', '+923217654321', now(), now());
-- D01: orders 1 and 2, then one from the old code with no number (created between them: it still comes after them).
-- D02: order 1, a counter ahead of it (5), then one with no number: it takes 5, never a number the counter gave out.
INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id, order_no, status, created_at, updated_at) VALUES
 ('${ID('0000000000b1')}', '${D01}', '${ID('00000000c001')}', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Home', '${ID('0000000000e1')}', 1, 'DELIVERED', '2026-10-07T08:00:00Z', now()),
 ('${ID('0000000000b2')}', '${D01}', '${ID('00000000c001')}', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Home', '${ID('0000000000e1')}', 2, 'PENDING', '2026-10-07T10:00:00Z', now()),
 ('${ID('0000000000b3')}', '${D01}', '${ID('00000000c001')}', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Home', '${ID('0000000000e1')}', NULL, 'PENDING', '2026-10-07T09:00:00Z', now()),
 ('${ID('0000000000b4')}', '${D02}', '${ID('00000000c002')}', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Home', '${ID('0000000000e1')}', 1, 'PENDING', '2026-10-07T08:00:00Z', now()),
 ('${ID('0000000000b5')}', '${D02}', '${ID('00000000c002')}', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Home', '${ID('0000000000e1')}', NULL, 'PENDING', '2026-10-07T11:00:00Z', now());
-- Top-ups: D01 number 1, then two with no number.
INSERT INTO payments (id, distributor_id, request_no, amount_paisa, provider, status, created_at) VALUES
 ('${ID('0000000fa001')}', '${D01}', 1, 100000, 'BANK_MANUAL', 'PENDING', '2026-10-07T08:00:00Z'),
 ('${ID('0000000fa002')}', '${D01}', NULL, 100000, 'BANK_MANUAL', 'FAILED', '2026-10-07T09:00:00Z'),
 ('${ID('0000000fa003')}', '${D01}', NULL, 200000, 'EASYPAISA', 'FAILED', '2026-10-07T10:00:00Z');
-- A ledger row with no key (the old ledger.service.ts).
INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, created_at) VALUES
 ('${ID('0000000e0001')}', '${D01}', 'CREDIT_TOPUP', 100000, 100000, NULL, '2026-10-07T08:00:00Z'),
 ('${ID('0000000e0002')}', '${D01}', 'DEBIT_ORDER', -100000, 0, 'order:${ID('0000000000b1')}:debit', '2026-10-07T08:30:00Z');
-- The office already has its own "Food" type (so LEGACY_FOOD can't take that name).
INSERT INTO expense_types (id, code, name, name_key, is_system, sort_order, created_by_user_id, created_at, updated_at) VALUES
 ('${ID('0000000e7f01')}', NULL, 'Food', 'food', false, 100, '${OFFICE}', now(), now());
-- Expenses the old code wrote with only a category.
INSERT INTO expenses (id, category, type_id, description, amount_paisa, expense_date, recorded_by_user_id, created_at, updated_at) VALUES
 ('${ID('0000000ee001')}', 'FUEL', NULL, 'Diesel', 100000, '2026-10-07', '${OFFICE}', now(), now()),
 ('${ID('0000000ee002')}', 'TRAVEL', NULL, 'Bus fare', 20000, '2026-10-07', '${OFFICE}', now(), now()),
 ('${ID('0000000ee003')}', 'FOOD', NULL, 'Lunch', 30000, '2026-10-07', '${OFFICE}', now(), now());
`;

describeDb('inc1b re-derive: rows the old code wrote after inc1a', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb('rederive');
    const deployed = deployRelease(db, 'inc1a');
    if (deployed.code !== 0) throw new Error(`inc1a deploy failed:\n${deployed.output}`);
    const load = executeSql(db.url, FIXTURE);
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    const run = runMigrateSh(makeRelease('inc2'), db.url);
    if (run.code !== 0) throw new Error(`the inc2 release failed:\n${run.output}`);
  }, 600_000);

  afterAll(async () => {
    await db?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('applies inc1b and inc2', async () => {
    expect(await appliedMigrations(db.client())).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION]);
  });

  it('gives the keyless ledger row its legacy: key and leaves keyed rows alone', async () => {
    const rows = await db.client().$queryRaw<Array<{ id: string; key: string }>>`
      SELECT id, idempotency_key AS key FROM ledger_entries ORDER BY id`;
    expect(rows).toEqual([
      { id: ID('0000000e0001'), key: `legacy:${ID('0000000e0001')}` },
      { id: ID('0000000e0002'), key: `order:${ID('0000000000b1')}:debit` },
    ]);
  });

  it('types the old expenses from their category, making the archived LEGACY_ type or using the office type of that name', async () => {
    const rows = await db.client().$queryRaw<Array<{ id: string; code: string | null; name: string; archived: boolean }>>`
      SELECT e.id, t.code, t.name, t.archived_at IS NOT NULL AS archived FROM expenses e JOIN expense_types t ON t.id = e.type_id ORDER BY e.id`;
    expect(rows).toEqual([
      { id: ID('0000000ee001'), code: 'PETROL', name: 'Petrol', archived: false },
      { id: ID('0000000ee002'), code: 'LEGACY_TRAVEL', name: 'Travel', archived: true },
      { id: ID('0000000ee003'), code: null, name: 'Food', archived: false },
    ]);
    expect(await db.client().$queryRaw`SELECT count(*)::int AS n FROM expense_types WHERE code = 'LEGACY_FOOD'`).toEqual([{ n: 0 }]);
  });

  it('numbers the orders and top-ups with no number after the highest number and the counter, and moves the counters on', async () => {
    const client = db.client();
    const orders = await client.$queryRaw<Array<{ id: string; order_no: number }>>`SELECT id, order_no FROM orders ORDER BY id`;
    expect(Object.fromEntries(orders.map((o) => [o.id, o.order_no]))).toEqual({
      [ID('0000000000b1')]: 1,
      [ID('0000000000b2')]: 2,
      [ID('0000000000b3')]: 3, // created between 1 and 2, numbered after them: numbers already given never change
      [ID('0000000000b4')]: 1,
      [ID('0000000000b5')]: 5, // the counter was at 5: never reuse a number it may have handed out
    });
    const payments = await client.$queryRaw<Array<{ id: string; request_no: number; status: string }>>`
      SELECT id, request_no, status::text FROM payments ORDER BY id`;
    expect(payments).toEqual([
      { id: ID('0000000fa001'), request_no: 1, status: 'PENDING' },
      { id: ID('0000000fa002'), request_no: 2, status: 'REJECTED' },
      // Only a refused manual top-up is relabelled; a failed gateway payment stays FAILED.
      { id: ID('0000000fa003'), request_no: 3, status: 'FAILED' },
    ]);
    const counters = await client.$queryRaw<Array<{ id: string; next_order_no: number; next_topup_no: number }>>`
      SELECT id, next_order_no, next_topup_no FROM distributors WHERE id IN (${D01}::uuid, ${D02}::uuid) ORDER BY id`;
    expect(counters).toEqual([
      { id: D01, next_order_no: 4, next_topup_no: 4 },
      { id: D02, next_order_no: 6, next_topup_no: 1 },
    ]);
  });

  it('gives the distributors with no code the next free D-numbers in created_at order, skipping codes in use', async () => {
    const rows = await db.client().$queryRaw<Array<{ id: string; code: string }>>`SELECT id, code FROM distributors ORDER BY created_at, id`;
    expect(rows.map((r) => r.code)).toEqual(['D01', 'D02', 'AG', 'D04', 'D05', 'D06']);
    expect(rows.find((r) => r.id === NEW1)?.code).toBe('D05');
    expect(rows.find((r) => r.id === NEW2)?.code).toBe('D06');
  });

  it('running the re-derive and relabel steps again changes nothing', async () => {
    const tables = ['distributors', 'orders', 'payments', 'ledger_entries', 'expenses', 'expense_types'];
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of tables) out[table] = await tableDigest(db.client(), table);
      return out;
    };
    const first = await digest();
    const again = executeSql(db.url, inc1bRederiveSql());
    expect({ code: again.code, output: again.code === 0 ? '' : again.output }).toEqual({ code: 0, output: '' });
    expect(await digest()).toEqual(first);
  });
});
