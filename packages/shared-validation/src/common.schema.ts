import { z } from 'zod';
import type { ValidationCode } from './messages';

/** Empty or blank optional fields (installed apps send `""`) count as not sent. */
const blankToUndefined = (value: unknown): unknown =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;

/** A database id. */
export const uuidSchema = z.string().trim().uuid();

/** An optional id; blank or null counts as not sent. */
export const optionalUuidSchema = z.preprocess(blankToUndefined, uuidSchema.optional());

/** An id on update: null (or blank) clears the link, absent leaves it unchanged. */
export const nullableUuidSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  uuidSchema.nullable().optional(),
);

/** The `Idempotency-Key` header (stored as `client_request_id`, a UUID column). */
export const idempotencyKeySchema = uuidSchema;

export const latSchema = z.number().finite().min(-90).max(90);
export const lngSchema = z.number().finite().min(-180).max(180);

/**
 * False for text holding a NUL character (U+0000): Postgres can't store or compare it (SQLSTATE
 * 22021), so it is refused here as INVALID_VALUE instead of reaching the database as a 500.
 */
export function hasNoNul(value: string): boolean {
  return !value.includes('\u0000');
}

/** Trimmed text of `min` to `max` characters, without a NUL character. */
export function textSchema(min: number, max: number) {
  return z.string().trim().min(min).max(max).refine(hasNoNul, 'INVALID_VALUE');
}

/** Optional trimmed text, without a NUL character; blank or null counts as not sent. */
export function optionalTextSchema(max: number, min = 1) {
  return z.preprocess(blankToUndefined, z.string().trim().min(min).max(max).refine(hasNoNul, 'INVALID_VALUE').optional());
}

/** A reason the office or a distributor must give (audit rows marked `*`), 5–300 characters. */
export const reasonSchema = textSchema(5, 300);

/** A real calendar date, `YYYY-MM-DD`. */
export const isoDateSchema = z
  .string()
  .trim()
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return (
      date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() === Number(match[2]) - 1 &&
      date.getUTCDate() === Number(match[3])
    );
  }, 'INVALID_DATE');

/** True for an instant in the years 1 to 9999 (UTC): what Postgres and Prisma both store. */
function isStorableInstant(value: string): boolean {
  const year = new Date(value).getUTCFullYear();
  return year >= 1 && year <= 9999;
}

/**
 * An ISO-8601 instant with `Z` or an offset, for example "2026-10-21T16:12:00+05:00", in the years 1
 * to 9999 (year 0000 would reach Postgres and fail there as a 500).
 */
export const isoDateTimeSchema = z.string().trim().datetime({ offset: true }).refine(isStorableInstant, 'INVALID_DATETIME');

/** A lower-cased email address. */
export const emailSchema = z.string().trim().toLowerCase().max(254).email();

/** An optional email on create: blank counts as not sent. */
export const optionalEmailSchema = z.preprocess(blankToUndefined, emailSchema.optional());

/** An email on update: blank or null clears it, absent leaves it unchanged. */
export const nullableEmailSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  emailSchema.nullable().optional(),
);

/**
 * A phone number as typed. The service normalises it with `normalizePkPhone` (shared-utils) and answers
 * with its own code (`CLIENT_PHONE_INVALID`, `AUTH_INVALID_CREDENTIALS`), so this only bounds the text.
 * A phone never reaches the database before it is normalised, so a NUL character in it is refused by
 * that code, in the documented order (API_CONTRACT §7.1), not here.
 */
export const phoneInputSchema = z.string().trim().min(1).max(32);

/** Cursor paging (API_CONTRACT §1.3): `limit` 1–100, default 30. Query strings are coerced. */
export const pageQuerySchema = z.object({
  cursor: optionalTextSchema(512),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** A query-string flag: "true"/"1" or "false"/"0". */
export const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

export interface PaisaSchemaOptions {
  /** Smallest allowed amount in paisa, inclusive; 0 by default. */
  minPaisa?: number;
  /** Largest allowed amount in paisa, inclusive. */
  maxPaisa?: number;
  /** Require whole rupees (`% 100 === 0`), as top-ups, prices, corrections and expenses do. */
  wholeRupees?: boolean;
  /** Report every problem except a missing value with this one code (prices use `PRICE_INVALID`). */
  code?: ValidationCode;
}

/**
 * A `*Paisa` request field (API_CONTRACT §1.1): an integer or a digit string, parsed exactly and
 * returned as a canonical digit string (the API turns it into a BigInt with `BigInt(value)`).
 * Problems: `REQUIRED`, `INVALID_AMOUNT`, `AMOUNT_TOO_SMALL {minPaisa}`, `AMOUNT_TOO_LARGE {maxPaisa}`
 * and `AMOUNT_NOT_WHOLE_RUPEES`.
 */
export function paisaSchema(options: PaisaSchemaOptions = {}) {
  const minPaisa = options.minPaisa ?? 0;
  return z.unknown().transform((value, ctx): string => {
    const fail = (code: ValidationCode, params?: Record<string, string>): never => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: code === 'REQUIRED' ? code : options.code ?? code, params });
      return z.NEVER;
    };
    if (value === undefined || value === null || value === '') return fail('REQUIRED');
    let amount = Number.NaN;
    if (typeof value === 'number') amount = value;
    else if (typeof value === 'string' && /^-?\d{1,16}$/.test(value.trim())) amount = Number(value.trim());
    if (!Number.isSafeInteger(amount)) return fail('INVALID_AMOUNT');
    if (amount < minPaisa) return fail('AMOUNT_TOO_SMALL', { minPaisa: String(minPaisa) });
    if (options.maxPaisa !== undefined && amount > options.maxPaisa) {
      return fail('AMOUNT_TOO_LARGE', { maxPaisa: String(options.maxPaisa) });
    }
    if (options.wholeRupees && amount % 100 !== 0) return fail('AMOUNT_NOT_WHOLE_RUPEES');
    return String(amount);
  });
}

/** An optional `*Paisa` field: absent, null or blank counts as not sent. */
export function optionalPaisaSchema(options: PaisaSchemaOptions = {}) {
  return z.preprocess(blankToUndefined, paisaSchema(options).optional());
}

/** A positive whole-rupee amount (at least Rs 1), with an optional upper limit. */
export function rupeeAmountSchema(maxPaisa?: number) {
  return paisaSchema({ minPaisa: 100, maxPaisa, wholeRupees: true });
}

/** Adds `NOTE_REQUIRED` on `note` when the reason needs one (`OTHER` always does, API_CONTRACT §1.5). */
export function requireNoteFor(reasons: readonly string[], min: number) {
  return (value: { reasonCode: string; note?: string }, ctx: z.RefinementCtx): void => {
    if (reasons.includes(value.reasonCode) && !value.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'NOTE_REQUIRED', params: { min } });
    }
  };
}

/** Adds `INVALID_LOCATION` when only one of `lat` and `lng` is sent. */
export function requireBothCoordinates(value: { lat?: number; lng?: number }, ctx: z.RefinementCtx): void {
  if ((value.lat === undefined) !== (value.lng === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.lat === undefined ? 'lat' : 'lng'],
      message: 'INVALID_LOCATION',
    });
  }
}
