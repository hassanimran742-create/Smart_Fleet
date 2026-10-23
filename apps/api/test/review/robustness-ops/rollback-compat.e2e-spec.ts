/**
 * Review (robustness and operations), robustness-ops-01: DATA_MODEL §2.6 said "Code rollback: redeploy the
 * previous image. Expand/contract keeps it compatible one release back." The previous release is the
 * baseline release, whose code (af889bf) has the pre-inc1a schema.prisma. This suite writes rows with the
 * Inc 1 API, then reads them with a Prisma client generated from the pre-inc1a schema (what the rolled-back
 * API runs), using the same reads the old code does for the installed apps (payments/mine, ledger/me) and
 * the office.
 *
 * Those reads fail, and no previous release can avoid it: a read-compatible one would need a schema.prisma
 * that no longer matches the database, which migrate.sh's drift check and CI refuse. So the fix is the
 * rollback rule (DATA_MODEL §1 rule 6, §2.6): after inc1a, a rollback is a forward fix or a restore of the
 * pre-deploy snapshot, and deploy.sh takes that snapshot on prod, and waits for it, before migrating. This
 * suite pins down the incompatibility that makes the snapshot mandatory (if the old reads ever work again,
 * the rule may relax) and checks that the prod deploy takes the snapshot first.
 *
 * The old client is generated outside the repo, once:
 *   git show HEAD:apps/api/prisma/schema.prisma > <dir>/schema.prisma   (binaryTargets ["native"], output "./old-client")
 *   npx prisma generate --schema <dir>/schema.prisma
 * and passed as OLD_PRISMA_CLIENT=<dir>/old-client. Without it the suite skips.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { authHeader, createStandardData, describeDb, getTestPrisma, x1OrderBody, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';
import { setCompanyAccount } from '../../money/money-fixtures';
import { WalletCheckJob } from '../../../src/modules/wallet/wallet-check.job';

const OLD_CLIENT =
  process.env.OLD_PRISMA_CLIENT ??
  'C:/Users/Experts/AppData/Local/Temp/claude/d--smart-fleet/57654f05-d43e-46ff-b258-2d1d56cada85/scratchpad/review/robustness-ops/oldprisma/old-client';
const haveOldClient = fs.existsSync(`${OLD_CLIENT}/index.js`);
const describeRollback = haveOldClient ? describeDb : describe.skip;

interface OldPrisma {
  payment: { findMany(args: unknown): Promise<unknown[]> };
  ledgerEntry: { findMany(args: unknown): Promise<unknown[]> };
  auditLog: { findMany(args: unknown): Promise<unknown[]> };
  expense: { findMany(args: unknown): Promise<unknown[]> };
  $disconnect(): Promise<void>;
}

async function failureOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return String((error as Error).message).split('\n').filter(Boolean).slice(-1)[0];
  }
}

let n = 0;
const key = () => `dddddddd-dddd-4ddd-8ddd-${String(++n).padStart(12, '0')}`;

describeRollback('review robustness: rolling back to the previous release after Inc 1 has run', () => {
  let app: INestApplication;
  let std: StandardData;
  let old: OldPrisma;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
    await setCompanyAccount(app);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require(OLD_CLIENT) as { PrismaClient: new (o: unknown) => OldPrisma };
    old = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  }, 120_000);

  afterAll(async () => {
    await old?.$disconnect();
    await app.close();
  });

  it('REV robustness-ops-01 right after inc1a is applied, with no Inc 1 traffic yet, the old code can no longer read a shop\'s old top-ups', async () => {
    const db = getTestPrisma();
    // A top-up as the old API stored it (BANK_MANUAL with its own id as the placeholder provider_txn_id).
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payments (id, distributor_id, provider, provider_txn_id, amount_paisa, status, created_at)
      VALUES (gen_random_uuid(), ${std.DB.id}::uuid, 'BANK_MANUAL', 'placeholder', 100000, 'SUCCESS', now())
      RETURNING id`;
    await db.$executeRaw`UPDATE payments SET provider_txn_id = id::text WHERE id = ${rows[0].id}::uuid`;
    // inc1a backfill 3.5, verbatim (prisma/migrations/20261021195005_inc1a_foundations/migration.sql:421-422).
    await db.$executeRawUnsafe(`UPDATE payments SET provider_txn_id = NULL
      WHERE provider_txn_id = '' OR (provider = 'BANK_MANUAL' AND provider_txn_id = id::text)`);

    const failure = await failureOf(() => old.payment.findMany({ where: { distributorId: std.DB.id }, orderBy: { createdAt: 'desc' }, take: 100 }));
    // eslint-disable-next-line no-console
    console.log(`[rollback] old GET /payments/mine right after the migration: ${failure}`);
    // The migration itself writes what the old code can't read: redeploying the old image is not a rollback.
    expect(failure).toMatch(/"providerTxnId" of expected non-nullable type "String", found incompatible value of "null"/);
  });

  it('REV robustness-ops-01 the old code can no longer read the shop wallet, top-ups, activity or expenses once Inc 1 wrote one ordinary day', async () => {
    const api = http(app);
    const DA = authHeader(std.DA.actor);
    const SA = authHeader(std.SA1.actor);

    // An ordinary pilot day with the new API.
    const t1 = await api.post('/api/v1/payments/topup-requests').set(DA).set('Idempotency-Key', key())
      .send({ amountPaisa: 100000, payerName: 'Ahmed', payerChannel: 'BANK_APP' });
    expect(t1.status).toBe(201);
    const t2 = await api.post('/api/v1/payments/topup-requests').set(DA).set('Idempotency-Key', key())
      .send({ amountPaisa: 200000, payerName: 'Ahmed', payerChannel: 'BANK_APP' });
    expect(t2.status).toBe(201);
    expect((await api.post(`/api/v1/payments/${t2.body.id}/reject`).set(SA).send({ reasonCode: 'NOT_IN_BANK' })).status).toBe(200);
    const order = await api.post('/api/v1/orders').set(DA).set('Idempotency-Key', key()).send(x1OrderBody(std));
    expect(order.status).toBe(201);
    const cancel = await api.post(`/api/v1/orders/${order.body.id}/cancel`).set(DA).set('Idempotency-Key', key())
      .send({ reasonCode: 'WRONG_ORDER' });
    expect(cancel.status).toBe(200);
    const petrol = await getTestPrisma().expenseType.findFirstOrThrow({ where: { code: 'PETROL' } });
    expect((await api.post('/api/v1/expenses').set(SA).set('Idempotency-Key', key())
      .send({ expenseDate: '2026-10-01', amountPaisa: 50000, typeId: petrol.id, description: 'Fuel' })).status).toBe(201);
    await app.get(WalletCheckJob).run();

    // What the rolled-back API reads (af889bf): the shop app's top-up list and wallet history, the office
    // lists. Each is a plain findMany on the model.
    const failures = {
      'GET /payments/mine (installed shop app)': await failureOf(() =>
        old.payment.findMany({ where: { distributorId: std.DA.id }, orderBy: { createdAt: 'desc' } })),
      'GET /ledger/me (installed shop app)': await failureOf(() =>
        old.ledgerEntry.findMany({ where: { distributorId: std.DA.id }, orderBy: { createdAt: 'desc' }, take: 100 })),
      'GET /audit-logs (office)': await failureOf(() => old.auditLog.findMany({ take: 200 })),
      'GET /expenses (office)': await failureOf(() => old.expense.findMany({})),
    };
    // eslint-disable-next-line no-console
    console.log('[rollback] old-code reads after one Inc 1 day:\n' + JSON.stringify(failures, null, 2));

    // Every one of these throws in the old code, so a rollback past inc1a is a restore of the snapshot.
    expect(failures).toEqual({
      'GET /payments/mine (installed shop app)': expect.stringMatching(/"providerTxnId" of expected non-nullable type "String", found incompatible value of "null"/),
      'GET /ledger/me (installed shop app)': expect.stringMatching(/Value 'CREDIT_ORDER_REVERSAL' not found in enum 'LedgerEntryType'/),
      'GET /audit-logs (office)': expect.stringMatching(/"actorUserId" of expected non-nullable type "String", found incompatible value of "null"/),
      'GET /expenses (office)': expect.stringMatching(/non-enum-compatible value 'null' for enum 'ExpenseCategory'/),
    });
  });

  it('REV robustness-ops-01 so a prod deploy takes the database snapshot, and waits for it, before it migrates', () => {
    const deploy = fs.readFileSync(path.resolve(__dirname, '../../../../../infrastructure/aws/deploy.sh'), 'utf8');
    const at = (pattern: RegExp) => pattern.exec(deploy)?.index ?? -1;
    const prodOnly = at(/if \[ "\$ENV" = prod \]; then/);
    const snapshot = at(/aws rds create-db-snapshot/);
    const waited = at(/aws rds wait db-snapshot-available/);
    const migrate = at(/sh prisma\/scripts\/migrate\.sh/);
    expect([prodOnly, snapshot, waited, migrate].every((index) => index > 0)).toBe(true);
    expect(prodOnly < snapshot && snapshot < waited && waited < migrate).toBe(true);
    // Without a configured instance there is no snapshot, so there is no prod deploy.
    expect(deploy).toMatch(/if \[ -z "\$\{RDS_INSTANCE_ID:-\}" \]; then[\s\S]*?exit 1/);
  });
});
