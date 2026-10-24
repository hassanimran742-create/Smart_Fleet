/**
 * MIG-014: the inc1b contract migration blocks bad data and adds the balance guards (DATA_MODEL §3.5,
 * §2.6, §3.8 invariants 17–20; API_CONTRACT §2.2 23514 mapping). A database at inc1a with one
 * distributor without a store, another with a balance of −Rs 100 and a matching ledger, two customers
 * of AG with +923001234567, and one BANK_MANUAL payment with status FAILED. The pre-checks run in their
 * order (store, negative balance, duplicate phones); each fix is followed by `migrate resolve
 * --rolled-back` and migrate.sh, and the migration applies only once all three are fixed.
 */
import { describeDb } from '../../helpers/describe-db';
import {
  appliedMigrations,
  createScratchDb,
  deployRelease,
  disconnectAdmin,
  executeSql,
  INC1A_MIGRATION,
  INC1B_MIGRATION,
  makeRelease,
  prisma,
  releaseSchema,
  removeScratchRoot,
  runMigrateSh,
  type ScratchDb,
} from '../../helpers/migrations';

const ID = (suffix: string) => `30000000-0000-4000-8000-${suffix}`;
const AG = ID('00000000da00');
const NS = ID('00000000de00'); // no store
const MB = ID('00000000df00'); // minus balance
const SANA = ID('00000000c001');
const SANA_AGAIN = ID('00000000c002');
const FAILED_TOPUP = ID('0000000fa001');
const OFFICE = ID('0000000000a1');

const FIXTURE = `
INSERT INTO users (id, phone, name, role, status, created_at, updated_at) VALUES
 ('${OFFICE}', '+923331000001', 'Owner', 'SUPER_ADMIN', 'ACTIVE', now(), now()),
 ('${ID('000000000da1')}', '+923211234567', 'Ahmed Gas', 'DISTRIBUTOR', 'ACTIVE', now(), now()),
 ('${ID('000000000de1')}', '+923211234568', 'No Store Gas', 'DISTRIBUTOR', 'PENDING', now(), now()),
 ('${ID('000000000df1')}', '+923211234569', 'Minus Gas', 'DISTRIBUTOR', 'ACTIVE', now(), now());
INSERT INTO cities (id, name, country_code) VALUES ('${ID('0000000000c1')}', 'Lahore', 'PK');
INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at) VALUES
 ('${ID('0000000000e1')}', '${ID('0000000000c1')}', 'North',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((74.20 31.50, 74.25 31.50, 74.25 31.55, 74.20 31.55, 74.20 31.50)))'), 4326),
  ST_SetSRID(ST_MakePoint(74.225, 31.525), 4326), true, now(), now());
INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at) VALUES
 ('${ID('0000000005a1')}', 'Ahmed Gas Store', '${ID('0000000000e1')}', 'Mall Road', ST_SetSRID(ST_MakePoint(74.22, 31.52), 4326), true, now(), now()),
 ('${ID('0000000005f1')}', 'Minus Gas Store', '${ID('0000000000e1')}', 'Jail Road', ST_SetSRID(ST_MakePoint(74.23, 31.52), 4326), true, now(), now());
INSERT INTO distributors (id, user_id, business_name, code, home_store_id, advance_balance_paisa, status, next_topup_no, created_at, updated_at) VALUES
 ('${AG}', '${ID('000000000da1')}', 'Ahmed Gas', 'AG', '${ID('0000000005a1')}', 500000, 'ACTIVE', 2, '2026-10-01T08:00:00Z', now()),
 ('${NS}', '${ID('000000000de1')}', 'No Store Gas', 'NS', NULL, 0, 'PENDING', 1, '2026-10-02T08:00:00Z', now()),
 ('${MB}', '${ID('000000000df1')}', 'Minus Gas', 'MB', '${ID('0000000005f1')}', -10000, 'ACTIVE', 1, '2026-10-03T08:00:00Z', now());
INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, created_at) VALUES
 ('${ID('0000000e0001')}', '${AG}', 'ADJUSTMENT', 500000, 500000, 'opening:${AG}', '2026-10-01T09:00:00Z'),
 ('${ID('0000000e0002')}', '${MB}', 'CREDIT_TOPUP', 50000, 50000, 'legacy:${ID('0000000e0002')}', '2026-10-03T09:00:00Z'),
 ('${ID('0000000e0003')}', '${MB}', 'DEBIT_ORDER', -60000, -10000, 'legacy:${ID('0000000e0003')}', '2026-10-03T10:00:00Z');
UPDATE ledger_entries SET reason_code = 'OPENING_BALANCE' WHERE id = '${ID('0000000e0001')}';
INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at) VALUES
 ('${SANA}', '${AG}', 'Sana', '+923001234567', '2026-10-04T09:00:00Z', now()),
 ('${SANA_AGAIN}', '${AG}', 'Sana B', '+923001234567', '2026-10-05T09:00:00Z', now());
INSERT INTO payments (id, distributor_id, request_no, amount_paisa, provider, status, verified_by_user_id, created_at, completed_at) VALUES
 ('${FAILED_TOPUP}', '${AG}', 1, 100000, 'BANK_MANUAL', 'FAILED', '${OFFICE}', '2026-10-04T09:00:00Z', '2026-10-04T10:00:00Z');
`;

describeDb('MIG-014 the inc1b contract migration', () => {
  let db: ScratchDb;
  let release: string;

  const migrate = () => runMigrateSh(release, db.url);
  const rollBack = () => {
    const resolved = prisma(['migrate', 'resolve', '--rolled-back', INC1B_MIGRATION, '--schema', releaseSchema(release)], db.url);
    expect({ code: resolved.code, output: resolved.code === 0 ? '' : resolved.output }).toEqual({ code: 0, output: '' });
  };
  /** Nothing of inc1b is applied: the row is failed, the columns nullable, no new constraint or index. */
  const expectNothingApplied = async () => {
    const client = db.client();
    const row = await client.$queryRaw<Array<{ finished: boolean }>>`
      SELECT finished_at IS NOT NULL AS finished FROM _prisma_migrations WHERE migration_name = ${INC1B_MIGRATION} AND rolled_back_at IS NULL`;
    expect(row).toEqual([{ finished: false }]);
    expect(await appliedMigrations(client)).toEqual(['0_baseline', INC1A_MIGRATION]);
    const nullable = await client.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'distributors' AND column_name = 'home_store_id'`;
    expect(nullable).toEqual([{ is_nullable: 'YES' }]);
    expect(
      await client.$queryRaw`SELECT conname FROM pg_constraint WHERE conname IN ('distributors_balance_chk', 'ledger_entries_sign_chk')`,
    ).toEqual([]);
    expect(await client.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname = 'clients_distributor_id_phone_key'`).toEqual([]);
    expect(await client.$queryRaw`SELECT status::text FROM payments WHERE id = ${FAILED_TOPUP}::uuid`).toEqual([{ status: 'FAILED' }]);
  };

  beforeAll(async () => {
    db = await createScratchDb('inc1b');
    const deployed = deployRelease(db, 'inc1a');
    if (deployed.code !== 0) throw new Error(`inc1a deploy failed:\n${deployed.output}`);
    const load = executeSql(db.url, FIXTURE);
    if (load.code !== 0) throw new Error(`fixture failed:\n${load.output}`);
    release = makeRelease('inc1b');
  }, 300_000);

  afterAll(async () => {
    await db?.drop();
    await disconnectAdmin();
    removeScratchRoot();
  });

  it('MIG-014 the pre-checks stop the file in order (store, negative balance, duplicate phones) until all three are fixed', async () => {
    const client = db.client();

    // Step 1: all three problems are there; the first pre-check stops the file, naming the row and the fix.
    const first = migrate();
    expect(first.code).not.toBe(0);
    expect(first.output).toContain(`MIGRATION_BLOCKED inc1b: distributors without a store (NS ${NS}).`);
    expect(first.output).toContain('Give each of them its store');
    expect(first.output).toContain(`run "prisma migrate resolve --rolled-back ${INC1B_MIGRATION}", then deploy again.`);
    expect(first.output).not.toContain('negative balance');
    await expectNothingApplied();

    // Step 2a: give the distributor a store.
    await client.$executeRawUnsafe(`
      INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
      VALUES ('${ID('0000000005e1')}', 'No Store Gas Store', '${ID('0000000000e1')}', 'Canal Rd', ST_SetSRID(ST_MakePoint(74.24, 31.52), 4326), true, now(), now())`);
    await client.$executeRawUnsafe(`UPDATE distributors SET home_store_id = '${ID('0000000005e1')}' WHERE id = '${NS}'`);
    rollBack();
    const second = migrate();
    expect(second.code).not.toBe(0);
    expect(second.output).toContain('MIGRATION_BLOCKED inc1b: distributors with a negative balance (MB -10000 paisa).');
    expect(second.output).toContain('Fix with a super-admin correction');
    expect(second.output).toContain(`--rolled-back ${INC1B_MIGRATION}`);
    await expectNothingApplied();

    // Step 2b: add Rs 100 with a super-admin correction (WalletService.correct's ADD: the guarded
    // balance update and its ADJUSTMENT row, key adjust:<Idempotency-Key>).
    await client.$executeRawUnsafe(`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + 10000 WHERE id = '${MB}'`);
    await client.$executeRawUnsafe(`
      INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, reason_code, note,
                                  created_by_user_id, created_at)
      VALUES (gen_random_uuid(), '${MB}', 'ADJUSTMENT', 10000, 0, 'adjust:${ID('0000000ad001')}', 'SYSTEM_ERROR',
              'Old refill debit taken twice', '${OFFICE}', now())`);
    rollBack();
    const third = migrate();
    expect(third.code).not.toBe(0);
    expect(third.output).toContain(
      `MIGRATION_BLOCKED inc1b: customers of one distributor sharing a phone number (AG +923001234567 (customers ${SANA} ${SANA_AGAIN})).`,
    );
    expect(third.output).toContain('Merge or correct them');
    await expectNothingApplied();

    // Step 2c: merge the two customers (the second one has nothing hanging off it).
    await client.$executeRawUnsafe(`UPDATE orders SET client_id = '${SANA}' WHERE client_id = '${SANA_AGAIN}'`);
    await client.$executeRawUnsafe(`DELETE FROM clients WHERE id = '${SANA_AGAIN}'`);
    rollBack();
    const applied = migrate();
    expect({ code: applied.code, output: applied.code === 0 ? '' : applied.output }).toEqual({ code: 0, output: '' });
    expect(await appliedMigrations(client)).toEqual(['0_baseline', INC1A_MIGRATION, INC1B_MIGRATION]);
  }, 600_000);

  it('MIG-014 once applied, the balance and ledger-sign guards refuse bad rows with 23514 and nothing changes', async () => {
    const client = db.client();
    const before = {
      balance: await client.$queryRaw`SELECT advance_balance_paisa AS b FROM distributors WHERE id = ${AG}::uuid`,
      ledger: await client.$queryRaw`SELECT count(*)::int AS n, sum(amount_paisa)::bigint AS s FROM ledger_entries WHERE distributor_id = ${AG}::uuid`,
    };
    const refusal = async (sql: string): Promise<string> => {
      try {
        await client.$executeRawUnsafe(sql);
      } catch (error) {
        return String((error as Error).message);
      }
      throw new Error(`not refused: ${sql}`);
    };
    const balance = await refusal(`UPDATE distributors SET advance_balance_paisa = -1 WHERE id = '${AG}'`);
    expect(balance).toContain('23514');
    expect(balance).toContain('distributors_balance_chk');
    const ledger = (type: string, amount: number) =>
      refusal(`INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, created_at)
               VALUES (gen_random_uuid(), '${AG}', '${type}', ${amount}, 500000, 'test:${type}:${amount}', now())`);
    for (const [type, amount] of [['DEBIT_ORDER', 100], ['CREDIT_TOPUP', -100], ['ADJUSTMENT', 0]] as const) {
      const message = await ledger(type, amount);
      expect({ type, amount, code: message.includes('23514'), check: message.includes('ledger_entries_sign_chk') }).toEqual({
        type,
        amount,
        code: true,
        check: true,
      });
    }
    // Rows that follow the sign rule still go in (tried in a transaction that is then rolled back).
    const ROLLBACK = new Error('rollback');
    await expect(
      client.$transaction(async (tx) => {
        for (const [type, amount] of [['CREDIT_ORDER_REVERSAL', 100], ['DEBIT_REFILL', -100], ['ADJUSTMENT', -100]] as const) {
          await tx.$executeRawUnsafe(`INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, created_at)
                                      VALUES (gen_random_uuid(), '${AG}', '${type}', ${amount}, 500000, 'test-ok:${type}', now())`);
        }
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    expect(await client.$queryRaw`SELECT advance_balance_paisa AS b FROM distributors WHERE id = ${AG}::uuid`).toEqual(before.balance);
    expect(
      await client.$queryRaw`SELECT count(*)::int AS n, sum(amount_paisa)::bigint AS s FROM ledger_entries WHERE distributor_id = ${AG}::uuid`,
    ).toEqual(before.ledger);
  });

  it('MIG-014 the contract columns are NOT NULL, phones are unique per distributor, and the FAILED manual top-up is REJECTED', async () => {
    const client = db.client();
    const columns = await client.$queryRaw<Array<{ c: string; is_nullable: string }>>`
      SELECT table_name || '.' || column_name AS c, is_nullable FROM information_schema.columns
      WHERE (table_name, column_name) IN (('distributors','home_store_id'), ('distributors','code'), ('ledger_entries','idempotency_key'),
                                          ('expenses','type_id'), ('orders','order_no'), ('payments','request_no'))
      ORDER BY 1`;
    expect(columns).toEqual([
      { c: 'distributors.code', is_nullable: 'NO' },
      { c: 'distributors.home_store_id', is_nullable: 'NO' },
      { c: 'expenses.type_id', is_nullable: 'NO' },
      { c: 'ledger_entries.idempotency_key', is_nullable: 'NO' },
      { c: 'orders.order_no', is_nullable: 'NO' },
      { c: 'payments.request_no', is_nullable: 'NO' },
    ]);
    const duplicate = await (async () => {
      try {
        await client.$executeRawUnsafe(`
          INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at)
          VALUES (gen_random_uuid(), '${AG}', 'Sana again', '+923001234567', now(), now())`);
      } catch (error) {
        return String((error as Error).message);
      }
      return 'inserted';
    })();
    expect(duplicate).toContain('23505');
    expect(duplicate).toContain('Key (distributor_id, phone)');
    // Another distributor may have a customer with the same number.
    await client.$executeRawUnsafe(`
      INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at)
      VALUES (gen_random_uuid(), '${MB}', 'Sana', '+923001234567', now(), now())`);
    expect(await client.$queryRaw`SELECT status::text FROM payments WHERE id = ${FAILED_TOPUP}::uuid`).toEqual([{ status: 'REJECTED' }]);
    expect(await client.$queryRaw`SELECT count(*)::int AS n FROM payments WHERE provider = 'BANK_MANUAL' AND status = 'FAILED'`).toEqual([{ n: 0 }]);
    // Invariant 18: no balance below zero; the wallets still add up.
    const mismatches = await client.$queryRaw`
      SELECT d.id FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    expect(mismatches).toEqual([]);
  });
});
