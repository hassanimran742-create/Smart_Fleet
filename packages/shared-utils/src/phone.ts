import { toAsciiDigits } from './digits';

/** Characters people put inside a phone number: spaces, dashes, dots and brackets. */
const PHONE_DECORATION = /[\s\-.() ]/g;
/** A Pakistani mobile without its trunk zero: 3XX XXXXXXX. */
const PK_MOBILE_NATIONAL = /^3\d{9}$/;

/**
 * Normalises a Pakistani mobile number to E.164 `+923XXXXXXXXX`, or returns null when it isn't one.
 *
 * Accepts the forms people write: `0300 1234567`, `300 1234567`, `+92 300 1234567`, `92 300 1234567`,
 * `0092 300 1234567`, with spaces, dashes, dots or brackets, in ASCII, Arabic-Indic or Urdu digits.
 * A stray trunk zero after the country code (`+92 0300 …`) is dropped. Letters, other country codes
 * and wrong lengths give null.
 */
export function normalizePkPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = toAsciiDigits(raw).trim().replace(PHONE_DECORATION, '');
  const hasPlus = compact.charAt(0) === '+';
  const digits = hasPlus ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;

  let national: string;
  if (hasPlus) {
    if (!digits.startsWith('92')) return null;
    national = digits.slice(2);
  } else if (digits.startsWith('0092')) {
    national = digits.slice(4);
  } else if (digits.startsWith('92')) {
    national = digits.slice(2);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }
  if (national.length === 11 && national.charAt(0) === '0') national = national.slice(1);
  return PK_MOBILE_NATIONAL.test(national) ? `+92${national}` : null;
}

/** True when {@link normalizePkPhone} accepts the number. */
export function isPkMobile(raw: string | null | undefined): boolean {
  return normalizePkPhone(raw) !== null;
}

/**
 * How {@link formatPkPhone} writes a number: `local` "0300 1234567" (the shop and driver apps and the
 * customer page), `international` "+92 300 1234567" (the website) or `compact` "03001234567" (SMS text).
 */
export type PkPhoneStyle = 'local' | 'international' | 'compact';

/**
 * The one phone formatter (API_CONTRACT §1.1): "0300 1234567" (`local`, the default),
 * "+92 300 1234567" (`international`) or "03001234567" (`compact`). A number that isn't a Pakistani
 * mobile is returned as stored, trimmed. `tel:` links use the E.164 value itself.
 */
export function formatPkPhone(phone: string | null | undefined, style: PkPhoneStyle = 'local'): string {
  if (typeof phone !== 'string') return '';
  const e164 = normalizePkPhone(phone);
  if (!e164) return phone.trim();
  const national = e164.slice(3);
  const operator = national.slice(0, 3);
  const subscriber = national.slice(3);
  if (style === 'international') return `+92 ${operator} ${subscriber}`;
  if (style === 'compact') return `0${national}`;
  return `0${operator} ${subscriber}`;
}

/** "+923001234567" → "+923*****67". */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return e164;
  return `${e164.slice(0, 4)}*****${e164.slice(-2)}`;
}
