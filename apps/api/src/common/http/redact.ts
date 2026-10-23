const CONFIRM_LINK = /\/c\/[^/?#]+/g;

/**
 * Hides the token of a customer confirmation link (`/c/<token>`, CUSTOMER_PAGE §5) in a path or URL,
 * for the error envelope, the logs and Sentry: `/c/k3j…` becomes `/c/[token]`.
 */
export function redactPath(path: string): string {
  return path.replace(CONFIRM_LINK, '/c/[token]');
}

/** The request path for an error envelope: no query string, confirmation tokens redacted. */
export function envelopePath(originalUrl: string | undefined): string {
  const path = (originalUrl ?? '').split(/[?#]/)[0] || '/';
  return redactPath(path);
}
