/**
 * CNIC helpers (API_CONTRACT §3.5, §7.3 rule 4). A CNIC is reduced to its 13 digits before it is
 * encrypted (`ENCRYPTION_KEY`) and indexed (`BLIND_INDEX_KEY`), so "35202-7654321-3" and
 * "3520276543213" are the same CNIC. The CNIC itself never leaves the server: office views of a
 * distributor or a driver carry only {@link maskCnic}'s `cnicMasked`.
 */

const CNIC_DIGITS = /^\d{13}$/;

/** The 13 digits of a CNIC typed with or without spaces and dashes, or null when it isn't one. */
export function normalizeCnic(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '');
  return CNIC_DIGITS.test(digits) ? digits : null;
}

/**
 * The office's masked CNIC: the last four digits only, in the 5-7-1 layout, "*****-****567-1".
 * Null when no CNIC is stored (or a stored value has fewer than four digits).
 */
export function maskCnic(cnic: string | null | undefined): string | null {
  if (typeof cnic !== 'string') return null;
  const digits = cnic.replace(/\D/g, '');
  if (digits.length < 4) return null;
  const last4 = digits.slice(-4);
  return `*****-****${last4.slice(0, 3)}-${last4.slice(3)}`;
}
