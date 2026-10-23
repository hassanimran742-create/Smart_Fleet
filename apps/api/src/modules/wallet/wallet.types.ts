import type { LedgerEntry, Prisma } from '@prisma/client';
import type { CorrectionDirection, CorrectionReason, StatementKind } from '@smartfleet/shared-types';
import type { Actor } from '../../common/auth/actor';

/**
 * What a delivery-cost debit or reversal is for (API_CONTRACT §5.4). REFILL is reserved for setting
 * `refill.deliveryCost`, which is off: it throws until that exists.
 */
export type FeeSubject = { type: 'ORDER'; orderId: string } | { type: 'REFILL'; fillingOrderId: string };

/** A transaction client: every money write runs inside the caller's `$transaction`. */
export type WalletTx = Prisma.TransactionClient;

export interface WalletDebitParams {
  distributorId: string;
  subject: FeeSubject;
  /** Positive paisa; 0 writes no row and returns null. */
  amountPaisa: bigint;
  actor: Actor;
}

export interface WalletReverseParams {
  subject: FeeSubject;
  actor: Actor;
  reason: string;
}

export interface WalletCreditTopupParams {
  distributorId: string;
  paymentId: string;
  amountPaisa: bigint;
  actor: Actor;
}

export interface WalletCorrectionParams {
  distributorId: string;
  direction: CorrectionDirection;
  /** Positive paisa, whole rupees. */
  amountPaisa: bigint;
  reasonCode: CorrectionReason;
  note: string;
  relatedPaymentId?: string;
  relatedOrderId?: string;
  /** The request's Idempotency-Key; the ledger key is `adjust:<requestKey>`. */
  requestKey: string;
  actor: Actor;
}

/**
 * What {@link WalletService.applyCorrection} did: wrote `entry` now, or found it already written under
 * the same key with the same details (`replayed`), which the route answers 200 `Idempotent-Replay`.
 */
export interface CorrectionOutcome {
  entry: LedgerEntry;
  replayed: boolean;
}

export interface WalletStatementQuery {
  /** One or more kinds (API_CONTRACT §7.8: `kind=DELIVERY_COST,DELIVERY_COST_RETURNED`); absent or empty means all. */
  kind?: StatementKind[];
  /** A business date `YYYY-MM-DD` (from the start of that business day) or an ISO instant (inclusive). */
  from?: string;
  /** A business date `YYYY-MM-DD` (to the end of that business day) or an ISO instant (inclusive). */
  to?: string;
  cursor?: string;
  limit?: number;
}

/** Who reads a statement: distributors never see correction notes, authors or bank references. */
export type WalletStatementView = 'DISTRIBUTOR' | 'OFFICE';

/** One distributor's integrity check: the ledger sum must equal the cached balance, which is never negative. */
export interface WalletCheck {
  distributorId: string;
  balancePaisa: bigint;
  ledgerSumPaisa: bigint;
  ok: boolean;
}

/** The deterministic ledger idempotency keys (API_CONTRACT §4.2). */
export const walletKeys = {
  orderDebit: (orderId: string) => `order:${orderId}:debit`,
  orderReversal: (orderId: string) => `order:${orderId}:reversal`,
  topup: (paymentId: string) => `topup:${paymentId}`,
  correction: (requestKey: string) => `adjust:${requestKey}`,
} as const;
