import { ExpenseCategory, Prisma } from '@prisma/client';
import type { ExpenseAction, ExpenseDto, ExpenseTypeDto, IdName } from '@smartfleet/shared-types';
import { isoDateOf } from './expense-dates';

/** Ids are UUIDs; anything else is answered like an unknown record (API_CONTRACT §2.2: 404, never 500). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Audit `resourceType` of the two tables this module owns (API_CONTRACT §5.1, Appendix B). */
export const EXPENSE_RESOURCE = 'Expense';
export const EXPENSE_TYPE_RESOURCE = 'ExpenseType';

/** What an expense row is read with: safe selects only (a driver's name, never their user row). */
export const EXPENSE_INCLUDE = {
  type: { select: { id: true, code: true, name: true } },
  vehicle: { select: { id: true, plateNo: true } },
  driver: { select: { id: true, user: { select: { name: true } } } },
  receiptFile: { select: { id: true, storageKey: true } },
} satisfies Prisma.ExpenseInclude;

export type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

/** An expense type with its live expense count (removed expenses don't use a type any more). */
export const EXPENSE_TYPE_INCLUDE = {
  _count: { select: { expenses: { where: { voidedAt: null } } } },
} satisfies Prisma.ExpenseTypeInclude;

export type ExpenseTypeRow = Prisma.ExpenseTypeGetPayload<{ include: typeof EXPENSE_TYPE_INCLUDE }>;

export function toExpenseTypeDto(row: ExpenseTypeRow): ExpenseTypeDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isSystem: row.isSystem,
    archived: row.archivedAt !== null,
    sortOrder: row.sortOrder,
    expenseCount: row._count.expenses,
  };
}

/**
 * The type code an old fixed category became (DATA_MODEL §3.4 backfill 11): FUEL → PETROL,
 * MAINTENANCE and OTHER keep their code, every other category its archived `LEGACY_<CATEGORY>` type.
 * Only a row the old API wrote after inc1a (with a category and no `type_id`) needs it; inc1b fills
 * those in and makes `type_id` required.
 */
export function typeCodeForCategory(category: ExpenseCategory): string {
  switch (category) {
    case ExpenseCategory.FUEL:
      return 'PETROL';
    case ExpenseCategory.MAINTENANCE:
      return 'MAINTENANCE';
    case ExpenseCategory.OTHER:
      return 'OTHER';
    default:
      return `LEGACY_${category}`;
  }
}

/** The old categories a type stands for, so a list filtered by type finds rows the old API wrote. */
export function categoriesForTypeCode(code: string | null): ExpenseCategory[] {
  if (!code) return [];
  return Object.values(ExpenseCategory).filter((category) => typeCodeForCategory(category) === code);
}

/**
 * The same mapping in SQL, for the summary: the row's `type_id`, else its category's type, else Other.
 * Written once here so the summary and the list agree.
 */
export const EFFECTIVE_TYPE_SQL = Prisma.sql`COALESCE(
  e.type_id,
  (SELECT lt.id FROM expense_types lt WHERE lt.code = CASE e.category::text
     WHEN 'FUEL' THEN 'PETROL' WHEN 'MAINTENANCE' THEN 'MAINTENANCE' WHEN 'OTHER' THEN 'OTHER'
     ELSE 'LEGACY_' || e.category::text END),
  (SELECT ot.id FROM expense_types ot WHERE ot.code = 'OTHER'))`;

/** The buttons an expense offers (API_CONTRACT §1.6): none once it is removed. */
export function expenseActions(row: Pick<ExpenseRow, 'voidedAt'>): ExpenseAction[] {
  return row.voidedAt ? [] : ['EDIT', 'VOID'];
}

export interface ExpenseDtoContext {
  /** Names of the people who recorded or removed the rows. */
  names: ReadonlyMap<string, string>;
  /** Types by code, for rows without a `type_id` (see {@link typeCodeForCategory}). */
  typesByCode: ReadonlyMap<string, { id: string; code: string | null; name: string }>;
  /** A fresh 1-hour receipt URL. */
  receiptUrl: (file: { storageKey: string }) => Promise<string>;
}

function person(id: string, names: ReadonlyMap<string, string>): IdName {
  return { id, name: names.get(id) ?? '' };
}

function typeOf(row: ExpenseRow, context: ExpenseDtoContext): ExpenseDto['type'] {
  if (row.type) return row.type;
  const code = row.category ? typeCodeForCategory(row.category) : 'OTHER';
  const type = context.typesByCode.get(code) ?? context.typesByCode.get('OTHER');
  return type ? { id: type.id, code: type.code, name: type.name } : { id: '', code: null, name: '' };
}

export async function toExpenseDto(row: ExpenseRow, context: ExpenseDtoContext): Promise<ExpenseDto> {
  return {
    id: row.id,
    expenseDate: isoDateOf(row.expenseDate),
    amountPaisa: row.amountPaisa.toString(),
    type: typeOf(row, context),
    vehicle: row.vehicle ? { id: row.vehicle.id, plateNo: row.vehicle.plateNo } : null,
    driver: row.driver ? { id: row.driver.id, name: row.driver.user.name } : null,
    description: row.description,
    receiptFileId: row.receiptFileId,
    receiptUrl: row.receiptFile ? await context.receiptUrl(row.receiptFile) : null,
    recordedBy: person(row.recordedByUserId, context.names),
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidReason: row.voidReason,
    voidedBy: row.voidedByUserId ? person(row.voidedByUserId, context.names) : null,
    allowedActions: expenseActions(row),
  };
}
