import { createHash } from 'crypto';
import type { Page } from '@smartfleet/shared-types';
import { RequestContext } from '../context/request-context';
import { AppError } from '../errors/app-error';
import { validationMessage } from '../errors/messages';

/** One cursor position: the sort key values of the last row, then its id (API_CONTRACT §1.3). */
export type CursorKey = readonly (string | number)[];

export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 100;

/** A date-time or date whose year Postgres can't hold: year 0, or a six-digit (signed) year. */
const UNSTORABLE_DATE = /^(?:[+-]\d{6}|0000)-\d{2}-\d{2}/;

/**
 * The tag of the list a cursor belongs to: the current request's list (path and `tab`, see
 * `listKeyOf`), hashed and shortened; outside a request (jobs, CLIs, unit tests) the empty list.
 */
function listTag(): string {
  const list = RequestContext.current()?.listKey ?? '';
  return createHash('sha256').update(list).digest('base64url').slice(0, 12);
}

/**
 * The opaque `nextCursor`: base64url of the JSON `[listTag, ...key]`. The tag ties it to the list
 * that made it, so another list (or another tab) refuses it instead of paging from its position.
 */
export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([listTag(), ...key]), 'utf8').toString('base64url');
}

/** 400 VALIDATION_FAILED on `cursor`, for a cursor whose values don't fit the list. */
export function invalidCursor(): AppError<'VALIDATION_FAILED'> {
  return new AppError('VALIDATION_FAILED', {
    fields: [{ path: 'cursor', code: 'INVALID_VALUE', message: validationMessage('INVALID_VALUE') }],
  });
}

function isKeyPart(part: unknown): part is string | number {
  if (typeof part === 'number') return Number.isFinite(part);
  return typeof part === 'string' && !UNSTORABLE_DATE.test(part);
}

/**
 * Reads a cursor made by {@link encodeCursor} for this list; `arity` is the number of key values
 * expected. Absent gives null. A malformed one, one another list (or tab) made, or one holding a
 * date Postgres can't store is 400 VALIDATION_FAILED on `cursor` (API_CONTRACT §1.3).
 */
export function decodeCursor(cursor: string | null | undefined, arity: number): (string | number)[] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === arity + 1 && parsed[0] === listTag()) {
      const key: unknown[] = parsed.slice(1);
      if (key.every(isKeyPart)) return key as (string | number)[];
    }
  } catch {
    // fall through
  }
  throw invalidCursor();
}

/**
 * A page limit for internal callers (jobs, CLIs, services): 1–100, default 30, clamped. **Never** use it
 * on an HTTP query: API_CONTRACT §1.3 refuses a `limit` outside 1–100 with 400 VALIDATION_FAILED and
 * clamps nothing, so every list route parses its query with a schema that extends `pageQuerySchema`
 * from @smartfleet/shared-validation (as `GET /audit-logs` does), whose `limit` is already 1–100.
 */
export function pageLimit(limit: number | string | null | undefined): number {
  const n = typeof limit === 'string' ? Number.parseInt(limit, 10) : limit;
  if (n === undefined || n === null || Number.isNaN(n)) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(n)));
}

/**
 * Builds a page from rows fetched with `take: limit + 1`: the extra row only says there is more.
 *
 *   const rows = await prisma.x.findMany({ …, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
 *   return toPage(rows.map(toDto), limit, (dto) => [dto.at, dto.id]);
 */
export function toPage<T>(rows: readonly T[], limit: number, keyOf: (row: T) => CursorKey): Page<T> {
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit && items.length > 0 ? encodeCursor(keyOf(items[items.length - 1])) : null;
  return { items, nextCursor };
}
