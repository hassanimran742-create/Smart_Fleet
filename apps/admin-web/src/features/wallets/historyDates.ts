import { businessDate, type BusinessDayOptions } from '@smartfleet/shared-utils';
import { presetRangeFrom, type DateRange } from '../../ui/dateRange';

/** The date presets of the wallet history (This month is the default). */
export const HISTORY_PRESETS = ['today', 'last7', 'thisMonth', 'lastMonth'] as const;

/**
 * The date the history's presets count from: the business date (ADR-21), because the statement reads
 * `from` and `to` as business days, 03:00 to 03:00 (API_CONTRACT §7.8). At 01:30 on the 24th it is
 * still the 23rd, so Today shows what happened since 03:00 on the 23rd. Pass `appConfig.day`.
 * Expenses keep calendar dates (§7.12).
 */
export function historyToday(day: BusinessDayOptions, now: number = Date.now()): string {
  return businessDate(now, day);
}

/**
 * The date range the URL describes, with presets counted from `today` (see {@link historyToday}). No
 * dates is This month; a preset's exact range reads as that preset unless the person picked Custom
 * (`customMode`), so choosing Custom never snaps back.
 */
export function rangeFromSearch(search: { from?: string; to?: string }, customMode: boolean, today: string): DateRange {
  const thisMonth = presetRangeFrom('thisMonth', today);
  if (!search.from && !search.to) return customMode ? { ...thisMonth, preset: 'custom' } : thisMonth;
  const from = search.from ?? thisMonth.from;
  const to = search.to ?? thisMonth.to;
  if (!customMode) {
    for (const preset of HISTORY_PRESETS) {
      const range = presetRangeFrom(preset, today);
      if (range.from === from && range.to === to) return range;
    }
  }
  return { preset: 'custom', from, to };
}
