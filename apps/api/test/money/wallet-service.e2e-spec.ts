/**
 * WalletService on the database (API_CONTRACT §5.4, DATA_MODEL §3.6): guarded single-statement balance
 * updates, signed ledger rows with deterministic keys, and the invariant balance = Σ ledger ≥ 0, also
 * under parallel writes. These call the service directly, so they don't wait on the orders lane.
 */
import type { INestApplication } from '@nestjs/common';
import { DistributorStatus } from '@prisma/client';
import { systemActor, type Actor } from '../../src/common/auth/actor';
import { AppError } from '../../src/common/errors/app-error';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { walletKeys } from '../../src/modules/wallet/wallet.types';
import { createTestApp } from '../helpers/app';
import { getTestPrisma, resetDb, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createClient, createDistributor, createUser, type TestClient, type TestDistributor } from '../helpers/factories';
import { balanceOf, expectRunningBalances, insertOrder, key, ledgerOf } from './money-fixtures';

async function refusal(work: Promise<unknown>): Promise<AppError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describeDb('money: WalletService on the database', () => {
  let app: INestApplication;
  let wallet: WalletService;
  const db = () => getTestPrisma();
  const actor: Actor = systemActor('job:money-test');

  beforeAll(async () => {
    app = await createTestApp();
    wallet = app.get(WalletService);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function shop(balancePaisa: bigint, status: DistributorStatus = DistributorStatus.ACTIVE) {
    const distributor = await createDistributor({ balancePaisa, status });
    const client = await createClient({ distributor });
    return { distributor, client };
  }

  function order(distributor: TestDistributor, client: TestClient) {
    return insertOrder({ distributor, client, zoneId: distributor.zone.id });
  }

  function debit(distributorId: string, orderId: string, amountPaisa: bigint) {
    return db().$transaction((tx) => wallet.debit(tx, { distributorId, subject: { type: 'ORDER', orderId }, amountPaisa, actor }));
  }

  function reverse(orderId: string) {
    return db().$transaction((tx) => wallet.reverse(tx, { subject: { type: 'ORDER', orderId }, actor, reason: 'Cancelled before delivery started' }));
  }

  it('api-money acceptance: a Rs 330 debit on a Rs 300 balance is WALLET_INSUFFICIENT_BALANCE with exact details and writes nothing', async () => {
    const { distributor, client } = await shop(30_000n);
    const o = await order(distributor, client);
    const rowsBefore = await db().ledgerEntry.count();

    const error = await refusal(debit(distributor.id, o.id, 33_000n));
    expect(error.code).toBe('WALLET_INSUFFICIENT_BALANCE');
    expect(error.details).toEqual({ requiredPaisa: '33000', balancePaisa: '30000', shortByPaisa: '3000' });
    expect(error.getStatus()).toBe(409);
    expect(await db().ledgerEntry.count()).toBe(rowsBefore);
    expect(await balanceOf(distributor.id)).toBe(30_000n);
  });

  it('api-money acceptance: a debit then two reversals write exactly one CREDIT_ORDER_REVERSAL and return the cost once', async () => {
    const { distributor, client } = await shop(500_000n);
    const o = await order(distributor, client);

    const taken = await debit(distributor.id, o.id, 48_000n);
    expect(taken).toMatchObject({ entryType: 'DEBIT_ORDER', amountPaisa: -48_000n, balanceAfterPaisa: 452_000n, orderId: o.id });
    expect(taken?.idempotencyKey).toBe(walletKeys.orderDebit(o.id));

    const first = await reverse(o.id);
    const second = await reverse(o.id);
    expect(first).toMatchObject({ entryType: 'CREDIT_ORDER_REVERSAL', amountPaisa: 48_000n, balanceAfterPaisa: 500_000n });
    expect(first?.idempotencyKey).toBe(walletKeys.orderReversal(o.id));
    expect(second?.id).toBe(first?.id);
    expect(await db().ledgerEntry.count({ where: { orderId: o.id, entryType: 'CREDIT_ORDER_REVERSAL' } })).toBe(1);
    expect(await balanceOf(distributor.id)).toBe(500_000n);
    await expectRunningBalances(distributor.id);
  });

  it('debit idempotency: a second debit for the same order returns the first row and moves nothing', async () => {
    const { distributor, client } = await shop(100_000n);
    const o = await order(distributor, client);
    const first = await debit(distributor.id, o.id, 40_000n);
    const again = await debit(distributor.id, o.id, 40_000n);
    expect(again?.id).toBe(first?.id);
    expect(await db().ledgerEntry.count({ where: { orderId: o.id } })).toBe(1);
    expect(await balanceOf(distributor.id)).toBe(60_000n);
  });

  it('a zero delivery cost writes no ledger row', async () => {
    const { distributor, client } = await shop(100_000n);
    const o = await order(distributor, client);
    expect(await debit(distributor.id, o.id, 0n)).toBeNull();
    expect(await db().ledgerEntry.count({ where: { orderId: o.id } })).toBe(0);
    expect(await reverse(o.id)).toBeNull();
    expect(await balanceOf(distributor.id)).toBe(100_000n);
  });

  it('FEE-004 a guarded debit refused only by status gives DISTRIBUTOR_NOT_ACTIVE, not WALLET_INSUFFICIENT_BALANCE', async () => {
    for (const status of [DistributorStatus.SUSPENDED, DistributorStatus.PENDING]) {
      await resetDb();
      const { distributor, client } = await shop(500_000n, status);
      const o = await order(distributor, client);
      const covered = await refusal(debit(distributor.id, o.id, 48_000n));
      expect({ status, code: covered.code }).toEqual({ status, code: 'DISTRIBUTOR_NOT_ACTIVE' });
      // Not active and short of money: still the status.
      const short = await refusal(debit(distributor.id, o.id, 900_000n));
      expect({ status, code: short.code }).toEqual({ status, code: 'DISTRIBUTOR_NOT_ACTIVE' });
      expect(await db().ledgerEntry.count({ where: { orderId: o.id } })).toBe(0);
      expect(await balanceOf(distributor.id)).toBe(500_000n);
    }
  }, 180_000);

  it('REFILL subjects are refused while refill.deliveryCost is off', async () => {
    const { distributor } = await shop(500_000n);
    const error = await refusal(
      db().$transaction((tx) =>
        wallet.debit(tx, { distributorId: distributor.id, subject: { type: 'REFILL', fillingOrderId: key('b', 1) }, amountPaisa: 10_000n, actor }),
      ),
    );
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(await balanceOf(distributor.id)).toBe(500_000n);
  });

  it('G04-03 reverse finds the debit by key order:<id>:debit and returns null for an order the old code charged', async () => {
    const { distributor, client } = await shop(0n);
    const o = await order(distributor, client);
    // The old code's debit: a DEBIT_ORDER row with a legacy key, and the balance it left.
    await db().$transaction([
      db().ledgerEntry.create({
        data: {
          distributorId: distributor.id,
          entryType: 'ADJUSTMENT',
          amountPaisa: 100_000n,
          balanceAfterPaisa: 100_000n,
          idempotencyKey: `opening:${distributor.id}`,
          reasonCode: 'OPENING_BALANCE',
        },
      }),
      db().ledgerEntry.create({
        data: {
          distributorId: distributor.id,
          entryType: 'DEBIT_ORDER',
          amountPaisa: -30_000n,
          balanceAfterPaisa: 70_000n,
          orderId: o.id,
          idempotencyKey: `legacy:${key('c', 1)}`,
        },
      }),
      db().distributor.update({ where: { id: distributor.id }, data: { advanceBalancePaisa: 70_000n } }),
    ]);
    expect(await reverse(o.id)).toBeNull();
    expect(await balanceOf(distributor.id)).toBe(70_000n);
    expect(await db().ledgerEntry.count({ where: { orderId: o.id } })).toBe(1);
  });

  it('parallel debits never overspend: with money for three, exactly three of ten are taken', async () => {
    const { distributor, client } = await shop(100_000n);
    const orders = await Promise.all(Array.from({ length: 10 }, () => order(distributor, client)));
    const results = await Promise.allSettled(orders.map((o) => debit(distributor.id, o.id, 30_000n)));
    const taken = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(taken).toHaveLength(3);
    expect(refused).toHaveLength(7);
    for (const r of refused) expect((r.reason as AppError).code).toBe('WALLET_INSUFFICIENT_BALANCE');
    expect(await balanceOf(distributor.id)).toBe(10_000n);
    expect(await db().ledgerEntry.count({ where: { distributorId: distributor.id, entryType: 'DEBIT_ORDER' } })).toBe(3);
    await expectRunningBalances(distributor.id);
    expect(await walletMismatches()).toEqual([]);
  }, 180_000);

  it('creditTopup credits once per payment, whatever the distributor status', async () => {
    const { distributor } = await shop(0n, DistributorStatus.SUSPENDED);
    const payment = await db().payment.create({
      data: { distributorId: distributor.id, amountPaisa: 200_000n, provider: 'BANK_MANUAL', status: 'PENDING', requestNo: 1 },
    });
    const credit = () =>
      db().$transaction((tx) => wallet.creditTopup(tx, { distributorId: distributor.id, paymentId: payment.id, amountPaisa: 200_000n, actor }));
    const [a, b] = await Promise.allSettled([credit(), credit()]);
    const done = [a, b].filter((r) => r.status === 'fulfilled');
    expect(done.length).toBeGreaterThanOrEqual(1);
    expect(await credit()).toMatchObject({ entryType: 'CREDIT_TOPUP', amountPaisa: 200_000n, paymentId: payment.id });
    expect(await db().ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await balanceOf(distributor.id)).toBe(200_000n);
    await expectRunningBalances(distributor.id);
  });

  it('a correction can never take the balance below zero, even when two run at once', async () => {
    const owner = await createUser({ name: 'Owner' });
    const { distributor } = await shop(500_000n);
    const take = (n: number) =>
      db().$transaction((tx) =>
        wallet.correct(tx, {
          distributorId: distributor.id,
          direction: 'TAKE',
          amountPaisa: 300_000n,
          reasonCode: 'BANK_REVERSAL',
          note: `Parallel service take ${n}`,
          requestKey: key('d', n),
          actor: { kind: 'USER', userId: owner.id, role: owner.role },
        }),
      );
    const results = await Promise.allSettled([take(1), take(2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect((refused?.reason as AppError).code).toBe('WALLET_ADJUST_EXCEEDS_BALANCE');
    expect((refused?.reason as AppError).details).toEqual({ balancePaisa: '200000' });
    expect(await balanceOf(distributor.id)).toBe(200_000n);
    await expectRunningBalances(distributor.id);
  });

  it('verify reports each wallet, with the signed difference behind a mismatch', async () => {
    const { distributor: clean } = await shop(500_000n);
    const { distributor: broken } = await shop(100_000n);
    await db().distributor.update({ where: { id: broken.id }, data: { advanceBalancePaisa: 112_000n } });
    const all = await wallet.verify();
    expect(all.find((c) => c.distributorId === clean.id)).toEqual({
      distributorId: clean.id,
      balancePaisa: 500_000n,
      ledgerSumPaisa: 500_000n,
      ok: true,
    });
    expect(await wallet.verify(broken.id)).toEqual([
      { distributorId: broken.id, balancePaisa: 112_000n, ledgerSumPaisa: 100_000n, ok: false },
    ]);
    expect(await wallet.verify(key('e', 1))).toEqual([]);
  });

  it('ledger rows are ordered as the balance moved, even when the transactions started in another order', async () => {
    const { distributor, client } = await shop(1_000_000n);
    const orders = await Promise.all(Array.from({ length: 6 }, () => order(distributor, client)));
    // A transaction that starts first but moves money last must still sort last.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let begun!: () => void;
    const started = new Promise<void>((resolve) => (begun = resolve));
    const slow = db().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        begun();
        await gate;
        return wallet.debit(tx, { distributorId: distributor.id, subject: { type: 'ORDER', orderId: orders[0].id }, amountPaisa: 10_000n, actor });
      },
      { timeout: 60_000 },
    );
    await started;
    await Promise.all(orders.slice(1).map((o) => debit(distributor.id, o.id, 10_000n)));
    release();
    await slow;
    const rows = await ledgerOf(distributor.id);
    expect(rows[rows.length - 1].orderId).toBe(orders[0].id);
    for (let i = 1; i < rows.length; i++) expect(rows[i].createdAt.getTime()).toBeGreaterThan(rows[i - 1].createdAt.getTime());
    await expectRunningBalances(distributor.id);
  });
});
