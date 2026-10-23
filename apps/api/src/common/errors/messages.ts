import { ERROR_HTTP, ERROR_MESSAGE_EN, type ErrorCode } from '@smartfleet/shared-types';
import { renderMessage } from '@smartfleet/shared-utils';
import { VALIDATION_MESSAGE_EN, type ValidationCode } from '@smartfleet/shared-validation';

const UNFILLED = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/;

/** True when a rendered template still shows a `{{param}}` its details did not fill. */
export function hasUnfilledParams(text: string): boolean {
  return UNFILLED.test(text);
}

/**
 * A parameter-free code with the same HTTP status family, used for the English `message` when a
 * template's details are missing (a safety-net mapping, or a caller that skipped them). The `code`
 * of the error never changes; only the fallback sentence does.
 */
function genericCodeFor(status: number): ErrorCode {
  if (status >= 500) return status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
  if (status === 429) return 'SERVICE_UNAVAILABLE';
  if (status === 401) return 'AUTH_TOKEN_INVALID';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT_STALE_STATE';
  return 'VALIDATION_FAILED';
}

/**
 * The envelope's `message` (API_CONTRACT §2.1): `ERROR_MESSAGE_EN[code]` filled from `details`, with
 * a `*Paisa` key formatted by `formatRs` and its suffix dropped. It is always one plain-English
 * sentence: when a placeholder can't be filled, the generic sentence of the status is used instead.
 */
export function errorMessage(code: ErrorCode, details?: Record<string, unknown> | null): string {
  const rendered = renderMessage(ERROR_MESSAGE_EN[code], details ?? undefined);
  if (!hasUnfilledParams(rendered)) return rendered;
  return ERROR_MESSAGE_EN[genericCodeFor(ERROR_HTTP[code])];
}

/** English for one field problem, with its parameters filled; never shows a raw placeholder. */
export function validationMessage(code: ValidationCode, params?: Record<string, unknown> | null): string {
  const rendered = renderMessage(VALIDATION_MESSAGE_EN[code], params ?? undefined);
  return hasUnfilledParams(rendered) ? VALIDATION_MESSAGE_EN.INVALID_VALUE : rendered;
}
