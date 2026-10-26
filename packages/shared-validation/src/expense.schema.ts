import { z } from 'zod';
import {
  booleanQuerySchema,
  isoDateSchema,
  nullableUuidSchema,
  optionalPaisaSchema,
  optionalUuidSchema,
  pageQuerySchema,
  rupeeAmountSchema,
  textSchema,
  uuidSchema,
} from './common.schema';

/** The largest expense: Rs 1,000,000 (API_CONTRACT §7.12). */
export const EXPENSE_MAX_PAISA = 100000000;

/** An expense type name, 2–40 characters, shown as typed. */
export const expenseTypeNameSchema = textSchema(2, 40);

/**
 * The key that keeps type names unique without regard to case or spacing (`expense_types.name_key`):
 * trimmed, inner spaces collapsed, lower-cased.
 */
export function toExpenseTypeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * `POST /expenses` (office). The service checks the date is not after today in Asia/Karachi
 * (`EXPENSE_DATE_IN_FUTURE`), the type is active (`EXPENSE_TYPE_ARCHIVED`), the van and driver exist
 * (`NOT_FOUND {field}`) and the receipt is an EXPENSE_RECEIPT upload (`FILE_NOT_FOUND`).
 * `description` is the UI's "Note".
 */
export const createExpenseSchema = z.object({
  expenseDate: isoDateSchema,
  amountPaisa: rupeeAmountSchema(EXPENSE_MAX_PAISA),
  typeId: uuidSchema,
  vehicleId: optionalUuidSchema,
  driverId: optionalUuidSchema,
  description: textSchema(1, 200),
  receiptFileId: optionalUuidSchema,
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** `PATCH /expenses/:id` (office): the same fields, all optional; null clears the van, driver or receipt. */
export const updateExpenseSchema = z.object({
  expenseDate: isoDateSchema.optional(),
  amountPaisa: optionalPaisaSchema({ minPaisa: 100, maxPaisa: EXPENSE_MAX_PAISA, wholeRupees: true }),
  typeId: uuidSchema.optional(),
  vehicleId: nullableUuidSchema,
  driverId: nullableUuidSchema,
  description: textSchema(1, 200).optional(),
  receiptFileId: nullableUuidSchema,
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

/** `POST /expenses/:id/void` (office) `{ reason (5–200) }`: a logged removal, never a delete. */
export const voidExpenseSchema = z.object({
  reason: textSchema(5, 200),
});
export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;

/** `POST /expense-types` (office) `{ name }`. */
export const createExpenseTypeSchema = z.object({
  name: expenseTypeNameSchema,
});
export type CreateExpenseTypeInput = z.infer<typeof createExpenseTypeSchema>;

/** `PATCH /expense-types/:id` (office) `{ name }`. The type's code never changes. */
export const renameExpenseTypeSchema = z.object({
  name: expenseTypeNameSchema,
});
export type RenameExpenseTypeInput = z.infer<typeof renameExpenseTypeSchema>;

/** Adds `END_BEFORE_START` on `to` when the range is reversed. */
function rangeInOrder(range: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  if (range.from !== undefined && range.to !== undefined && range.to < range.from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'END_BEFORE_START' });
  }
}

/** `GET /expenses` (office). Dates are inclusive `YYYY-MM-DD`; the API defaults to the current month. */
export const expensesQuerySchema = pageQuerySchema
  .extend({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    typeId: optionalUuidSchema,
    vehicleId: optionalUuidSchema,
    driverId: optionalUuidSchema,
    includeVoided: booleanQuerySchema.optional(),
  })
  .superRefine(rangeInOrder);
export type ExpensesQuery = z.infer<typeof expensesQuerySchema>;

/** `GET /expenses/summary?from&to` (office). */
export const expenseSummaryQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .superRefine(rangeInOrder);
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;

/** `GET /expense-types?includeArchived=` (office): archived types are left out unless asked for. */
export const expenseTypesQuerySchema = z.object({
  includeArchived: booleanQuerySchema.optional(),
});
export type ExpenseTypesQuery = z.infer<typeof expenseTypesQuerySchema>;
