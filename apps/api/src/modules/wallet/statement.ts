import type { LedgerEntryType, Prisma } from '@prisma/client';
import {
  CORRECTION_REASONS,
  type CorrectionReason,
  type StatementItem,
  type StatementKind,
  type StatementSubject,
} from '@smartfleet/shared-types';
import { formatNo } from '@smartfleet/shared-utils';
import type { WalletStatementView } from './wallet.types';

/**
 * Wallet history words (API_CONTRACT §1.4 `StatementKind`). Pure mapping from ledger rows; the ledger
 * stays the only source, so the statement can never disagree with the balance.
 */

/** The ledger reason code of an opening entry (the migration's, the test setup's, or an office correction). */
export const OPENING_BALANCE_REASON: CorrectionReason = 'OPENING_BALANCE';

/** The plain kind of one ledger row (API_CONTRACT §1.4). */
export function statementKindOf(entryType: LedgerEntryType | `${LedgerEntryType}`, reasonCode: string | null): StatementKind {
  switch (entryType) {
    case 'CREDIT_TOPUP':
      return 'TOPUP_ADDED';
    case 'DEBIT_ORDER':
      return 'DELIVERY_COST';
    case 'CREDIT_ORDER_REVERSAL':
      return 'DELIVERY_COST_RETURNED';
    case 'DEBIT_REFILL':
      return 'REFILL_DELIVERY_COST';
    case 'ADJUSTMENT':
      if (reasonCode === null || reasonCode === undefined) return 'LEGACY';
      // Every adjustment with reason OPENING_BALANCE reads "Opening balance", whoever wrote it (G01-04).
      return reasonCode === OPENING_BALANCE_REASON ? 'OPENING_BALANCE' : 'CORRECTION';
  }
}

/** The ledger rows of one kind, as a Prisma filter. */
export const KIND_WHERE: Readonly<Record<StatementKind, Prisma.LedgerEntryWhereInput>> = {
  TOPUP_ADDED: { entryType: 'CREDIT_TOPUP' },
  DELIVERY_COST: { entryType: 'DEBIT_ORDER' },
  DELIVERY_COST_RETURNED: { entryType: 'CREDIT_ORDER_REVERSAL' },
  OPENING_BALANCE: { entryType: 'ADJUSTMENT', reasonCode: OPENING_BALANCE_REASON },
  CORRECTION: { entryType: 'ADJUSTMENT', AND: [{ reasonCode: { not: null } }, { reasonCode: { not: OPENING_BALANCE_REASON } }] },
  LEGACY: { entryType: 'ADJUSTMENT', reasonCode: null },
  REFILL_DELIVERY_COST: { entryType: 'DEBIT_REFILL' },
};

/** A filter for any of `kinds`; undefined (every row) when none is given. */
export function kindsWhere(kinds: readonly StatementKind[] | undefined): Prisma.LedgerEntryWhereInput | undefined {
  if (!kinds || kinds.length === 0) return undefined;
  const distinct = [...new Set(kinds)];
  return distinct.length === 1 ? KIND_WHERE[distinct[0]] : { OR: distinct.map((kind) => KIND_WHERE[kind]) };
}

/** A ledger row with what the statement shows about its order or top-up. */
export interface StatementRow {
  id: string;
  entryType: LedgerEntryType | `${LedgerEntryType}`;
  amountPaisa: bigint;
  balanceAfterPaisa: bigint;
  reasonCode: string | null;
  note: string | null;
  orderId: string | null;
  paymentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  order: { id: string; orderNo: number | null; client: { name: string } | null } | null;
  payment: { id: string; requestNo: number | null; bankReference: string | null } | null;
}

/** The Prisma include that loads a {@link StatementRow}'s order and top-up. */
export const STATEMENT_ROW_INCLUDE = {
  order: { select: { id: true, orderNo: true, client: { select: { name: true } } } },
  payment: { select: { id: true, requestNo: true, bankReference: true } },
} as const satisfies Prisma.LedgerEntryInclude;

export interface StatementContext {
  /** The distributor's code for the human numbers (AG-0142, AG-T031); null before one is set. */
  distributorCode: string | null;
  /** Names of the users who wrote rows (`created_by_user_id`), for the office view's `by`. */
  userNames: ReadonlyMap<string, string>;
}

/** "AG-0142" for a number, "" while a legacy row has none. */
export function humanNo(code: string | null, kind: 'ORDER' | 'TOPUP', n: number | null | undefined): string {
  return n === null || n === undefined ? '' : formatNo(code, kind, n);
}

function orderSubject(row: StatementRow, ctx: StatementContext): StatementSubject | null {
  if (!row.orderId) return null;
  return {
    type: 'ORDER',
    id: row.orderId,
    shortCode: humanNo(ctx.distributorCode, 'ORDER', row.order?.orderNo),
    clientName: row.order?.client?.name ?? null,
  };
}

function topupSubject(row: StatementRow, ctx: StatementContext, view: WalletStatementView): StatementSubject | null {
  if (!row.paymentId) return null;
  return {
    type: 'TOPUP',
    id: row.paymentId,
    shortCode: humanNo(ctx.distributorCode, 'TOPUP', row.payment?.requestNo),
    clientName: null,
    // The bank reference is the office's record of the bank payment (G01-09): office view only.
    ...(view === 'OFFICE' ? { bankReference: row.payment?.bankReference ?? null } : {}),
  };
}

/**
 * What a row points at (G01-02): a delivery cost and its return point at the order, a top-up at its
 * request; a correction or opening entry at its related order, else its related top-up, else nothing.
 */
export function statementSubject(row: StatementRow, ctx: StatementContext, view: WalletStatementView): StatementSubject | null {
  switch (row.entryType) {
    case 'DEBIT_ORDER':
    case 'CREDIT_ORDER_REVERSAL':
      return orderSubject(row, ctx);
    case 'CREDIT_TOPUP':
      return topupSubject(row, ctx, view);
    case 'ADJUSTMENT':
      return orderSubject(row, ctx) ?? topupSubject(row, ctx, view);
    default:
      // DEBIT_REFILL is reserved and never written; refills have no human number in Inc 1.
      return null;
  }
}

function correctionReason(kind: StatementKind, reasonCode: string | null): CorrectionReason | null {
  if (kind !== 'CORRECTION' && kind !== 'OPENING_BALANCE') return null;
  return (CORRECTION_REASONS as readonly string[]).includes(reasonCode ?? '') ? (reasonCode as CorrectionReason) : null;
}

/**
 * One statement row. Money is signed digit strings ("-48000"). The distributor view never carries
 * `note`, `by` or a bank reference, not even as an empty key; the office view always does.
 */
export function toStatementItem(row: StatementRow, ctx: StatementContext, view: WalletStatementView): StatementItem {
  const kind = statementKindOf(row.entryType, row.reasonCode);
  const item: StatementItem = {
    id: row.id,
    at: row.createdAt.toISOString(),
    kind,
    amountPaisa: row.amountPaisa.toString(),
    balanceAfterPaisa: row.balanceAfterPaisa.toString(),
    subject: statementSubject(row, ctx, view),
    reasonCode: correctionReason(kind, row.reasonCode),
  };
  if (view === 'OFFICE') {
    const name = row.createdByUserId ? ctx.userNames.get(row.createdByUserId) : undefined;
    item.note = row.note ?? null;
    item.by = name ? { name } : null;
  }
  return item;
}
