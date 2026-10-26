/**
 * The distributor code suggested in the Add drawer (website spec W19): the business initials, or the
 * first two letters of a one-word name, the same rule the API uses when no code is sent (API_CONTRACT
 * §7.3 rule 2: "Asif Gas" → "AG", "Gasco" → "GA", "Al Noor Gas" → "ANG"). A code another distributor
 * already has gets a digit ("AG2"), so the suggestion is free when it is made. The person can type over
 * it; the server checks it again (`DISTRIBUTOR_CODE_IN_USE`).
 */
const MAX_CODE_LENGTH = 6;

/** The initials of a business name, upper-case and starting with a letter, or "" when there are none. */
export function codeBaseOf(businessName: string): string {
  const words = businessName
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let base = words
    .map((word) => word[0])
    .join('')
    .replace(/^[^A-Z]+/, '');
  if (base.length < 2) base = words.join('').replace(/^[^A-Z]+/, '').slice(0, 2);
  return base.length >= 2 ? base.slice(0, MAX_CODE_LENGTH) : '';
}

/** The suggested code: the initials, or the first of "AG2" … "AG9" that no other distributor has. */
export function suggestCode(businessName: string, taken: ReadonlySet<string>): string {
  const base = codeBaseOf(businessName);
  if (!base || !taken.has(base)) return base;
  for (let digit = 2; digit <= 9; digit += 1) {
    const candidate = `${base.slice(0, MAX_CODE_LENGTH - 1)}${digit}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}
