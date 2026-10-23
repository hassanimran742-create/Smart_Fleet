/**
 * Link tokens (CUSTOMER_PAGE §2): one implementation for the service, the public page and the tests.
 * A token is derived from the confirmation id and its link version with a server secret and never
 * stored; the database keeps only its sha256 (`delivery_confirmations.token_hash`).
 */
import { createHash, createHmac } from 'crypto';

/** The Crockford base32 alphabet, lower case. */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
/** A link token is 26 characters: 130 bits. */
export const CONFIRM_TOKEN_LENGTH = 26;
/** Input longer than this gets the not-found page without a database lookup. */
export const CONFIRM_TOKEN_MAX_INPUT = 64;
/** `CONFIRM_LINK_SECRET` must be at least this long (API_CONTRACT §3.7). */
export const CONFIRM_LINK_SECRET_MIN_LENGTH = 32;

/**
 * The link token of a confirmation's current version, derived and never stored:
 * `crockfordBase32(HMAC_SHA256(CONFIRM_LINK_SECRET, "confirm:" + confirmationId + ":" + tokenVersion))`,
 * lower case, the first 26 characters (5 bits per character, most significant bit first).
 */
export function deriveConfirmationToken(secret: string, confirmationId: string, tokenVersion: number): string {
  const mac = createHmac('sha256', secret).update(`confirm:${confirmationId}:${tokenVersion}`).digest();
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of mac) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < CONFIRM_TOKEN_LENGTH) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length === CONFIRM_TOKEN_LENGTH) break;
  }
  return out;
}

/**
 * Reads a token from a link: lower case, `i` and `l` read as `1` and `o` as `0`, every other character
 * that isn't in the alphabet stripped. Anything but exactly 26 characters after that, or input over 64
 * characters, gives null: the not-found page, with no database lookup.
 */
export function normalizeConfirmationToken(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > CONFIRM_TOKEN_MAX_INPUT) return null;
  const token = raw
    .toLowerCase()
    .replace(/[il]/g, '1')
    .replace(/o/g, '0')
    .replace(/[^0-9a-z]/g, '')
    .split('')
    .filter((ch) => CROCKFORD.includes(ch))
    .join('');
  return token.length === CONFIRM_TOKEN_LENGTH ? token : null;
}

/** `delivery_confirmations.token_hash`: the sha256 hex of the token, the only thing stored. */
export function confirmationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A development-only secret, used only when CONFIRM_LINK_SECRET is unset outside staging and production. */
const DEVELOPMENT_LINK_SECRET = 'development_only_confirm_link_secret_never_deployed';

/**
 * The secret links are signed with: env `CONFIRM_LINK_SECRET` (at least 32 characters). The boot
 * guards require it in staging and production; this throws there too, as a second line of defence.
 * Elsewhere (development, tests) a missing or short value falls back to a fixed development secret.
 */
export function confirmLinkSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.CONFIRM_LINK_SECRET ?? '';
  if (secret.length >= CONFIRM_LINK_SECRET_MIN_LENGTH) return secret;
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (node === 'production' || node === 'staging') {
    throw new Error(`CONFIRM_LINK_SECRET must be at least ${CONFIRM_LINK_SECRET_MIN_LENGTH} characters`);
  }
  return DEVELOPMENT_LINK_SECRET;
}

/**
 * The boot-guard lines for the link env values (API_CONTRACT §3.7, CNF-030), for main.ts's guards when
 * NODE_ENV is production or staging: `CONFIRM_LINK_SECRET` must be set and at least 32 characters, and
 * `PUBLIC_LINK_BASE_URL` must be set and https. Each line names the variable, never its value.
 */
export function confirmationLinkProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  const secret = env.CONFIRM_LINK_SECRET ?? '';
  if (secret.trim() === '') problems.push('CONFIRM_LINK_SECRET is not set');
  else if (secret.length < CONFIRM_LINK_SECRET_MIN_LENGTH) {
    problems.push(`CONFIRM_LINK_SECRET must be at least ${CONFIRM_LINK_SECRET_MIN_LENGTH} characters`);
  }
  const base = (env.PUBLIC_LINK_BASE_URL ?? '').trim();
  if (base === '') problems.push('PUBLIC_LINK_BASE_URL is not set');
  else if (!/^https:\/\/[^\s/?#]+/i.test(base)) problems.push('PUBLIC_LINK_BASE_URL must be an https URL');
  return problems;
}
