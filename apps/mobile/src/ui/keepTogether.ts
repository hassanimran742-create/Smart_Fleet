const NO_BREAK_SPACE = ' ';

/**
 * Keeps a phone number on one line: "0302 3334455" never breaks after "0302" (review23 ux-11). Its
 * spaces become no-break spaces, so a long line wraps before the number instead. Display only: tel:
 * links and the server get the E.164 value, and `normalizePkPhone` reads this form back (`\s` matches
 * U+00A0). Screen readers read it as before.
 *
 * This file imports nothing, so plain-logic modules (screens/distributor/shared/format.ts) and the
 * API's unit tests can use it.
 */
export function keepTogether(text: string): string {
  return text.replace(/ /g, NO_BREAK_SPACE);
}
