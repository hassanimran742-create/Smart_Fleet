import type { AdminWalletDetail } from '@smartfleet/shared-types';

/**
 * What the wallet page's integrity line says (UX_ADMIN §2.6, API_CONTRACT §7.8). `integrity.ok` is false
 * for two different problems, because the nightly check counts both (§8.5):
 * - `mismatch`: the history doesn't add up to the balance (`differencePaisa` isn't "0"). Engineering
 *   repairs it, so "Record correction" waits (G01-06).
 * - `belowZero`: the history adds up, but the balance is below Rs 0 (an old unguarded debit). A
 *   correction is the documented fix (DATA_MODEL §3.5), so "Record correction" stays on.
 * Anything else that isn't ok reads as a mismatch, the safe side.
 */
export type IntegrityState = 'ok' | 'mismatch' | 'belowZero';

/** A signed paisa string as a number of paisa, or null when it isn't one. */
function paisaOf(value: string): bigint | null {
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

export function integrityState(detail: Pick<AdminWalletDetail, 'balancePaisa' | 'integrity'>): IntegrityState {
  if (detail.integrity.ok) return 'ok';
  const difference = paisaOf(detail.integrity.differencePaisa);
  const balance = paisaOf(detail.balancePaisa);
  return difference === 0n && balance !== null && balance < 0n ? 'belowZero' : 'mismatch';
}
