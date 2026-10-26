import type { ISODateString, Paisa, UUID } from './common.types';

/**
 * Mirrors Prisma `LedgerEntryType`. Amounts are signed: CREDIT_* positive, DEBIT_* negative,
 * ADJUSTMENT either way (opening balances and corrections carry a `reasonCode`).
 */
export enum LedgerEntryType {
  CREDIT_TOPUP = 'CREDIT_TOPUP',
  DEBIT_ORDER = 'DEBIT_ORDER',
  ADJUSTMENT = 'ADJUSTMENT',
  /** The delivery cost returned on a cancel before delivery started (ADR-07). */
  CREDIT_ORDER_REVERSAL = 'CREDIT_ORDER_REVERSAL',
  /** Reserved for setting `refill.deliveryCost`; never written while it is off. */
  DEBIT_REFILL = 'DEBIT_REFILL',
}

/** The wire value of a {@link LedgerEntryType}. */
export type LedgerEntryTypeValue = `${LedgerEntryType}`;

export interface LedgerEntry {
  id: UUID;
  distributorId: UUID;
  entryType: LedgerEntryType;
  amountPaisa: Paisa;
  balanceAfterPaisa: Paisa;
  paymentId?: UUID;
  orderId?: UUID;
  note?: string;
  createdAt: ISODateString;
}

/**
 * What a wallet history row means, mapped from the ledger (API_CONTRACT §1.4). Apps map it to
 * `wallet.kind.<KIND>`.
 *
 * | Kind | Ledger row |
 * |---|---|
 * | TOPUP_ADDED | CREDIT_TOPUP |
 * | DELIVERY_COST | DEBIT_ORDER |
 * | DELIVERY_COST_RETURNED | CREDIT_ORDER_REVERSAL |
 * | OPENING_BALANCE | ADJUSTMENT with reason OPENING_BALANCE |
 * | CORRECTION | ADJUSTMENT with any other reason |
 * | LEGACY | ADJUSTMENT with no reason |
 * | REFILL_DELIVERY_COST | DEBIT_REFILL (reserved) |
 */
export const STATEMENT_KINDS = [
  'TOPUP_ADDED',
  'DELIVERY_COST',
  'DELIVERY_COST_RETURNED',
  'OPENING_BALANCE',
  'CORRECTION',
  'LEGACY',
  'REFILL_DELIVERY_COST',
] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

/** Reason codes for a super-admin wallet correction (ADR-10, API_CONTRACT §1.5). Listed in display order. */
export const CORRECTION_REASONS = [
  'WRONG_TOPUP_APPROVAL',
  'SYSTEM_ERROR',
  'BANK_REVERSAL',
  'OPENING_BALANCE',
  'OTHER',
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

/** A correction adds money to the wallet or takes it out. */
export const CORRECTION_DIRECTIONS = ['ADD', 'TAKE'] as const;
export type CorrectionDirection = (typeof CORRECTION_DIRECTIONS)[number];
