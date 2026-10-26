/**
 * HTTP headers of the wire contract (API_CONTRACT §1.2). Express lower-cases incoming header names,
 * so read them with `req.headers[REQUEST_HEADER.x]` and write them with the `RESPONSE_HEADER` names.
 */
export const REQUEST_HEADER = {
  requestId: 'x-request-id',
  appVariant: 'x-app-variant',
  appVersion: 'x-app-version',
  idempotencyKey: 'idempotency-key',
  userAgent: 'user-agent',
} as const;

export const RESPONSE_HEADER = {
  requestId: 'X-Request-Id',
  idempotentReplay: 'Idempotent-Replay',
  alreadyApplied: 'X-Already-Applied',
  featureDisabled: 'X-Feature-Disabled',
  retryAfter: 'Retry-After',
} as const;

/** Response headers the apps may read across origins (CORS `exposedHeaders`). */
export const EXPOSED_HEADERS: readonly string[] = [
  RESPONSE_HEADER.requestId,
  RESPONSE_HEADER.idempotentReplay,
  RESPONSE_HEADER.alreadyApplied,
  RESPONSE_HEADER.featureDisabled,
];

/** First value of a header that may arrive more than once. */
export function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
