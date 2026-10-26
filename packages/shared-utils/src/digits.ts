const ARABIC_INDIC_ZERO = 0x0660; // ٠ to ٩
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰ to ۹, the digits Urdu keyboards type

/**
 * Turns Arabic-Indic and Urdu (extended Arabic-Indic) digits into ASCII 0–9 and leaves everything
 * else alone, so typed numbers parse the same whatever keyboard the phone uses.
 */
export function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const zero = code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}
