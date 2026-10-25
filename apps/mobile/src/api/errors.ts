import axios from 'axios';
import type { TFunction } from 'i18next';
import {
  CLIENT_ERROR_CODES,
  CLIENT_ERROR_MESSAGE_EN,
  ERROR_HTTP,
  ERROR_MESSAGE_EN,
  isErrorCode,
  type AppErrorCode,
  type ClientErrorCode,
} from '@smartfleet/shared-types';
import { toMessageParams } from '@smartfleet/shared-utils';
import { isValidationCode } from '@smartfleet/shared-validation';
import i18n from '../i18n';

/** A server code, a client-only code, or a code this build doesn't know yet (newer server). */
export type ApiErrorCode = AppErrorCode | (string & {});

/** The old axios-shaped response that older screens read (`e.response.data.message`). */
export interface LegacyErrorResponse {
  status: number;
  data: unknown;
  headers: Record<string, unknown>;
}

export interface ApiErrorInit {
  status: number | null;
  code: ApiErrorCode;
  message?: string;
  details?: Record<string, unknown>;
  requestId?: string | null;
  retryable?: boolean;
  serverMessage?: string | null;
  response?: LegacyErrorResponse;
}

/**
 * Every failed call, normalised (UX_MOBILE §3.1): `code` is a stable value to translate with
 * `errors.<CODE>`; the phone never shows raw server text, a stack trace or an HTTP status.
 */
export class ApiError extends Error {
  readonly isApiError = true;
  /** The HTTP status, or null when there was no response. */
  readonly status: number | null;
  readonly code: ApiErrorCode;
  /** The envelope's `details` (template parameters, field errors). */
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;
  /** True for no response and 5xx: a retry can work. */
  readonly retryable: boolean;
  /** The server's plain-English `message`, used only when this build doesn't know the code. */
  readonly serverMessage: string | null;
  /** @deprecated For older screens only; read `code` and `details` instead. */
  readonly response?: LegacyErrorResponse;

  constructor(init: ApiErrorInit) {
    super(init.message ?? englishFor(init.code, init.serverMessage ?? null));
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
    this.retryable = init.retryable ?? (init.status === null || init.status >= 500);
    this.serverMessage = init.serverMessage ?? null;
    this.response = init.response;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof ApiError ||
    (typeof value === 'object' && value !== null && (value as { isApiError?: unknown }).isApiError === true)
  );
}

const CLIENT_CODES: readonly string[] = CLIENT_ERROR_CODES;

/** True for a code with an `errors.<CODE>` key in this build. */
export function isAppErrorCode(code: unknown): code is AppErrorCode {
  return isErrorCode(code) || (typeof code === 'string' && CLIENT_CODES.includes(code));
}

function englishFor(code: string, serverMessage: string | null): string {
  if (isErrorCode(code)) return serverMessage ?? ERROR_MESSAGE_EN[code];
  if ((CLIENT_CODES as readonly string[]).includes(code)) return CLIENT_ERROR_MESSAGE_EN[code as ClientErrorCode];
  return serverMessage ?? CLIENT_ERROR_MESSAGE_EN.UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const getter = (headers as { get?: (n: string) => unknown }).get;
  const value =
    typeof getter === 'function'
      ? getter.call(headers, name)
      : (headers as Record<string, unknown>)[name.toLowerCase()] ?? (headers as Record<string, unknown>)[name];
  return typeof value === 'string' && value ? value : null;
}

/** Normalises an HTTP error reply (the API_CONTRACT §2.1 envelope, or an older Nest body). */
export function apiErrorFromHttp(
  status: number,
  body: unknown,
  headers?: unknown,
  sentRequestId?: string | null,
): ApiError {
  const envelope = isRecord(body) ? body : {};
  const rawCode = typeof envelope.code === 'string' && envelope.code ? envelope.code : null;
  const legacyCode = typeof envelope.error === 'string' && isErrorCode(envelope.error) ? envelope.error : null;
  let code: ApiErrorCode = rawCode ?? legacyCode ?? (status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN');
  if (code === 'UNKNOWN' && status === 426) code = 'APP_UPDATE_REQUIRED';
  const serverMessage = typeof envelope.message === 'string' && envelope.message ? envelope.message : null;
  const requestId =
    (typeof envelope.requestId === 'string' && envelope.requestId) ||
    headerValue(headers, 'x-request-id') ||
    sentRequestId ||
    null;
  return new ApiError({
    status,
    code,
    details: isRecord(envelope.details) ? envelope.details : {},
    requestId,
    retryable: status >= 500,
    serverMessage,
    response: { status, data: body, headers: isRecord(headers) ? headers : {} },
  });
}

/** A failure with no response. */
export function networkError(kind: 'NETWORK_TIMEOUT' | 'NETWORK_OFFLINE', requestId?: string | null): ApiError {
  return new ApiError({ status: null, code: kind, requestId: requestId ?? null, retryable: true });
}

/**
 * True when a request got no answer (`NETWORK_OFFLINE` or `NETWORK_TIMEOUT`): no signal, or our server
 * is down. The "No connection" banner already says so, so screens show the outcome ("Not sent. Tap
 * again.", "Nothing saved yet.") instead of a second network message.
 */
/**
 * A 426: this build is below `app.minVersion` (APP_UPDATE_REQUIRED), or a call without this build's
 * headers was taken for the 0.1.0 JS (APP_RESTART_TO_UPDATE, which only the 0.1.0 JS should ever get).
 * Either way the update gate takes over (UX_MOBILE §3.6; review23 contract-compat-02).
 */
export function isUpdateRefusal(error: { code: string } | null | undefined): boolean {
  return error?.code === 'APP_UPDATE_REQUIRED' || error?.code === 'APP_RESTART_TO_UPDATE';
}

export function isNetworkError(error: unknown): boolean {
  if (error === null || error === undefined || typeof error === 'string') return false;
  const code = toApiError(error).code;
  return code === 'NETWORK_OFFLINE' || code === 'NETWORK_TIMEOUT';
}

/**
 * Turns anything thrown into an ApiError: axios errors, fetch replies already normalised, and plain
 * errors (shown as `UNKNOWN`, never with their raw text).
 */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  // A request cancelled on purpose (React Query unmount) is not a network failure.
  if (axios.isCancel(error)) return new ApiError({ status: null, code: 'UNKNOWN', retryable: false });
  if (axios.isAxiosError(error)) {
    const sentId = headerValue(error.config?.headers, 'X-Request-Id');
    if (error.response) {
      return apiErrorFromHttp(error.response.status, error.response.data, error.response.headers, sentId);
    }
    const timedOut =
      error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /timeout/i.test(error.message ?? '');
    return networkError(timedOut ? 'NETWORK_TIMEOUT' : 'NETWORK_OFFLINE', sentId);
  }
  return new ApiError({ status: null, code: 'UNKNOWN', retryable: false });
}

/**
 * The words for an error (UX_MOBILE §3.2): `errors.<CODE>` with `details` as parameters, where every
 * `*Paisa` value is formatted by `formatRs` and loses its suffix. A code this build doesn't know
 * shows the server's plain-English message, then `errors.UNKNOWN`. A string is shown as it is.
 */
export function toUserMessage(error: unknown, t: TFunction = i18n.t): string {
  if (typeof error === 'string') return error;
  const e = toApiError(error);
  if (isAppErrorCode(e.code)) {
    // `replace` keeps detail keys such as `count` from being read as i18next options.
    return t(`errors.${e.code}`, { replace: toMessageParams(e.details) });
  }
  return e.serverMessage ?? t('errors.UNKNOWN');
}

export type ErrorAction = 'ADD_MONEY' | 'CALL_OFFICE' | 'SIGN_IN' | 'UPDATE_APP' | 'RETRY';

/**
 * Codes whose fix is a call to the office (UX_MOBILE §3.2), plus the three whose English already says
 * "Call the office" (AUTH_ROLE_LOCKED, DISTRIBUTOR_NOT_ACTIVE, TOPUP_ACCOUNT_NOT_CONFIGURED).
 */
const CALL_OFFICE_CODES: ReadonlySet<string> = new Set([
  'AUTH_ACCOUNT_NOT_ACTIVE',
  'AUTH_ROLE_LOCKED',
  'DISTRIBUTOR_NOT_ACTIVE',
  'ORDER_HANDOVER_STARTED',
  'SCAN_NOT_ON_YOUR_VAN',
  'SCAN_CYLINDER_BLOCKED',
  'TOPUP_ACCOUNT_NOT_CONFIGURED',
]);

function statusOfCode(code: string, fallback: number | null): number | null {
  return isErrorCode(code) ? ERROR_HTTP[code] : fallback;
}

/**
 * The extra button an error needs (UX_MOBILE §3.2): ADD_MONEY, CALL_OFFICE, SIGN_IN, UPDATE_APP or
 * RETRY, or null for none. Takes an error or a bare code.
 */
export function errorAction(input: unknown): ErrorAction | null {
  let code: string;
  let status: number | null;
  let retryable: boolean;
  if (typeof input === 'string') {
    code = input;
    status = statusOfCode(input, null);
    retryable = input === 'NETWORK_OFFLINE' || input === 'NETWORK_TIMEOUT' || (status !== null && status >= 500);
  } else {
    const e = toApiError(input);
    code = e.code;
    status = statusOfCode(e.code, e.status);
    retryable = e.retryable;
  }
  if (code === 'WALLET_INSUFFICIENT_BALANCE') return 'ADD_MONEY';
  if (code.endsWith('_NO_STORE') || CALL_OFFICE_CODES.has(code)) return 'CALL_OFFICE';
  if (isUpdateRefusal({ code })) return 'UPDATE_APP';
  if (code.startsWith('AUTH_') && status === 401) return 'SIGN_IN';
  if (retryable) return 'RETRY';
  return null;
}

interface WireFieldError {
  path?: unknown;
  code?: unknown;
  message?: unknown;
  params?: unknown;
}

/**
 * Field messages of a `VALIDATION_FAILED` error, by body path ("lines.0.fullCount"): the
 * `validation.<CODE>` text with its parameters, or the server's text for an unknown code.
 */
export function fieldErrorsOf(error: unknown, t: TFunction = i18n.t): Record<string, string> {
  const fields = toApiError(error).details.fields;
  if (!Array.isArray(fields)) return {};
  const out: Record<string, string> = {};
  for (const raw of fields as WireFieldError[]) {
    if (!raw || typeof raw.path !== 'string' || raw.path in out) continue;
    if (isValidationCode(raw.code)) {
      out[raw.path] = t(`validation.${raw.code}`, {
        replace: toMessageParams(isRecord(raw.params) ? raw.params : undefined),
      });
    } else if (typeof raw.message === 'string' && raw.message) {
      out[raw.path] = raw.message;
    } else {
      out[raw.path] = t('errors.VALIDATION_FAILED');
    }
  }
  return out;
}
