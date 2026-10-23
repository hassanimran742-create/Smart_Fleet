import { businessDate, businessDayRange, isIsoDate, type BusinessDayOptions } from '@smartfleet/shared-utils';
import type { SettingsService } from '../settings/settings.service';

/**
 * Business-day bounds for money queries (ADR-21, G12-03): always from the current `day.timezone` and
 * `day.cutoffLocalTime` settings, never literals. SQL receives the UTC instants, so no zone or cut-off
 * is ever written in a query.
 */

/** The current business-day settings, in the shape shared-utils takes. */
export async function businessDayOptions(settings: Pick<SettingsService, 'get'>): Promise<BusinessDayOptions> {
  const [timezone, cutoffLocalTime] = await Promise.all([settings.get('day.timezone'), settings.get('day.cutoffLocalTime')]);
  return { timezone, cutoffLocalTime };
}

/** Today's business day: its date and its UTC bounds, `start` inclusive and `end` exclusive. */
export async function currentBusinessDay(
  settings: Pick<SettingsService, 'get'>,
  now: Date = new Date(),
): Promise<{ date: string; start: Date; end: Date }> {
  const options = await businessDayOptions(settings);
  const date = businessDate(now, options);
  return { date, ...businessDayRange(date, options) };
}

/**
 * A statement date filter (`from` / `to`): a business date `YYYY-MM-DD` covers that whole business day,
 * so `from` is its start and `to` the start of the next day (exclusive); an ISO instant is used as it is,
 * inclusive. Returns the bound and whether it is exclusive.
 */
export function statementBound(
  value: string,
  edge: 'from' | 'to',
  options: BusinessDayOptions,
): { at: Date; exclusive: boolean } {
  if (isIsoDate(value)) {
    const range = businessDayRange(value, options);
    return edge === 'from' ? { at: range.start, exclusive: false } : { at: range.end, exclusive: true };
  }
  return { at: new Date(value), exclusive: false };
}
