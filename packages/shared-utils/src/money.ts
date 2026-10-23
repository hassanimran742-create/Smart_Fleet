import { toAsciiDigits } from './digits';

/**
 * @deprecated A paisa amount as a JS number, used only by the legacy helpers below. The wire sends
 * paisa as a digit string (`Paisa` in @smartfleet/shared-types); new code passes it to
 * {@link formatRs} or {@link toPaisa}.
 */
export type Paisa = number;

/** Anything that holds an integer paisa amount: a BigInt (API), a number, or a digit string (JSON). */
export type PaisaLike = bigint | number | string;

/** U+2212, the minus sign used for money out ("−Rs 330"). */
export const MINUS_SIGN = '−';

/** Shown for a missing amount. */
export const MISSING_AMOUNT = '—';

const PAISA_PER_RUPEE = 100;
const SIGNED_DIGITS = /^-?\d+$/;

/** Splits an integer paisa value into sign and digits without losing precision. */
function splitPaisa(value: PaisaLike): { negative: boolean; digits: string } {
  let text: string;
  if (typeof value === 'bigint') {
    text = value.toString();
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Paisa must be a whole number, got ${value}`);
    text = String(value);
  } else if (typeof value === 'string' && SIGNED_DIGITS.test(value)) {
    text = value;
  } else {
    throw new TypeError(`Paisa must be an integer or a digit string, got ${JSON.stringify(value)}`);
  }
  const negative = text.charAt(0) === '-';
  const digits = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, '');
  return { negative: negative && digits !== '0', digits };
}

/** "1234567" → "1,234,567". */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatRsOptions {
  /**
   * `auto` (default) marks only money out ("−Rs 330"); `always` also marks money in ("+Rs 5,000");
   * `none` prints the amount without a sign. Zero never has a sign.
   */
  sign?: 'auto' | 'always' | 'none';
}

/**
 * The one money formatter (API_CONTRACT §1.1): integer paisa to "Rs 3,450", "Rs 3,450.50",
 * "−Rs 330" (U+2212) or, with `sign: 'always'`, "+Rs 5,000". It is exact for any size and needs no
 * Intl. A missing amount (null or undefined) prints "—". Malformed input throws.
 */
export function formatRs(paisa: PaisaLike | null | undefined, options: FormatRsOptions = {}): string {
  if (paisa === null || paisa === undefined) return MISSING_AMOUNT;
  const { negative, digits } = splitPaisa(paisa);
  const padded = digits.padStart(3, '0');
  const rupees = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-2);
  const body = `Rs ${groupThousands(rupees)}${fraction === '00' ? '' : `.${fraction}`}`;
  const sign = options.sign ?? 'auto';
  if (sign === 'none' || digits === '0') return body;
  if (negative) return `${MINUS_SIGN}${body}`;
  return sign === 'always' ? `+${body}` : body;
}

/**
 * Converts a paisa value from the wire (a digit string) into a JS number, asserting that it is a
 * safe integer (UX_MOBILE §3.7). Throws a TypeError for malformed input and a RangeError when the
 * amount is too large for a number.
 */
export function toPaisa(value: PaisaLike): number {
  const { negative, digits } = splitPaisa(value);
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Paisa amount ${value} is too large for a number`);
  return negative ? -amount : amount;
}

/** True when the amount is whole rupees (`paisa % 100 === 0`). */
export function isWholeRupees(paisa: PaisaLike): boolean {
  const { digits } = splitPaisa(paisa);
  return digits === '0' || digits.endsWith('00');
}

/** Spaces and thousands separators people type or paste into an amount. */
const AMOUNT_SEPARATORS = /[\s,  ٬]/g;
const RUPEE_PREFIX = /^(rs\.?|pkr)/i;

/**
 * Reads a rupee amount typed by a person and returns it in paisa: `parseRupeesInput("5,000")` is
 * 500000. It accepts digits (ASCII, Arabic-Indic or Urdu), commas, spaces and a leading "Rs".
 * Anything else, including a decimal point, gives null: amounts are typed in whole rupees.
 */
export function parseRupeesInput(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  const cleaned = toAsciiDigits(text).trim().replace(RUPEE_PREFIX, '').replace(AMOUNT_SEPARATORS, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const rupees = Number(cleaned);
  const paisa = rupees * PAISA_PER_RUPEE;
  return Number.isSafeInteger(rupees) && Number.isSafeInteger(paisa) ? paisa : null;
}

/**
 * Regroups what a person is typing into a rupee field: "5000" → "5,000". Everything except digits is
 * dropped, so the field shows grouping as you type.
 */
export function formatRupeesInput(text: string | null | undefined): string {
  if (typeof text !== 'string') return '';
  const digits = toAsciiDigits(text).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return groupThousands(digits);
}

/**
 * Turns a paisa amount into the text of a rupee field, rounding up to a whole rupee:
 * 500000 → "5,000", 21050 → "211". Use it to prefill an amount field.
 */
export function toRupeesInput(paisa: PaisaLike): string {
  const { negative, digits } = splitPaisa(paisa);
  if (negative) throw new RangeError('A rupee field cannot hold a negative amount');
  const padded = digits.padStart(3, '0');
  let rupees = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  if (padded.slice(-2) !== '00') rupees = incrementDigits(rupees);
  return groupThousands(rupees);
}

/** Adds one to a non-negative decimal digit string. */
function incrementDigits(digits: string): string {
  const chars = digits.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== '9') {
      chars[i] = String(Number(chars[i]) + 1);
      return chars.join('');
    }
    chars[i] = '0';
  }
  return `1${chars.join('')}`;
}

/**
 * Rounds a non-negative paisa amount up to a multiple of `stepPaisa`, in exact integer maths:
 * `roundUpPaisa(21050, 10000)` is 30000 (Rs 210.50 up to the next Rs 100).
 */
export function roundUpPaisa(paisa: PaisaLike, stepPaisa: number): number {
  const amount = toPaisa(paisa);
  if (!Number.isSafeInteger(stepPaisa) || stepPaisa <= 0) throw new RangeError(`Step must be a positive whole number, got ${stepPaisa}`);
  if (amount < 0) throw new RangeError('roundUpPaisa needs a non-negative amount');
  const remainder = amount % stepPaisa;
  return remainder === 0 ? amount : amount + (stepPaisa - remainder);
}

/** @deprecated Floats are not used for money. Use {@link parseRupeesInput}. */
export function pkrToPaisa(pkr: number): Paisa {
  return Math.round(pkr * 100);
}

/** @deprecated Only {@link formatRs} divides by 100. */
export function paisaToPkr(paisa: Paisa): number {
  return paisa / 100;
}

/** @deprecated Prints "Rs. 3,450.00"; kept until no caller is left. Use {@link formatRs}. */
export function formatPkr(paisa: Paisa): string {
  return `Rs. ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
