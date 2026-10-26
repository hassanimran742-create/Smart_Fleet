import { Prisma } from '@prisma/client';
import type { ErrorCode } from '@smartfleet/shared-types';

/**
 * Database constraint failures, read from Prisma errors (DATA_MODEL §7: one central mapping).
 *
 * Prisma reports them in three shapes (checked against Prisma 5.22 on PostgreSQL 16):
 * - model API unique violation: P2002 with `meta = { modelName, target: [db column names] }`;
 * - raw SQL (`$queryRaw`/`$executeRaw`): P2010 with `meta = { code: <SQLSTATE>, message }`, where a
 *   unique violation's message is only `Key (col, …)=(…) already exists.` and a CHECK violation's
 *   names the relation and the constraint;
 * - model API CHECK violation: PrismaClientUnknownRequestError whose message holds the SQLSTATE and
 *   the constraint name.
 */
export type DbViolationKind = 'unique' | 'check' | 'foreign_key' | 'not_null';

export interface DbConstraintViolation {
  kind: DbViolationKind;
  /** The constraint name, when the database reported it or it could be derived. */
  constraint?: string;
  table?: string;
  /** Database column names (unique violations). */
  columns?: string[];
}

interface KnownUniqueConstraint {
  name: string;
  table: string;
  columns: readonly string[];
  code: ErrorCode;
}

/**
 * Unique keys with an API meaning (DATA_MODEL §7). Codes with English parameters
 * (TOPUP_BANK_REFERENCE_USED, DISTRIBUTOR_CODE_IN_USE, EXPENSE_TYPE_NAME_TAKEN, CLIENT_PHONE_EXISTS)
 * are a safety net: the owning service catches the violation and throws the code with its details.
 * Idempotency keys map to CONFLICT_DUPLICATE here because the service is meant to return the first
 * record instead (`isUniqueViolation`); reaching the filter means it did not.
 */
export const KNOWN_UNIQUE_CONSTRAINTS: readonly KnownUniqueConstraint[] = [
  { name: 'payments_bank_reference_key_key', table: 'payments', columns: ['bank_reference_key'], code: 'TOPUP_BANK_REFERENCE_USED' },
  { name: 'orders_distributor_id_client_request_id_key', table: 'orders', columns: ['distributor_id', 'client_request_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'payments_distributor_id_client_request_id_key', table: 'payments', columns: ['distributor_id', 'client_request_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'filling_orders_distributor_id_client_request_id_key', table: 'filling_orders', columns: ['distributor_id', 'client_request_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'expenses_client_request_id_key', table: 'expenses', columns: ['client_request_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'clients_distributor_id_client_request_id_key', table: 'clients', columns: ['distributor_id', 'client_request_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'distributors_client_request_id_key', table: 'distributors', columns: ['client_request_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'ledger_entries_idempotency_key_key', table: 'ledger_entries', columns: ['idempotency_key'], code: 'CONFLICT_DUPLICATE' },
  { name: 'outbound_messages_idempotency_key_key', table: 'outbound_messages', columns: ['idempotency_key'], code: 'CONFLICT_DUPLICATE' },
  { name: 'cylinder_events_actor_user_id_client_scan_id_key', table: 'cylinder_events', columns: ['actor_user_id', 'client_scan_id'], code: 'CONFLICT_DUPLICATE' },
  { name: 'stop_cylinders_trip_stop_id_cylinder_id_key', table: 'stop_cylinders', columns: ['trip_stop_id', 'cylinder_id'], code: 'SCAN_GIVEN_THIS_VISIT' },
  { name: 'distributor_zone_prices_distributor_id_zone_id_key', table: 'distributor_zone_prices', columns: ['distributor_id', 'zone_id'], code: 'CONFLICT_STALE_STATE' },
  { name: 'distributors_home_store_id_key', table: 'distributors', columns: ['home_store_id'], code: 'STORE_IN_USE' },
  { name: 'distributors_code_key', table: 'distributors', columns: ['code'], code: 'DISTRIBUTOR_CODE_IN_USE' },
  { name: 'expense_types_name_key_key', table: 'expense_types', columns: ['name_key'], code: 'EXPENSE_TYPE_NAME_TAKEN' },
  { name: 'clients_distributor_id_phone_key', table: 'clients', columns: ['distributor_id', 'phone'], code: 'CLIENT_PHONE_EXISTS' },
  { name: 'users_phone_key', table: 'users', columns: ['phone'], code: 'USER_PHONE_IN_USE' },
  { name: 'day_closes_distributor_id_business_date_key', table: 'day_closes', columns: ['distributor_id', 'business_date'], code: 'CONFLICT_DUPLICATE' },
];

/** CHECK constraints with an API meaning; any other CHECK failure is a VALIDATION_FAILED. */
export const KNOWN_CHECK_CONSTRAINTS: Readonly<Record<string, ErrorCode>> = {
  distributors_balance_chk: 'WALLET_INSUFFICIENT_BALANCE',
  distributors_code_chk: 'DISTRIBUTOR_CODE_INVALID',
};

const SQLSTATE_KIND: Readonly<Record<string, DbViolationKind>> = {
  '23505': 'unique',
  '23514': 'check',
  '23503': 'foreign_key',
  '23502': 'not_null',
};

function tableOfModel(modelName: unknown): string | undefined {
  if (typeof modelName !== 'string') return undefined;
  const model = Prisma.dmmf?.datamodel.models.find((m) => m.name === modelName);
  return model?.dbName ?? undefined;
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, i) => column === b[i]);
}

function knownUnique(table: string | undefined, columns: readonly string[]): KnownUniqueConstraint | undefined {
  const matches = KNOWN_UNIQUE_CONSTRAINTS.filter(
    (c) => sameColumns(c.columns, columns) && (table === undefined || c.table === table),
  );
  return matches.length > 0 ? matches[0] : undefined;
}

/** "Key (distributor_id, client_request_id)=(…) already exists." → ["distributor_id", "client_request_id"]. */
function columnsFromKeyDetail(message: string): string[] | undefined {
  const match = /Key \(([^)]*)\)=/.exec(message);
  if (!match) return undefined;
  return match[1]
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, ''))
    .filter((column) => column.length > 0);
}

function quotedAfter(message: string, phrase: string): string | undefined {
  const match = new RegExp(`${phrase} \\\\?"([A-Za-z0-9_]+)\\\\?"`).exec(message);
  return match ? match[1] : undefined;
}

function fromSqlState(sqlState: string, message: string): DbConstraintViolation | null {
  const kind = SQLSTATE_KIND[sqlState];
  if (!kind) return null;
  const table = quotedAfter(message, 'relation') ?? quotedAfter(message, 'table');
  if (kind === 'unique') {
    const columns = columnsFromKeyDetail(message);
    const reported = quotedAfter(message, 'unique constraint');
    const known = columns ? knownUnique(table, columns) : undefined;
    return { kind, constraint: reported ?? known?.name, table: table ?? known?.table, columns };
  }
  const constraint =
    kind === 'check' ? quotedAfter(message, 'check constraint') : quotedAfter(message, 'constraint');
  return { kind, constraint, table };
}

/** Reads a unique, CHECK, foreign-key or not-null violation out of any Prisma error; null otherwise. */
export function dbConstraintViolation(error: unknown): DbConstraintViolation | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (error.meta ?? {}) as Record<string, unknown>;
    if (error.code === 'P2002') {
      const table = tableOfModel(meta.modelName);
      const target = meta.target;
      if (typeof target === 'string') return { kind: 'unique', constraint: target, table };
      const columns = Array.isArray(target) ? target.map(String) : [];
      const known = knownUnique(table, columns);
      const derived = table && columns.length > 0 ? `${table}_${columns.join('_')}_key` : undefined;
      return { kind: 'unique', constraint: known?.name ?? derived, table: table ?? known?.table, columns };
    }
    if (error.code === 'P2003') {
      const field = typeof meta.field_name === 'string' ? meta.field_name.split(' ')[0] : undefined;
      return { kind: 'foreign_key', constraint: field, table: tableOfModel(meta.modelName) };
    }
    if (error.code === 'P2010') {
      const sqlState = typeof meta.code === 'string' ? meta.code : '';
      return fromSqlState(sqlState, typeof meta.message === 'string' ? meta.message : error.message);
    }
    if (error.code === 'P2004' || error.code === 'P2011') {
      return fromSqlState(error.code === 'P2011' ? '23502' : '23514', error.message);
    }
    return null;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const sqlState = /code: \\?"?([0-9A-Z]{5})/.exec(error.message)?.[1];
    return sqlState ? fromSqlState(sqlState, error.message) : null;
  }
  return null;
}

/**
 * True when `error` is a unique violation, optionally of one named constraint from DATA_MODEL §7.
 * Services use it for idempotent creates: catch, then return the first record.
 *
 *   catch (e) { if (isUniqueViolation(e, 'orders_distributor_id_client_request_id_key')) return replay(); throw e; }
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const violation = dbConstraintViolation(error);
  if (!violation || violation.kind !== 'unique') return false;
  if (!constraint) return true;
  if (violation.constraint === constraint) return true;
  // Raw SQL reports only the columns: match them against the named constraint.
  const known = KNOWN_UNIQUE_CONSTRAINTS.find((c) => c.name === constraint);
  return (
    !!known &&
    !!violation.columns &&
    sameColumns(known.columns, violation.columns) &&
    (violation.table === undefined || violation.table === known.table)
  );
}

/** The API code for a constraint failure (DATA_MODEL §7). */
export function codeForViolation(violation: DbConstraintViolation): ErrorCode {
  switch (violation.kind) {
    case 'unique': {
      const known =
        KNOWN_UNIQUE_CONSTRAINTS.find((c) => c.name === violation.constraint) ??
        (violation.columns ? knownUnique(violation.table, violation.columns) : undefined);
      return known?.code ?? 'CONFLICT_DUPLICATE';
    }
    case 'check':
      return (violation.constraint && KNOWN_CHECK_CONSTRAINTS[violation.constraint]) || 'VALIDATION_FAILED';
    case 'foreign_key':
      return 'CONFLICT_STALE_STATE';
    case 'not_null':
      return 'INTERNAL_ERROR';
  }
}
