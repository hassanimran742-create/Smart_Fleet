/**
 * A customer link's path part: "/c/" in any letter case (Express routes ignore case, so "/C/<TOKEN>" opens
 * the page too), any number of slashes, then the token in any form the page accepts (capitals, separators;
 * CUSTOMER_PAGE §2) up to the next "/", "?" or "#". [review23 security-04]
 */
const CONFIRM_LINK = /\/c\/+[^/?#]+/gi;

/**
 * Hides the token of a customer confirmation link (`/c/<token>`, CUSTOMER_PAGE §5) in a path or URL,
 * for the error envelope, the logs and Sentry: `/c/k3j…`, `/C/K3J…` and `/c/k3j-…` become `/c/[token]`.
 */
export function redactPath(path: string): string {
  return path.replace(CONFIRM_LINK, '/c/[token]');
}

/** The request path for an error envelope: no query string, confirmation tokens redacted. */
export function envelopePath(originalUrl: string | undefined): string {
  const path = (originalUrl ?? '').split(/[?#]/)[0] || '/';
  return redactPath(path);
}
