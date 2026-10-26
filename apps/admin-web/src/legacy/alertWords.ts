import type { VanNotEmptyContext } from '@smartfleet/shared-types';

/** The fields of an alert (`GET /alerts`) its card's words come from. */
export interface AlertWordsInput {
  alertType: string;
  /** The server's English fallback (API_CONTRACT §9.9: apps render from `alertType` and `context`). */
  title: string;
  body: string | null;
  context?: unknown;
}

export interface AlertWords {
  title: string;
  body: string | null;
}

/** The words an alert card needs from the website's copy. */
export type AlertWordsT = (key: 'alerts.vanNotEmpty.title' | 'alerts.vanNotEmpty.reason', params: Record<string, unknown>) => string;

/**
 * The context of a VAN_NOT_EMPTY alert (API_CONTRACT §9.9), when it names the van and a whole count; else null.
 * The 03:00 van check and a finish with leftovers rewrite it with the van's count now (review23 robustness-jobs-06).
 */
export function vanNotEmptyContext(alert: Pick<AlertWordsInput, 'alertType' | 'context'>): VanNotEmptyContext | null {
  if (alert.alertType !== 'VAN_NOT_EMPTY') return null;
  const context = alert.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const { vehicleId, plateNo, count, tripId, leftoverReason } = context as Record<string, unknown>;
  if (typeof plateNo !== 'string' || plateNo.trim() === '') return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
  return {
    vehicleId: typeof vehicleId === 'string' ? vehicleId : '',
    plateNo,
    count,
    tripId: typeof tripId === 'string' ? tripId : null,
    leftoverReason: typeof leftoverReason === 'string' && leftoverReason.trim() !== '' ? leftoverReason.trim() : null,
  };
}

/**
 * An alert card's title and body. VAN_NOT_EMPTY reads its context in the website's words (UX_ADMIN §3.7):
 * "LEA-101 still has cylinders on it (1)" with the van's count now, plus "Reason: Store closed" when the driver
 * gave one. Every other alert, and a VAN_NOT_EMPTY without a readable context, keeps the server's words.
 */
export function alertWords(alert: AlertWordsInput, t: AlertWordsT): AlertWords {
  const van = vanNotEmptyContext(alert);
  if (!van) return { title: alert.title, body: alert.body };
  return {
    title: t('alerts.vanNotEmpty.title', { plate: van.plateNo, count: van.count }),
    body: van.leftoverReason ? t('alerts.vanNotEmpty.reason', { reason: van.leftoverReason }) : null,
  };
}
