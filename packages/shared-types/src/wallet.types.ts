import type { IsoDateTime, Paisa, UUID } from './common.types';
import type { CorrectionReason, StatementKind } from './ledger.types';

/**
 * A distributor's wallet (ADR-06): one balance, no holds. `pendingTopup*` is money "being checked"
 * (top-up requests still PENDING), which is not part of the balance.
 */
export interface WalletSummary {
  balancePaisa: Paisa;
  pendingTopupPaisa: Paisa;
  pendingTopupCount: number;
  /** True when the balance is strictly below setting `wallet.lowBalancePaisa` (Rs 0 never warns). */
  lowBalance: boolean;
  /** Setting `wallet.maxBalancePaisa`; null means no cap. */
  capPaisa: Paisa | null;
}

/** What a statement row points at. `shortCode` is the human number (AG-0142, AG-T031, AG-R007). */
export interface StatementSubject {
  type: 'ORDER' | 'TOPUP' | 'REFILL';
  id: UUID;
  shortCode: string;
  /** ORDER: the customer's name (UX_MOBILE S7 shows "AG-0142 · Ahmed Khan"); otherwise null. */
  clientName: string | null;
  /** TOPUP subjects in the office view only: the bank reference as the office typed it. */
  bankReference?: string | null;
}

/** One wallet history row, read from the ledger only (API_CONTRACT §7.8). */
export interface StatementItem {
  id: UUID;
  at: IsoDateTime;
  kind: StatementKind;
  /** Signed: money in is positive, money out is negative. */
  amountPaisa: Paisa;
  balanceAfterPaisa: Paisa;
  subject: StatementSubject | null;
  /** The correction reason for CORRECTION and OPENING_BALANCE rows; null otherwise. */
  reasonCode: CorrectionReason | null;
  /** Office view only. */
  note?: string | null;
  /** Office view only: who wrote the row; null for system rows. */
  by?: { name: string } | null;
}

/** `GET /ledger/balance` (compatibility for installed apps). */
export interface LedgerBalanceDto {
  balancePaisa: Paisa;
  pendingTopupPaisa: Paisa;
}

/** One row of `GET /admin/wallets` (office). `checking*` are pending top-ups. */
export interface AdminWalletRow {
  distributorId: UUID;
  businessName: string;
  code: string;
  balancePaisa: Paisa;
  /** The same flag as {@link WalletSummary.lowBalance}: strictly below `wallet.lowBalancePaisa` (Rs 0 never warns). */
  lowBalance: boolean;
  checkingPaisa: Paisa;
  checkingCount: number;
  lastTopupAt: IsoDateTime | null;
}

/** Whether the ledger sum equals the cached balance, computed live. */
export interface WalletIntegrity {
  ok: boolean;
  ledgerSumPaisa: Paisa;
  /** Balance minus ledger sum, signed: "12000" when the balance is above its history, "-12000" below, "0" when ok. */
  differencePaisa: Paisa;
  checkedAt: IsoDateTime;
}

/** `GET /admin/distributors/:id/wallet` (office). */
export interface AdminWalletDetail extends WalletSummary {
  integrity: WalletIntegrity;
}

/** `POST /admin/distributors/:id/wallet/corrections` (office). */
export interface WalletCorrectionResult {
  entry: StatementItem;
  wallet: WalletSummary;
}
