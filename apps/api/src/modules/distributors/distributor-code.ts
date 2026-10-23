/** The shape every distributor code has (ADR-22). */
const CODE = /^[A-Z][A-Z0-9]{1,5}$/;
const MAX_CODE_LENGTH = 6;

/**
 * The default code for a new distributor (API_CONTRACT §7.3 rule 2): the business initials, or the
 * first two letters of a one-word name. "Asif Gas" → "AG", "Gasco" → "GA", "Al Noor Gas" → "ANG".
 */
export function codeBaseOf(businessName: string): string {
  const words = businessName
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let base = words.map((word) => word[0]).join('').replace(/^[^A-Z]+/, '');
  if (base.length < 2) base = words.join('').replace(/^[^A-Z]+/, '').slice(0, 2);
  if (base.length < 2) base = 'SH';
  return base.slice(0, MAX_CODE_LENGTH);
}

/**
 * The codes to try, in order: the base, then the base with a digit when it is taken ("AG2", "AG3" …
 * "AG99"), shortened so every candidate stays within 6 characters.
 */
export function codeCandidates(businessName: string): string[] {
  const base = codeBaseOf(businessName);
  const out = [base];
  for (let n = 2; n <= 99; n += 1) {
    const suffix = String(n);
    out.push(`${base.slice(0, MAX_CODE_LENGTH - suffix.length)}${suffix}`);
  }
  return out.filter((code, index) => CODE.test(code) && out.indexOf(code) === index);
}
