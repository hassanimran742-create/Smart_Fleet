import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_HTTP, isErrorCode, type ErrorCode, type FieldError } from '@smartfleet/shared-types';
import { primaryErrorCode, toFieldIssues } from '@smartfleet/shared-validation';
import type { ZodError } from 'zod';
import { AppError } from './app-error';
import { validationMessage } from './messages';
import { codeForViolation, dbConstraintViolation } from './prisma-errors';

/** How loudly the filter logs a mapped error. */
export type ErrorLogLevel = 'error' | 'warn' | 'debug';

export interface MappedError {
  status: number;
  code: ErrorCode;
  details: Record<string, unknown>;
  log: ErrorLogLevel;
  /** A safe fact for the log line (a constraint or Prisma code); never row values. */
  note?: string;
}

function mapped(
  code: ErrorCode,
  details: Record<string, unknown> = {},
  log?: ErrorLogLevel,
  note?: string,
): MappedError {
  const status = ERROR_HTTP[code];
  return { status, code, details, log: log ?? (status >= 500 ? 'error' : 'debug'), ...(note ? { note } : {}) };
}

/** Field problems with English filled in, from zod issues. */
export function fieldErrorsFromZod(error: ZodError): FieldError[] {
  return toFieldIssues(error).map((issue) => ({
    path: issue.path,
    code: issue.code,
    message: validationMessage(issue.code, issue.params),
    ...(issue.params ? { params: issue.params } : {}),
  }));
}

function isZodError(error: unknown): error is ZodError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

/** The generic code of a framework or legacy HttpException, by its status. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'AUTH_TOKEN_INVALID';
    case 403:
      return 'PERMISSION_DENIED';
    case 404:
    case 405:
    case 410:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT_STALE_STATE';
    case 415:
      return 'FILE_TYPE_NOT_ALLOWED';
    case 426:
      return 'APP_UPDATE_REQUIRED';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
  }
}

function fromHttpException(error: HttpException): MappedError {
  const status = error.getStatus();
  const body = error.getResponse();
  // A body that already names a catalogue code (thrown by hand as `new HttpException({ code, details }, status)`).
  if (typeof body === 'object' && body !== null && isErrorCode((body as { code?: unknown }).code)) {
    const code = (body as { code: ErrorCode }).code;
    const details = (body as { details?: unknown }).details;
    return mapped(code, typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {});
  }
  const code = codeForStatus(status);
  // Framework and legacy text ("Cannot GET /x", "Order not found") never reaches the client.
  if (code === 'VALIDATION_FAILED') return mapped(code, { fields: [] });
  if (code === 'RATE_LIMITED') return mapped(code, { minutes: 1 });
  return mapped(code, {}, status >= 500 ? 'error' : 'debug');
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028']);
const STALE_SQLSTATES = new Set(['40001', '40P01']);
/** Prisma's own refusals of a value that doesn't fit its column: too long (P2000), too big for 64 bits (P2033). */
const VALUE_PRISMA_CODES = new Set(['P2000', 'P2033']);

/**
 * A value the database can't store or compare, so the client's input, not a server fault (API_CONTRACT
 * §2.2): SQLSTATE class 22, "data exception" (a NUL character 22021, an untranslatable character
 * 22P05, a date out of range 22008, a number out of range 22003, text too long 22001), from raw SQL
 * (P2010) or the model API, and Prisma's "Could not convert argument value" (a date it can't send).
 * The services' own checks should refuse these first; this is the safety net, so it logs a warning.
 */
function dataException(error: unknown): MappedError | null {
  let sqlState: string | undefined;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (VALUE_PRISMA_CODES.has(error.code)) return mapped('VALIDATION_FAILED', { fields: [] }, 'warn', error.code);
    if (error.code === 'P2010') sqlState = String((error.meta as Record<string, unknown> | undefined)?.code ?? '');
  } else if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    if (error.message.includes('Could not convert argument value')) {
      return mapped('VALIDATION_FAILED', { fields: [] }, 'warn', 'Prisma argument conversion');
    }
    sqlState = /code: \\?"?([0-9A-Z]{5})/.exec(error.message)?.[1];
  }
  if (!sqlState || !sqlState.startsWith('22')) return null;
  // A malformed id is answered like an unknown record (§2.2).
  if (sqlState === '22P02') return mapped('NOT_FOUND');
  return mapped('VALIDATION_FAILED', { fields: [] }, 'warn', `SQLSTATE ${sqlState}`);
}

function fromPrisma(error: unknown): MappedError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') return mapped('NOT_FOUND');
    // Malformed column data in a lookup, in practice a path id that isn't a UUID.
    if (error.code === 'P2023') return mapped('NOT_FOUND');
    if (error.code === 'P2034') return mapped('CONFLICT_STALE_STATE', {}, 'warn', error.code);
    if (UNAVAILABLE_PRISMA_CODES.has(error.code)) return mapped('SERVICE_UNAVAILABLE', {}, 'error', error.code);
    if (error.code === 'P2010') {
      const sqlState = String((error.meta as Record<string, unknown> | undefined)?.code ?? '');
      if (STALE_SQLSTATES.has(sqlState)) return mapped('CONFLICT_STALE_STATE', {}, 'warn', `SQLSTATE ${sqlState}`);
      if (sqlState === '22P02') return mapped('NOT_FOUND');
      if (sqlState === '57014') return mapped('SERVICE_UNAVAILABLE', {}, 'error', `SQLSTATE ${sqlState}`);
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return mapped('SERVICE_UNAVAILABLE', {}, 'error');
  const badValue = dataException(error);
  if (badValue) return badValue;

  const violation = dbConstraintViolation(error);
  if (violation) {
    const code = codeForViolation(violation);
    const details = code === 'VALIDATION_FAILED' ? { fields: [] } : {};
    const note = `${violation.kind} ${violation.constraint ?? violation.columns?.join(',') ?? 'constraint'}`;
    // A mapped constraint means a service skipped its own check: worth a warning, not a page.
    return mapped(code, details, ERROR_HTTP[code] >= 500 ? 'error' : 'warn', note);
  }
  return null;
}

/**
 * A refusal of the JSON or form body parser, which runs before Nest: an http-errors object with
 * `expose` set and a 4xx `status` ('request.aborted' when the client dropped the connection mid-body,
 * 'entity.too.large' over the 100 KB limit, 'charset.unsupported', 'encoding.unsupported', a gzip body
 * that isn't gzip). Nest turns only invalid JSON (a SyntaxError) into a 400 itself. These are the
 * client's input, not server faults: VALIDATION_FAILED, logged at debug, never sent to Sentry (an
 * aborted request can't be answered anyway).
 */
function fromBodyParser(error: unknown): MappedError | null {
  if (!(error instanceof Error)) return null;
  const { expose, status, type } = error as Error & { expose?: unknown; status?: unknown; type?: unknown };
  if (expose !== true || typeof status !== 'number' || status < 400 || status >= 500) return null;
  return mapped('VALIDATION_FAILED', { fields: [] }, 'debug', typeof type === 'string' ? type : `HTTP ${status}`);
}

/**
 * Maps anything thrown by a request to its API error (API_CONTRACT §2.2):
 * - `AppError` keeps its code and details;
 * - zod errors become VALIDATION_FAILED (or the promoted code, such as AMOUNT_NOT_WHOLE_RUPEES) with `details.fields`;
 * - Prisma errors follow DATA_MODEL §7 (P2002 by constraint, P2025 NOT_FOUND, CHECK 23514 on `distributors_balance_chk`
 *   WALLET_INSUFFICIENT_BALANCE); a value the database can't hold (SQLSTATE class 22) is VALIDATION_FAILED;
 * - other HttpExceptions map by status, without their text;
 * - a body the body parser refused (too large, aborted, unknown charset) is VALIDATION_FAILED;
 * - anything else is INTERNAL_ERROR, and its message stays in the logs.
 */
export function toApiError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return mapped(error.code, error.details as Record<string, unknown>);
  }
  if (isZodError(error)) {
    const issues = toFieldIssues(error);
    return mapped(primaryErrorCode(issues), { fields: fieldErrorsFromZod(error) });
  }
  if (error instanceof HttpException) return fromHttpException(error);
  return fromPrisma(error) ?? fromBodyParser(error) ?? mapped('INTERNAL_ERROR', {}, 'error');
}
