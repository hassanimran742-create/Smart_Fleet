import axios from 'axios';
import {
  isErrorCode,
  type AppErrorCode,
  type ErrorCode,
  type ErrorDetails,
  type FieldError,
} from '@smartfleet/shared-types';
import { toMessageParams } from '@smartfleet/shared-utils';
import i18n, { translateDynamic } from '../i18n';

/**
 * Every failure, normalised (UX_ADMIN §1.7). `code` is a stable code from @smartfleet/shared-types, or a
 * client-only one: NETWORK_OFFLINE, NETWORK_TIMEOUT, or UNKNOWN when the server sent no catalogue code
 * (an older route) or the error isn't from the API at all.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: AppErrorCode,
    /** The HTTP status, or null when the server never answered. */
    readonly status: number | null,
    /** The envelope's `details` (API_CONTRACT §2.1); `{}` when there are none. */
    readonly details: Readonly<Record<string, unknown>>,
    /** The server's plain-English `message`, when it sent one. Never shown for a 5xx. */
    readonly serverMessage: string | null,
    /** The request's `X-Request-Id`, which people quote as "Reference: 7f3a2c". */
    readonly requestId: string | null,
    options?: { cause?: unknown },
  ) {
    super(serverMessage ?? code, options);
  }

  /** True when this is one of the given codes. For typed `details` use {@link errorDetails}. */
  is(...codes: AppErrorCode[]): boolean {
    return codes.includes(this.code);
  }

  /** True when the request never got an answer: offline, or timed out. */
  get isNetwork(): boolean {
    return this.code === 'NETWORK_OFFLINE' || this.code === 'NETWORK_TIMEOUT';
  }

  /** The field problems of a `VALIDATION_FAILED` (or promoted) error: `details.fields`. */
  get fields(): FieldError[] {
    const fields = this.details.fields;
    return Array.isArray(fields) ? fields.filter(isFieldError) : [];
  }
}

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FieldError).path === 'string' &&
    typeof (value as FieldError).code === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const getter = (headers as { get?: (key: string) => unknown }).get;
  const value =
    typeof getter === 'function' ? getter.call(headers, name) : (headers as Record<string, unknown>)[name.toLowerCase()];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function serverMessageOf(data: Record<string, unknown>): string | null {
  const message = data.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

/** Normalises anything thrown by a request (or by our own code) into an {@link ApiError}. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const sentId = headerValue(error.config?.headers, 'X-Request-Id');
    const response = error.response;
    if (!response) {
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      const cancelled = error.code === 'ERR_CANCELED';
      const code: AppErrorCode = timedOut ? 'NETWORK_TIMEOUT' : cancelled ? 'UNKNOWN' : 'NETWORK_OFFLINE';
      return new ApiError(code, null, {}, null, sentId, { cause: error });
    }

    const data: Record<string, unknown> = isRecord(response.data) ? response.data : {};
    const status = response.status;
    const requestId =
      (typeof data.requestId === 'string' && data.requestId) || headerValue(response.headers, 'X-Request-Id') || sentId;
    const details = isRecord(data.details) ? data.details : {};
    if (isErrorCode(data.code)) {
      return new ApiError(data.code, status, details, status >= 500 ? null : serverMessageOf(data), requestId, {
        cause: error,
      });
    }
    // An older route without a catalogue code. Never show a server's raw 5xx text (it can be internal).
    const fallback: AppErrorCode = status === 503 ? 'SERVICE_UNAVAILABLE' : status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN';
    return new ApiError(fallback, status, details, status >= 500 ? null : serverMessageOf(data), requestId, {
      cause: error,
    });
  }

  return new ApiError('UNKNOWN', null, {}, null, null, { cause: error });
}

/** The documented `details` of an error with code `C`, or null when it has another code. */
export function errorDetails<C extends ErrorCode>(error: unknown, code: C): ErrorDetails<C> | null {
  const e = toApiError(error);
  return e.code === code ? (e.details as ErrorDetails<C>) : null;
}

/**
 * The sentence to show for an error: `errors:<CODE>` with the details as params (a `*Paisa` key is
 * formatted with `formatRs`), then the server's message, then "Something went wrong" (`errors:UNKNOWN`).
 */
export function messageFor(error: unknown): string {
  const e = toApiError(error);
  if (e.code !== 'UNKNOWN') {
    const text = translateDynamic(`errors:${e.code}`, toMessageParams(e.details));
    if (text) return text;
  }
  return e.serverMessage ?? i18n.t('errors:UNKNOWN');
}

/** The message for one field problem: `validation:<CODE>` with its params, else the server's text. */
export function fieldMessage(field: Pick<FieldError, 'code' | 'message' | 'params'>): string {
  return translateDynamic(`validation:${field.code}`, toMessageParams(field.params)) ?? field.message;
}

/** `details.fields` as `{ path: message }`, for placing server errors under their fields. */
export function fieldMessages(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of toApiError(error).fields) {
    if (!(field.path in out)) out[field.path] = fieldMessage(field);
  }
  return out;
}

/** "7f3a2c": the short reference people read out, taken from the request ID. */
export function errorReference(error: unknown): string | null {
  const id = toApiError(error).requestId;
  if (!id) return null;
  const compact = id.replace(/[^0-9a-zA-Z]/g, '');
  return compact.slice(0, 6).toLowerCase() || null;
}
