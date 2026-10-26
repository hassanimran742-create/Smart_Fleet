import { addDays, localDate } from '@smartfleet/shared-utils';

/** The date presets of a filter bar (UX_ADMIN §1.5), plus Custom with From and To. */
export type DatePreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom';

export interface DateRange {
  preset: DatePreset;
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, inclusive. */
  to: string;
}

/** The dates of a preset counted from `today` (`YYYY-MM-DD`): a calendar date or a business date. */
export function presetRangeFrom(preset: Exclude<DatePreset, 'custom'>, today: string): DateRange {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case 'last7':
      return { preset, from: addDays(today, -6), to: today };
    case 'thisMonth':
      return { preset, from: monthStart, to: today };
    case 'lastMonth': {
      const lastOfPrevious = addDays(monthStart, -1);
      return { preset, from: `${lastOfPrevious.slice(0, 8)}01`, to: lastOfPrevious };
    }
  }
}

/** Today's calendar date in Asia/Karachi (`YYYY-MM-DD`), for `max` on dates that can't be in the future. */
export function todayInKarachi(now: number = Date.now()): string {
  return localDate(now);
}

/**
 * The dates of a preset in Asia/Karachi calendar days. A page whose API reads `from`/`to` as business
 * days (the wallet history, API_CONTRACT §7.8) counts from the business date with `presetRangeFrom`.
 */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, now: number = Date.now()): DateRange {
  return presetRangeFrom(preset, localDate(now));
}
