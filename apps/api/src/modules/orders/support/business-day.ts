import { addDays, businessDate, businessDayRange, type BusinessDayOptions } from '@smartfleet/shared-utils';
import type { SettingsService } from '../../settings/settings.service';

/** A span of business days: `start` inclusive, `end` exclusive (UTC instants). */
export interface DayRange {
  start: Date;
  end: Date;
}

/** The business-day settings (`day.timezone`, `day.cutoffLocalTime`), read fresh for every request (G12-03). */
export async function businessDayOptions(settings: SettingsService): Promise<Required<BusinessDayOptions>> {
  const [timezone, cutoffLocalTime] = await Promise.all([settings.get('day.timezone'), settings.get('day.cutoffLocalTime')]);
  return { timezone, cutoffLocalTime };
}

/**
 * The current business day (ADR-21: Asia/Karachi with a 03:00 cut-off by default), widened to include
 * the `daysBefore` business days before it. "Today" figures use `daysBefore = 0`; the office's
 * cancelled-and-failed tab uses 6 (API_CONTRACT §7.6).
 */
export async function currentBusinessDays(settings: SettingsService, daysBefore = 0, now: Date = new Date()): Promise<DayRange> {
  const options = await businessDayOptions(settings);
  const today = businessDate(now, options);
  return {
    start: businessDayRange(addDays(today, -daysBefore), options).start,
    end: businessDayRange(today, options).end,
  };
}
