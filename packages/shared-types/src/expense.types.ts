import type { IdName, IsoDate, IsoDateTime, Paisa, UUID } from './common.types';

/**
 * Codes of the seeded expense types (ADR-14). Custom types have a null code; old categories became
 * archived `LEGACY_<CATEGORY>` types. A code never changes, even when the type is renamed.
 */
export const SEEDED_EXPENSE_TYPE_CODES = ['PETROL', 'MAINTENANCE', 'REPAIRS', 'TYRES', 'TOLL_PARKING', 'OTHER'] as const;
export type SeededExpenseTypeCode = (typeof SEEDED_EXPENSE_TYPE_CODES)[number];

/** System types: they can be renamed but never archived (`EXPENSE_TYPE_LOCKED`). */
export const SYSTEM_EXPENSE_TYPE_CODES = ['PETROL', 'OTHER'] as const;

/** Buttons the server allows on an expense (API_CONTRACT §1.6). */
export const EXPENSE_ACTIONS = ['EDIT', 'VOID'] as const;
export type ExpenseAction = (typeof EXPENSE_ACTIONS)[number];

/** `GET /expense-types` (office). */
export interface ExpenseTypeDto {
  id: UUID;
  code: string | null;
  /** Shown as stored, including for seeded types. */
  name: string;
  isSystem: boolean;
  archived: boolean;
  sortOrder: number;
  expenseCount: number;
}

/** An expense (API_CONTRACT §7.12). Expenses never touch distributor wallets. */
export interface ExpenseDto {
  id: UUID;
  expenseDate: IsoDate;
  amountPaisa: Paisa;
  type: { id: UUID; code: string | null; name: string };
  vehicle: { id: UUID; plateNo: string } | null;
  driver: IdName | null;
  /** The expense's note (UI label "Note"). */
  description: string;
  receiptFileId: UUID | null;
  /** Signed URL valid for 1 hour. */
  receiptUrl: string | null;
  recordedBy: IdName;
  createdAt: IsoDateTime;
  voidedAt: IsoDateTime | null;
  voidReason: string | null;
  voidedBy: IdName | null;
  allowedActions: ExpenseAction[];
}

export interface ExpenseSummaryByType {
  typeId: UUID;
  code: string | null;
  name: string;
  totalPaisa: Paisa;
  count: number;
}

export interface ExpenseSummaryByMonth {
  /** `YYYY-MM`, from `expense_date`. */
  month: string;
  totalPaisa: Paisa;
  byType: { typeId: UUID; totalPaisa: Paisa }[];
}

/**
 * `GET /expenses/summary` (office), excluding voided rows. Driver fuel logs are shown alongside,
 * never merged into the totals (ADR-14).
 */
export interface ExpenseSummary {
  from: IsoDate;
  to: IsoDate;
  totalPaisa: Paisa;
  count: number;
  byType: ExpenseSummaryByType[];
  byMonth: ExpenseSummaryByMonth[];
  fuelLogs: { totalPaisa: Paisa; count: number; byMonth: { month: string; totalPaisa: Paisa; count: number }[] };
}
