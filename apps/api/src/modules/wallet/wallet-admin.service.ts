import { Injectable } from '@nestjs/common';
import type { AdminWalletDetail, AdminWalletRow, CorrectionReason, WalletCorrectionResult } from '@smartfleet/shared-types';
import type { WalletCorrectionInput } from '@smartfleet/shared-validation';
import type { Actor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { CorrectionOutcome, WalletCorrectionParams } from './wallet.types';
import { WalletService } from './wallet.service';

/** What the corrections route answers, and whether it is a replay (200 `Idempotent-Replay`). */
export interface CorrectionResponse {
  body: WalletCorrectionResult;
  replayed: boolean;
}

/**
 * The office's wallet screens (API_CONTRACT §7.8): the list, one wallet with its live integrity check,
 * and corrections. Reads only, except corrections, which go through {@link WalletService}.
 */
@Injectable()
export class WalletAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * `GET /admin/wallets`: one row per distributor, by name. `checking*` are requests being checked;
   * `lastTopupAt` is when the newest approved top-up was approved (its `completed_at`), null if none
   * (G14-02): requests being checked or rejected don't count. `lowBalance` is the shop app's flag
   * (`WalletSummary.lowBalance`): strictly below setting `wallet.lowBalancePaisa`, so Rs 0 never warns.
   */
  async list(): Promise<AdminWalletRow[]> {
    const lowBalancePaisa = BigInt(await this.settings.get('wallet.lowBalancePaisa'));
    const rows = await this.prisma.$queryRaw<
      Array<{
        distributorId: string;
        businessName: string;
        code: string | null;
        balancePaisa: bigint;
        checkingPaisa: bigint;
        checkingCount: number;
        lastTopupAt: Date | null;
      }>
    >`
      SELECT d.id AS "distributorId", d.business_name AS "businessName", d.code,
             d.advance_balance_paisa AS "balancePaisa",
             COALESCE(pending.total, 0)::bigint AS "checkingPaisa",
             COALESCE(pending.n, 0)::int AS "checkingCount",
             approved.last_at AS "lastTopupAt"
      FROM distributors d
      LEFT JOIN (SELECT distributor_id, sum(amount_paisa) AS total, count(*) AS n
                 FROM payments WHERE status = 'PENDING' GROUP BY distributor_id) pending
             ON pending.distributor_id = d.id
      LEFT JOIN (SELECT distributor_id, max(completed_at) AS last_at
                 FROM payments WHERE status = 'SUCCESS' GROUP BY distributor_id) approved
             ON approved.distributor_id = d.id
      ORDER BY d.business_name, d.id`;
    return rows.map((row) => ({
      distributorId: row.distributorId,
      businessName: row.businessName,
      code: row.code ?? '',
      balancePaisa: row.balancePaisa.toString(),
      lowBalance: row.balancePaisa < lowBalancePaisa,
      checkingPaisa: row.checkingPaisa.toString(),
      checkingCount: Number(row.checkingCount),
      lastTopupAt: row.lastTopupAt ? row.lastTopupAt.toISOString() : null,
    }));
  }

  /**
   * `GET /admin/distributors/:id/wallet`: the summary plus a live integrity check. It only reads: it
   * never raises, changes or resolves an alert (G01-06; only the nightly job raises them).
   */
  async detail(distributorId: string): Promise<AdminWalletDetail> {
    const summary = await this.wallet.summary(distributorId);
    const [check] = await this.wallet.verify(distributorId);
    if (!check) throw new AppError('NOT_FOUND');
    return {
      ...summary,
      integrity: {
        ok: check.ok,
        ledgerSumPaisa: check.ledgerSumPaisa.toString(),
        // Balance minus history, signed (G01-05): "12000" when the balance is Rs 120 above its history.
        differencePaisa: (check.balancePaisa - check.ledgerSumPaisa).toString(),
        checkedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * `POST /admin/distributors/:id/wallet/corrections`, after the body and the Idempotency-Key were
   * checked. The same key with the same body replays the first entry with the wallet as it is now;
   * a duplicate racing the first loses on the ledger key, rolls back whole and is answered as the replay.
   */
  async correct(distributorId: string, body: WalletCorrectionInput, requestKey: string, actor: Actor): Promise<CorrectionResponse> {
    const params: WalletCorrectionParams = {
      distributorId,
      direction: body.direction,
      amountPaisa: BigInt(body.amountPaisa),
      reasonCode: body.reasonCode as CorrectionReason,
      note: body.note,
      relatedPaymentId: body.relatedPaymentId,
      relatedOrderId: body.relatedOrderId,
      requestKey,
      actor,
    };
    let outcome: CorrectionOutcome;
    try {
      outcome = await this.prisma.$transaction((tx) => this.wallet.applyCorrection(tx, params));
    } catch (error) {
      if (!isUniqueViolation(error, 'ledger_entries_idempotency_key_key')) throw error;
      // The same key committed first: this run finds it and replays it, or refuses a different body.
      outcome = await this.prisma.$transaction((tx) => this.wallet.applyCorrection(tx, params));
    }
    const [entry, wallet] = await Promise.all([
      this.wallet.statementItem(outcome.entry.id, 'OFFICE'),
      this.wallet.summary(outcome.entry.distributorId),
    ]);
    return { body: { entry, wallet }, replayed: outcome.replayed };
  }
}
