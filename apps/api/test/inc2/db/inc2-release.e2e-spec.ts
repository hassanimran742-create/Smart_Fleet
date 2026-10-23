/**
 * The first Increment 2 release on today's data: a database at inc1a, loaded with rows as the
 * Increment 1 code writes them (fixtures/inc1-today.sql), goes through migrate.sh with inc1b_contract and
 * inc2_driver_flow (DATA_MODEL §3.5, §3.8 invariants 17–20, §4). Proves the contract step, the inc2
 * backfills (`last_event_id`, `short_no`, `next_cylinder_no`), the CHECKs and unique keys, that no money
 * moves, that both backfill sections can run again without changing anything, that the result has no
 * drift from schema.prisma, and that the API runs on it.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import {
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSql,
  executeSqlFile,
  inc1bRederiveSql,
  inc2BackfillSql,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  INC2_MIGRATION,
  makeRelease,
  prisma,
  removeScratchRoot,
  runMigrateSh,
  tableDigest,
  appliedMigrations,
  type CommandResult,
  type ScratchDb,
} from '../../helpers/migrations';

const ID = (suffix: string) => `10000000-0000-4000-8000-${suffix}`;
const AG = ID('00000000da00');
const BG = ID('00000000db00');
const CYL = {
  A1: ID('00000000ca01'),
  A2: ID('00000000ca02'),
  A3: ID('00000000ca03'),
  A4: ID('00000000ca04'),
  A5: ID('00000000ca05'),
  A6: ID('00000000ca06'),
  A7: ID('00000000ca07'),
  B1: ID('00000000cb01'),
};

/** A raw SQL statement that must fail, with the SQLSTATE and constraint it fails on. */
async function refusal(run: () => Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const text = String((error as Error).message ?? error);
    const code = /code: "?(\d{5}|[0-9A-Z]{5})"?/.exec(text)?.[1] ?? (/(23\d{3})/.exec(text)?.[1] as string | undefined);
    const constraint = /constraint "?([a-z0-9_]+)"?/i.exec(text)?.[1] ?? /([a-z0-9_]+_(?:chk|key))/.exec(text)?.[1];
    return { code, constraint, message: text };
  }
  throw new Error('expected the statement to be refused');
}

describeDb('inc2 release (inc1b + inc2) on today-shaped Increment 1 data', () => {
  let today: ScratchDb;
  let run: CommandResult;
  let before: {
    balances: Array<{ id: string; balance: bigint }>;
    ledger: { rows: number; md5: string };
    payments: Array<{ id: string; status: string }>;
  };

  beforeAll(async () => {
    today = await createScratchDb('today');
    const deployed = deployRelease(today, 'inc1a');
    if (deployed.code !== 0) throw new Error(`inc1a deploy failed:\n${deployed.output}`);
    const load = executeSqlFile(today.url, path.join(__dirname, 'fixtures', 'inc1-today.sql'));
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    const db = today.client();
    before = {
      balances: await db.$queryRaw`SELECT id, advance_balance_paisa AS balance FROM distributors ORDER BY id`,
      ledger: await tableDigest(db, 'ledger_entries'),
      payments: await db.$queryRaw`SELECT id, status::text FROM payments ORDER BY id`,
    };
    run = runMigrateSh(makeRelease('inc2'), today.url);
  }, 600_000);

  afterAll(async () => {
    await today?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('migrate.sh applies inc1b_contract, then inc2_driver_flow, on the Increment 1 database', async () => {
    expect({ code: run.code, output: run.code === 0 ? '' : run.output }).toEqual({ code: 0, output: '' });
    expect(run.output).toContain(INC1B_MIGRATION);
    expect(run.output).toContain(INC2_MIGRATION);
    expect(await appliedMigrations(today.client())).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION, INC2_MIGRATION]);
    // No drift: the migrated database is exactly prisma/schema.prisma.
    const live = prisma(['migrate', 'diff', '--from-url', today.url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], today.url);
    expect({ code: live.code, output: live.code === 0 ? '' : live.output }).toEqual({ code: 0, output: '' });
  });

  it('inc1b (invariants 17–19): the contract columns are NOT NULL, phones are unique per distributor, the old refused top-up is REJECTED', async () => {
    const db = today.client();
    const columns = await db.$queryRaw<Array<{ table_name: string; column_name: string; is_nullable: string }>>`
      SELECT table_name, column_name, is_nullable FROM information_schema.columns
      WHERE (table_name, column_name) IN (('distributors','home_store_id'), ('distributors','code'), ('ledger_entries','idempotency_key'),
                                          ('expenses','type_id'), ('orders','order_no'), ('payments','request_no'))
      ORDER BY table_name, column_name`;
    expect(columns).toHaveLength(6);
    for (const column of columns) expect(column).toMatchObject({ is_nullable: 'NO' });
    const unique = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'clients_distributor_id_phone_key'`;
    expect(unique[0]?.indexdef).toMatch(/UNIQUE INDEX clients_distributor_id_phone_key ON public\.clients USING btree \(distributor_id, phone\)/);
    expect(await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname = 'clients_distributor_id_phone_idx'`).toEqual([]);
    const fk = await db.$queryRaw<Array<{ confdeltype: string }>>`
      SELECT confdeltype FROM pg_constraint WHERE conname = 'distributors_home_store_id_fkey'`;
    expect(fk).toEqual([{ confdeltype: 'r' }]);
    const payments = await db.$queryRaw<Array<{ id: string; status: string }>>`SELECT id, status::text FROM payments ORDER BY id`;
    expect(payments).toEqual(
      before.payments.map((p) => ({ id: p.id, status: p.status === 'FAILED' ? 'REJECTED' : p.status })),
    );
    expect(payments.find((p) => p.id === ID('0000000fb001'))?.status).toBe('REJECTED');
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM payments WHERE provider = 'BANK_MANUAL' AND status = 'FAILED'`).toEqual([{ n: 0 }]);
  });

  it('inc1b (invariant 18): the balance and ledger-sign guards exist, and no balance is below zero', async () => {
    const db = today.client();
    const checks = await db.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('distributors_balance_chk', 'ledger_entries_sign_chk') ORDER BY conname`;
    expect(checks).toEqual([
      { conname: 'distributors_balance_chk', convalidated: true },
      { conname: 'ledger_entries_sign_chk', convalidated: false },
    ]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM distributors WHERE advance_balance_paisa < 0`).toEqual([{ n: 0 }]);
  });

  it('no money moved: every balance and the whole ledger are as they were, and the nightly check is clean', async () => {
    const db = today.client();
    expect(await db.$queryRaw`SELECT id, advance_balance_paisa AS balance FROM distributors ORDER BY id`).toEqual(before.balances);
    expect(await tableDigest(db, 'ledger_entries')).toEqual(before.ledger);
    const mismatches = await db.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
  });

  it('inc2 backfill 1: last_event_id is the newest event only where it ended at the current holder', async () => {
    const rows = await today.client().$queryRaw<Array<{ id: string; last_event_id: string | null }>>`
      SELECT id, last_event_id FROM cylinders ORDER BY id`;
    const last = Object.fromEntries(rows.map((r) => [r.id, r.last_event_id]));
    expect(last).toEqual({
      [CYL.A1]: null, // no events
      [CYL.A2]: ID('0000000ce202'), // DELIVERED to Sana, with Sana
      [CYL.A3]: ID('0000000ce304'), // SCAN_IN to the store, in the store
      [CYL.A4]: ID('0000000ce401'), // SCAN_OUT onto LEA-101, on LEA-101
      [CYL.A5]: null, // newest says Sana, but it is in the store: scan it in before it goes out
      [CYL.A6]: null,
      [CYL.A7]: null,
      [CYL.B1]: null,
    });
  });

  it('inc2 backfill 2: short_no runs 1… per distributor by (created_at, id), and next_cylinder_no follows', async () => {
    const db = today.client();
    const numbers = await db.$queryRaw<Array<{ id: string; short_no: number }>>`SELECT id, short_no FROM cylinders ORDER BY id`;
    expect(Object.fromEntries(numbers.map((r) => [r.id, r.short_no]))).toEqual({
      [CYL.A1]: 1,
      [CYL.A2]: 2,
      [CYL.A3]: 3,
      [CYL.A4]: 4,
      [CYL.A5]: 5,
      // A6 and A7 were created at the same moment: the id decides.
      [CYL.A6]: 6,
      [CYL.A7]: 7,
      [CYL.B1]: 1,
    });
    const counters = await db.$queryRaw<Array<{ id: string; next_cylinder_no: number; next_order_no: number; next_topup_no: number }>>`
      SELECT id, next_cylinder_no, next_order_no, next_topup_no FROM distributors ORDER BY id`;
    expect(counters).toEqual([
      { id: AG, next_cylinder_no: 8, next_order_no: 4, next_topup_no: 2 },
      { id: BG, next_cylinder_no: 2, next_order_no: 2, next_topup_no: 2 },
    ]);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM cylinders WHERE short_no IS NULL`).toEqual([{ n: 0 }]);
  });

  it('inc2: old events become SCAN events, and every inc2 table, column and enum value exists', async () => {
    const db = today.client();
    expect(await db.$queryRaw`SELECT DISTINCT source::text FROM cylinder_events`).toEqual([{ source: 'SCAN' }]);
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename IN ('stop_cylinders', 'stop_unlabelled_returns', 'delivery_confirmations', 'outbound_messages') ORDER BY 1`;
    expect(tables.map((t) => t.tablename)).toEqual(['delivery_confirmations', 'outbound_messages', 'stop_cylinders', 'stop_unlabelled_returns']);
    const values = await db.$queryRaw<Array<{ type: string; value: string }>>`
      SELECT t.typname AS type, e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE (t.typname, e.enumlabel) IN (('CylinderState','PART_FILLED'), ('CylinderEventType','REGISTERED'),
                                         ('AlertType','CUSTOMER_PROBLEM'), ('AlertType','VAN_NOT_EMPTY'))
      ORDER BY 1, 2`;
    expect(values).toEqual([
      { type: 'AlertType', value: 'CUSTOMER_PROBLEM' },
      { type: 'AlertType', value: 'VAN_NOT_EMPTY' },
      { type: 'CylinderEventType', value: 'REGISTERED' },
      { type: 'CylinderState', value: 'PART_FILLED' },
    ]);
    const columns = await db.$queryRaw<Array<{ c: string }>>`
      SELECT table_name || '.' || column_name AS c FROM information_schema.columns
      WHERE (table_name, column_name) IN (('cylinders','short_no'), ('cylinders','last_event_id'), ('cylinder_events','source'),
        ('cylinder_events','from_state'), ('cylinder_events','to_state'), ('cylinder_events','reason'), ('cylinder_events','client_scan_id'),
        ('cylinder_events','trip_stop_id'), ('trips','leftover_reason'), ('alerts','distributor_id'), ('alerts','resolved_by_user_id'),
        ('alerts','resolution_note'))
      ORDER BY 1`;
    expect(columns).toHaveLength(12);
  });

  it('inc2 CHECKs: return states, reasons for office moves, unlabelled counts above 0, answered exactly when there is an answer', async () => {
    const db = today.client();
    const checks = await db.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname IN ('stop_cylinders_return_state_chk', 'cylinder_events_reason_chk',
        'stop_unlabelled_returns_count_chk', 'delivery_confirmations_answer_chk') ORDER BY 1`;
    expect(checks.map((c) => c.conname)).toEqual([
      'cylinder_events_reason_chk',
      'delivery_confirmations_answer_chk',
      'stop_cylinders_return_state_chk',
      'stop_unlabelled_returns_count_chk',
    ]);
    // Rows to hang the checks on: AG's T2 delivery stop (order O3), a fresh event of A1.
    const stop = ID('0000000072b2');
    const order = ID('0000000000b3');
    const size = ID('0000000000a9');
    const driver = ID('000000000e02');
    const event = async (source: string, reason: string | null) =>
      db.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO cylinder_events (id, cylinder_id, event_type, source, reason, actor_user_id, created_at)
         VALUES (gen_random_uuid(), '${CYL.A1}', 'SCAN_IN', '${source}', ${reason === null ? 'NULL' : `'${reason}'`}, '${driver}', now()) RETURNING id`,
      );
    const manual = await refusal(() => event('MANUAL', null));
    expect(manual.message).toContain('cylinder_events_reason_chk');
    const [typed] = await event('TYPED', null);
    const [office] = await event('MANUAL', 'Customer said it was delivered');
    const stopRow = (direction: string, returnState: string | null, eventId: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO stop_cylinders (id, trip_stop_id, order_id, cylinder_id, cylinder_type_id, direction, return_state, event_id)
         VALUES (gen_random_uuid(), '${stop}', '${order}', '${CYL.A1}', '${size}', '${direction}', ${returnState === null ? 'NULL' : `'${returnState}'`}, '${eventId}')`,
      );
    expect((await refusal(() => stopRow('GIVEN', 'EMPTY', typed.id))).message).toContain('stop_cylinders_return_state_chk');
    expect((await refusal(() => stopRow('TAKEN_BACK', null, typed.id))).message).toContain('stop_cylinders_return_state_chk');
    expect((await refusal(() => stopRow('TAKEN_BACK', 'LOST', typed.id))).message).toContain('stop_cylinders_return_state_chk');
    await stopRow('TAKEN_BACK', 'PART_FILLED', typed.id);
    // Given on a visit can't be taken back on it: one row per stop and cylinder (stop_cylinders_trip_stop_id_cylinder_id_key).
    expect((await refusal(() => stopRow('GIVEN', null, office.id))).message).toContain('Key (trip_stop_id, cylinder_id)');
    const unlabelled = (count: number) =>
      db.$executeRawUnsafe(
        `INSERT INTO stop_unlabelled_returns (id, trip_stop_id, order_id, cylinder_type_id, state, count, recorded_by_user_id, updated_at)
         VALUES (gen_random_uuid(), '${stop}', '${order}', '${size}', 'EMPTY', ${count}, '${driver}', now())`,
      );
    expect((await refusal(() => unlabelled(0))).message).toContain('stop_unlabelled_returns_count_chk');
    await unlabelled(2);
    const confirmation = (status: string, response: string | null, hashChar: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO delivery_confirmations (id, order_id, distributor_id, token_hash, status, expires_at, snapshot, response, updated_at)
         VALUES (gen_random_uuid(), '${ID('0000000000b1')}', '${AG}', repeat('${hashChar}', 64), '${status}', now() + interval '3 days', '{}', ${response === null ? 'NULL' : `'${response}'`}, now())`,
      );
    expect((await refusal(() => confirmation('ANSWERED', null, 'a'))).message).toContain('delivery_confirmations_answer_chk');
    expect((await refusal(() => confirmation('PENDING', 'YES', 'a'))).message).toContain('delivery_confirmations_answer_chk');
    await confirmation('ANSWERED', 'YES', 'a');
    // One confirmation per order (delivery_confirmations_order_id_key).
    expect((await refusal(() => confirmation('PENDING', null, 'b'))).message).toContain('Key (order_id)');
    // The rows above are test-only: clean them up so the next checks see the migrated data.
    await db.$executeRawUnsafe(`DELETE FROM delivery_confirmations`);
    await db.$executeRawUnsafe(`DELETE FROM stop_unlabelled_returns`);
    await db.$executeRawUnsafe(`DELETE FROM stop_cylinders`);
    await db.$executeRawUnsafe(`DELETE FROM cylinder_events WHERE id IN ('${typed.id}', '${office.id}')`);
  });

  it('inc2 unique keys: one (actor, scan id), one short number per distributor, one message per key', async () => {
    const db = today.client();
    const driver = ID('000000000e01');
    const scanId = '20000000-0000-4000-8000-000000000001';
    const insert = () =>
      db.$executeRawUnsafe(
        `INSERT INTO cylinder_events (id, cylinder_id, event_type, actor_user_id, client_scan_id, created_at)
         VALUES (gen_random_uuid(), '${CYL.A6}', 'SCAN_IN', '${driver}', '${scanId}', now())`,
      );
    await insert();
    expect((await refusal(insert)).message).toContain('Key (actor_user_id, client_scan_id)');
    await db.$executeRawUnsafe(`DELETE FROM cylinder_events WHERE client_scan_id = '${scanId}'`);
    expect((await refusal(() => db.$executeRawUnsafe(`UPDATE cylinders SET short_no = 1 WHERE id = '${CYL.A2}'`))).message).toContain(
      'Key (distributor_id, short_no)',
    );
    // Another distributor may use the same number.
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM cylinders WHERE short_no = 1`).toEqual([{ n: 2 }]);
    const message = () =>
      db.$executeRawUnsafe(
        `INSERT INTO outbound_messages (id, channel, provider, template_key, body_redacted, status, idempotency_key)
         VALUES (gen_random_uuid(), 'SMS', 'mock', 'sms.deliveryConfirm.v1', 'Ahmed Gas: Order AG-0001 delivered. Did you get it? Tap [link]', 'QUEUED', 'confirm:x:v1:sms')`,
      );
    await message();
    expect((await refusal(message)).message).toContain('Key (idempotency_key)');
    await db.$executeRawUnsafe(`DELETE FROM outbound_messages`);
  });

  it('running the inc1b re-derive and the inc2 backfills again changes nothing', async () => {
    const db = today.client();
    const tables = ['distributors', 'orders', 'payments', 'ledger_entries', 'expenses', 'expense_types', 'cylinders', 'cylinder_events', 'clients'];
    const digest = async () => {
      const out: Record<string, { rows: number; md5: string }> = {};
      for (const table of tables) out[table] = await tableDigest(db, table);
      return out;
    };
    const first = await digest();
    const again1b = executeSql(today.url, inc1bRederiveSql());
    expect({ code: again1b.code, output: again1b.code === 0 ? '' : again1b.output }).toEqual({ code: 0, output: '' });
    const again2 = executeSql(today.url, inc2BackfillSql());
    expect({ code: again2.code, output: again2.code === 0 ? '' : again2.output }).toEqual({ code: 0, output: '' });
    expect(await digest()).toEqual(first);
  });

  it('the API runs on the migrated database: Inc 2 is on, confirmation stays off, and Inc 1 reads still work', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = today.url;
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const config = await http(app).get('/api/v1/app/config').expect(200);
      expect(config.body.features).toMatchObject({ scanFlow: true, confirmations: false, typedCylinderNumber: true, dayEnd: false });
      expect(config.body.support.phone).toBe('0300 1112222');
      const shop = { userId: ID('000000000da1'), role: UserRole.DISTRIBUTOR, distributorId: AG };
      const orders = await http(app).get('/api/v1/orders').set(authHeader(shop)).expect(200);
      expect((orders.body as Array<{ shortCode: string }>).map((o) => o.shortCode).sort()).toEqual(['AG-0001', 'AG-0002', 'AG-0003']);
      const wallet = await http(app).get('/api/v1/wallet').set(authHeader(shop)).expect(200);
      expect(wallet.body.balancePaisa).toBe('500000');
      const office = { userId: ID('0000000000a1'), role: UserRole.SUPER_ADMIN };
      const board = await http(app).get('/api/v1/orders/board').query({ tab: 'all' }).set(authHeader(office)).expect(200);
      expect(board.body.items.length).toBe(4);
      const driver = { userId: ID('000000000e02'), role: UserRole.DRIVER, driverId: ID('00000000e002') };
      const trips = await http(app).get('/api/v1/trips/mine').set(authHeader(driver)).expect(200);
      expect((trips.body as Array<{ id: string }>).map((t) => t.id)).toContain(ID('0000000071a2'));
    } finally {
      await app?.close();
      process.env.DATABASE_URL = previous;
    }
  });
});
