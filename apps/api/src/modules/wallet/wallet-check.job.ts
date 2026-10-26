import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlertSeverity, AlertStatus, AlertType, type Prisma } from '@prisma/client';
import { formatRs } from '@smartfleet/shared-utils';
import { systemActor } from '../../common/auth/actor';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { WalletCheck } from './wallet.types';
import { WalletService } from './wallet.service';

/** The job's name in the scheduler registry (API_CONTRACT §8.5). */
export const WALLET_CHECK_JOB = 'wallet-nightly-check';
/** Who the job's audit rows and alerts are by. */
export const WALLET_CHECK_ACTOR_LABEL = 'job:wallet-check';
/** Alerts point at the distributor whose wallet broke. */
const ALERT_RESOURCE_TYPE = 'Distributor';

/** One run's result, also written as the `wallet.check` audit row. */
export interface WalletCheckRun {
  checked: number;
  mismatches: number;
  distributorIds: string[];
  /** Alerts raised by this run (0 while every broken wallet already has an unresolved one). */
  raised: number;
}

/**
 * The nightly wallet check (API_CONTRACT §8.5, DATA_MODEL §3.6), at 03:30 Pakistan time. For every
 * distributor the ledger sum must equal the balance and the balance must be at least 0. Each break
 * raises WALLET_CHECK_MISMATCH (CRITICAL) with `{balancePaisa, ledgerSumPaisa, differencePaisa}`,
 * where the difference is balance minus ledger sum, signed (G01-05).
 *
 * - At most one unresolved alert per distributor: while one is OPEN or ACKNOWLEDGED the job raises
 *   nothing new and leaves it as it is. (AlertsService's own dedupe looks at OPEN only and rewrites the
 *   alert's context, so the job checks for itself and raises without it.) The check and the raise run in
 *   one transaction under a per-distributor advisory lock, so two runs at once (two instances while a
 *   deploy overlaps 03:30, or an engineer's run during the cron) still leave one alert (review23
 *   robustness-jobs-07).
 * - It never changes a balance or a ledger row, and never resolves an alert.
 * - Every run, clean or not, then writes one `wallet.check` audit row (G12-05), so a clean night shows
 *   in Activity.
 */
@Injectable()
export class WalletCheckJob {
  private readonly logger = new Logger(WalletCheckJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditLogService,
  ) {}

  @Cron('30 3 * * *', { name: 'wallet-nightly-check', timeZone: 'Asia/Karachi' })
  async nightly(): Promise<void> {
    try {
      const run = await this.run();
      if (run.mismatches > 0) {
        this.logger.error(`Wallet check: ${run.mismatches} of ${run.checked} wallets don't match their history`);
      }
    } catch (error) {
      this.logger.error(`Wallet check failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  /** One run of the check; the scheduled handler calls it, and tests and engineers may call it directly. */
  async run(): Promise<WalletCheckRun> {
    const checks = await this.wallet.verify();
    const broken = checks.filter((check) => !check.ok);
    const distributorIds = broken.map((check) => check.distributorId);

    let raised = 0;
    if (broken.length > 0) {
      const unresolved = await this.prisma.alert.findMany({
        where: {
          alertType: AlertType.WALLET_CHECK_MISMATCH,
          resourceType: ALERT_RESOURCE_TYPE,
          resourceId: { in: distributorIds },
          status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] },
        },
        select: { resourceId: true },
      });
      const covered = new Set(unresolved.map((alert) => alert.resourceId));
      const names = await this.businessNames(distributorIds);
      for (const check of broken) {
        if (covered.has(check.distributorId)) continue;
        try {
          if (await this.raiseOnce(check, names.get(check.distributorId) ?? null)) raised += 1;
        } catch (error) {
          // The audit row below still records the mismatch; the next night tries the alert again.
          this.logger.error(`Wallet check: could not raise the alert for ${check.distributorId}: ${(error as Error).message}`);
        }
      }
    }

    await this.audit.record({
      action: 'wallet.check',
      actor: systemActor(WALLET_CHECK_ACTOR_LABEL),
      resourceType: 'job',
      diff: { checked: checks.length, mismatches: broken.length, distributorIds },
    });
    return { checked: checks.length, mismatches: broken.length, distributorIds, raised };
  }

  /**
   * Raises the alert for one broken wallet unless it already has an unresolved one, read again under a
   * per-distributor advisory lock in the raise's own transaction (as `raiseVanNotEmpty` does for vans): a
   * second run at the same moment waits for the first one's raise, then finds it. True when it raised.
   */
  private async raiseOnce(check: WalletCheck, businessName: string | null): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-check:${check.distributorId}`}))`;
        const unresolved = await tx.alert.count({
          where: {
            alertType: AlertType.WALLET_CHECK_MISMATCH,
            resourceType: ALERT_RESOURCE_TYPE,
            resourceId: check.distributorId,
            status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] },
          },
        });
        if (unresolved > 0) return false;
        await this.raise(check, businessName, tx);
        return true;
      },
      // A second run waits on the lock for the first one's commit: give it time, the job is never in a hurry.
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  private async raise(check: WalletCheck, businessName: string | null, tx: Prisma.TransactionClient): Promise<void> {
    const difference = check.balancePaisa - check.ledgerSumPaisa;
    const who = businessName ?? 'A distributor';
    const body =
      difference === 0n
        ? `${who}'s balance is ${formatRs(check.balancePaisa)}, below zero. Tell engineering; nothing was changed.`
        : `${who}'s balance (${formatRs(check.balancePaisa)}) doesn't match its wallet history (${formatRs(check.ledgerSumPaisa)}). ` +
          `The difference is ${formatRs(difference)}. Tell engineering; nothing was changed.`;
    await this.alerts.raise({
      alertType: AlertType.WALLET_CHECK_MISMATCH,
      severity: AlertSeverity.CRITICAL,
      title: `Wallet check: ${who}'s balance doesn't match its history`,
      body,
      resourceType: ALERT_RESOURCE_TYPE,
      resourceId: check.distributorId,
      context: {
        balancePaisa: check.balancePaisa.toString(),
        ledgerSumPaisa: check.ledgerSumPaisa.toString(),
        differencePaisa: difference.toString(),
      },
    }, tx);
  }

  private async businessNames(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.distributor.findMany({ where: { id: { in: ids } }, select: { id: true, businessName: true } });
    return new Map(rows.map((row) => [row.id, row.businessName]));
  }
}
