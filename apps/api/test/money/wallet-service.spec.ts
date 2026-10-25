/**
 * Unit tests for WalletService and the nightly check with fake database clients: how a refused guarded
 * update is reported, what a key already used means, and how the job de-duplicates its alerts. The same
 * behaviours run on PostgreSQL in wallet-service.e2e-spec.ts and wallet-check.e2e-spec.ts.
 */
import { Logger } from '@nestjs/common';
import type { LedgerEntry } from '@prisma/client';
import { systemActor } from '../../src/common/auth/actor';
import { AppError } from '../../src/common/errors/app-error';
import type { AlertsService } from '../../src/modules/alerts/alerts.service';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service';
import type { SettingsService } from '../../src/modules/settings/settings.service';
import { WalletCheckJob } from '../../src/modules/wallet/wallet-check.job';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import type { WalletCheck, WalletTx } from '../../src/modules/wallet/wallet.types';
import type { PrismaService } from '../../src/prisma/prisma.service';

const DISTRIBUTOR = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const actor = systemActor('job:unit-test');

async function refusal(work: Promise<unknown>): Promise<AppError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** A fake transaction client: raw UPDATEs answer `updated`, reads answer `distributor`. */
function fakeTx(state: { updated: Array<{ balance: bigint }>; distributor: { status: string; advanceBalancePaisa: bigint } | null; existing?: Partial<LedgerEntry> | null }) {
  const raw = jest.fn(async (strings: TemplateStringsArray): Promise<unknown[]> => {
    const sql = strings.join('?');
    if (sql.includes('UPDATE distributors')) return state.updated;
    if (sql.includes('INSERT INTO ledger_entries')) return [{ id: 'new-entry', amountPaisa: 0n }];
    return [];
  });
  return {
    tx: {
      $queryRaw: raw,
      ledgerEntry: { findUnique: jest.fn(async () => state.existing ?? null) },
      distributor: { findUnique: jest.fn(async () => state.distributor) },
      payment: { findFirst: jest.fn(async () => null) },
      order: { findFirst: jest.fn(async () => null) },
    } as unknown as WalletTx,
    raw,
  };
}

function service(audit: Partial<AuditLogService> = { record: jest.fn(async () => undefined) }) {
  return new WalletService({} as PrismaService, {} as SettingsService, audit as AuditLogService);
}

describe('WalletService.debit refusals', () => {
  const debit = (wallet: WalletService, tx: WalletTx, amountPaisa: bigint) =>
    wallet.debit(tx, { distributorId: DISTRIBUTOR, subject: { type: 'ORDER', orderId: ORDER }, amountPaisa, actor });

  it('FEE-004 a guarded update refused only by status gives DISTRIBUTOR_NOT_ACTIVE, not WALLET_INSUFFICIENT_BALANCE', async () => {
    const { tx } = fakeTx({ updated: [], distributor: { status: 'SUSPENDED', advanceBalancePaisa: 500_000n } });
    const error = await refusal(debit(service(), tx, 48_000n));
    expect(error.code).toBe('DISTRIBUTOR_NOT_ACTIVE');
  });

  it('WALLET_INSUFFICIENT_BALANCE says how much is needed, held and missing, as digit strings', async () => {
    const { tx } = fakeTx({ updated: [], distributor: { status: 'ACTIVE', advanceBalancePaisa: 30_000n } });
    const error = await refusal(debit(service(), tx, 33_000n));
    expect([error.code, error.details, error.getStatus()]).toEqual([
      'WALLET_INSUFFICIENT_BALANCE',
      { requiredPaisa: '33000', balancePaisa: '30000', shortByPaisa: '3000' },
      409,
    ]);
    expect(error.message).toBe('Not enough balance. This needs Rs 330 and you have Rs 300. Add money to continue.');
  });

  it('REV money-data-03 a legacy balance below zero is reported as it is, and the shortfall counts it', async () => {
    // Bilal Gas at -Rs 300 places a Rs 300 order: it needs Rs 600 more, as the quote says.
    const { tx } = fakeTx({ updated: [], distributor: { status: 'ACTIVE', advanceBalancePaisa: -30_000n } });
    const error = await refusal(debit(service(), tx, 30_000n));
    expect([error.code, error.details]).toEqual([
      'WALLET_INSUFFICIENT_BALANCE',
      { requiredPaisa: '30000', balancePaisa: '-30000', shortByPaisa: '60000' },
    ]);
    expect(error.message).toBe('Not enough balance. This needs Rs 300 and you have −Rs 300. Add money to continue.');
  });

  it('a refusal that was out of date (money just arrived) is tried once more', async () => {
    const state = { updated: [] as Array<{ balance: bigint }>, distributor: { status: 'ACTIVE', advanceBalancePaisa: 100_000n } };
    const { tx, raw } = fakeTx(state);
    let attempts = 0;
    raw.mockImplementation(async (strings: TemplateStringsArray): Promise<unknown[]> => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE distributors')) return ++attempts === 1 ? [] : [{ balance: 52_000n }];
      if (sql.includes('INSERT INTO ledger_entries')) return [{ id: 'new-entry' }];
      return [];
    });
    await expect(debit(service(), tx, 48_000n)).resolves.toEqual({ id: 'new-entry' });
    expect(attempts).toBe(2);
  });

  it('a cost of 0 writes nothing and asks nothing', async () => {
    const { tx, raw } = fakeTx({ updated: [], distributor: null });
    await expect(debit(service(), tx, 0n)).resolves.toBeNull();
    expect(raw).not.toHaveBeenCalled();
  });

  it('a REFILL subject is refused while refill.deliveryCost is off', async () => {
    const { tx } = fakeTx({ updated: [], distributor: null });
    const error = await refusal(
      service().debit(tx, { distributorId: DISTRIBUTOR, subject: { type: 'REFILL', fillingOrderId: ORDER }, amountPaisa: 100n, actor }),
    );
    expect([error.code, error.details]).toEqual(['INTERNAL_ERROR', { reason: 'REFILL_DELIVERY_COST_OFF' }]);
  });

  it('a key already used for other money is a server bug, never a second debit', async () => {
    const { tx, raw } = fakeTx({
      updated: [],
      distributor: null,
      existing: { distributorId: DISTRIBUTOR, amountPaisa: -10_000n, entryType: 'DEBIT_ORDER' as const },
    });
    expect((await refusal(debit(service(), tx, 48_000n))).code).toBe('INTERNAL_ERROR');
    expect(raw).not.toHaveBeenCalled();
  });
});

describe('WalletService.applyCorrection replays', () => {
  const params = {
    distributorId: DISTRIBUTOR,
    direction: 'TAKE' as const,
    amountPaisa: 33_000n,
    reasonCode: 'SYSTEM_ERROR' as const,
    note: 'Retry check correction',
    requestKey: '33333333-3333-4333-8333-333333333333',
    actor,
  };
  const stored = { distributorId: DISTRIBUTOR, entryType: 'ADJUSTMENT' as const, amountPaisa: -33_000n, reasonCode: 'SYSTEM_ERROR', note: 'Retry check correction', paymentId: null, orderId: null };

  it('WAL-013 the same key and body return the first entry and write nothing', async () => {
    const { tx, raw } = fakeTx({ updated: [], distributor: null, existing: stored });
    const record = jest.fn(async () => undefined);
    const outcome = await service({ record }).applyCorrection(tx, params);
    expect(outcome.replayed).toBe(true);
    expect(raw).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('WAL-013 the same key with any other detail is IDEMPOTENCY_CONFLICT', async () => {
    for (const change of [{ amountPaisa: 50_000n }, { direction: 'ADD' as const }, { note: 'Another note entirely' }, { distributorId: '44444444-4444-4444-8444-444444444444' }]) {
      const { tx } = fakeTx({ updated: [], distributor: null, existing: stored });
      expect((await refusal(service().applyCorrection(tx, { ...params, ...change }))).code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  it('WAL-011 a TAKE the balance does not cover is WALLET_ADJUST_EXCEEDS_BALANCE with the balance', async () => {
    const { tx } = fakeTx({ updated: [], distributor: { status: 'SUSPENDED', advanceBalancePaisa: 20_000n } });
    const error = await refusal(service().applyCorrection(tx, params));
    expect([error.code, error.details]).toEqual(['WALLET_ADJUST_EXCEEDS_BALANCE', { balancePaisa: '20000' }]);
  });
});

describe('WalletCheckJob', () => {
  const OTHER = '55555555-5555-4555-8555-555555555555';
  const checks: WalletCheck[] = [
    { distributorId: DISTRIBUTOR, balancePaisa: 512_000n, ledgerSumPaisa: 500_000n, ok: false },
    { distributorId: OTHER, balancePaisa: 90_000n, ledgerSumPaisa: 100_000n, ok: false },
    { distributorId: '66666666-6666-4666-8666-666666666666', balancePaisa: 0n, ledgerSumPaisa: 0n, ok: true },
  ];

  function job(unresolvedFor: string[], raisedMeanwhileFor: string[] = []) {
    const order: string[] = [];
    // [review23 robustness-jobs-07] Each raise runs in its own transaction, under the distributor's lock,
    // after reading that distributor's unresolved alerts again.
    const tx = {
      $executeRaw: jest.fn(async (..._args: unknown[]) => 1),
      alert: {
        count: jest.fn(async (args: { where: { resourceId: string } }) => (raisedMeanwhileFor.includes(args.where.resourceId) ? 1 : 0)),
      },
    };
    const prisma = {
      alert: { findMany: jest.fn(async () => unresolvedFor.map((resourceId) => ({ resourceId }))) },
      distributor: { findMany: jest.fn(async () => [{ id: DISTRIBUTOR, businessName: 'Ahmed Gas' }, { id: OTHER, businessName: 'Bilal Gas' }]) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const alerts = { raise: jest.fn(async () => order.push('alert')) };
    const audit = { record: jest.fn(async () => order.push('audit')) };
    const wallet = { verify: jest.fn(async () => checks) };
    const instance = new WalletCheckJob(
      prisma as unknown as PrismaService,
      wallet as unknown as WalletService,
      alerts as unknown as AlertsService,
      audit as unknown as AuditLogService,
    );
    return { instance, prisma, alerts, audit, order, tx };
  }

  it('G01-05 raises one CRITICAL alert per broken wallet with the signed difference, skipping wallets already alerted', async () => {
    const { instance, alerts, prisma, tx } = job([OTHER]);
    const run = await instance.run();
    expect(run).toEqual({ checked: 3, mismatches: 2, distributorIds: [DISTRIBUTOR, OTHER], raised: 1 });
    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['OPEN', 'ACKNOWLEDGED'] } }) }),
    );
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        alertType: 'WALLET_CHECK_MISMATCH',
        severity: 'CRITICAL',
        resourceType: 'Distributor',
        resourceId: DISTRIBUTOR,
        context: { balancePaisa: '512000', ledgerSumPaisa: '500000', differencePaisa: '12000' },
      }),
      tx,
    );
    const raised = (alerts.raise.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(raised).not.toHaveProperty('dedupeKey');
  });

  it("REV23 robustness-jobs-07 each raise re-reads the unresolved alert under the distributor's advisory lock, so a second run raises nothing", async () => {
    // A run at the same moment raised Ahmed Gas's alert after this run's first read.
    const { instance, alerts, tx, prisma } = job([], [DISTRIBUTOR]);
    const run = await instance.run();
    expect(run).toEqual({ checked: 3, mismatches: 2, distributorIds: [DISTRIBUTOR, OTHER], raised: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const locks = tx.$executeRaw.mock.calls.map((call) => (call as unknown[]).slice(1));
    expect(locks).toEqual([[`wallet-check:${DISTRIBUTOR}`], [`wallet-check:${OTHER}`]]);
    expect(tx.alert.count).toHaveBeenCalledWith({
      where: { alertType: 'WALLET_CHECK_MISMATCH', resourceType: 'Distributor', resourceId: DISTRIBUTOR, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    });
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ resourceId: OTHER }), tx);
  });

  it('G12-05 every run writes one wallet.check audit row, after raising its alerts', async () => {
    const { instance, audit, order } = job([]);
    await instance.run();
    expect(order).toEqual(['alert', 'alert', 'audit']);
    expect(audit.record).toHaveBeenCalledWith({
      action: 'wallet.check',
      actor: { kind: 'SYSTEM', label: 'job:wallet-check' },
      resourceType: 'job',
      diff: { checked: 3, mismatches: 2, distributorIds: [DISTRIBUTOR, OTHER] },
    });
  });

  it('a failed alert still leaves the audit row, and the scheduled handler never throws', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { instance, alerts, audit } = job([]);
    alerts.raise.mockRejectedValue(new Error('alerts table busy'));
    const run = await instance.run();
    expect(run.raised).toBe(0);
    expect(audit.record).toHaveBeenCalledTimes(1);
    audit.record.mockRejectedValue(new Error('audit down'));
    await expect(instance.nightly()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
