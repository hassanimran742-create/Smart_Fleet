import { businessDayRange, localDate } from '@smartfleet/shared-utils';

/**
 * Calendar dates of the expenses module. Expense dates and fuel-log months are plain calendar dates in
 * `day.timezone` (Asia/Karachi), with no 03:00 cut-off (API_CONTRACT §1.1, §7.12; DATA_MODEL §5.4).
 */

/** Today's calendar date (`YYYY-MM-DD`) in the time zone, at `now`. */
export function calendarToday(now: Date, timeZone: string): string {
  return localDate(now, timeZone);
}

/** The first day of the date's month: "2026-10-22" → "2026-10-01". */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the date's month: "2026-02-10" → "2026-02-28". */
export function monthEnd(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/**
 * The inclusive date range of a list or summary query. With neither bound, the current calendar month
 * (API_CONTRACT §7.12). With one bound only, the other comes from the same month: `to` alone starts on
 * the first of its month, and `from` alone runs to the end of this month (or of its own month, when it
 * is later).
 */
export function resolveRange(query: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const thisMonthEnd = monthEnd(today);
  const from = query.from ?? (query.to ? monthStart(query.to) : monthStart(today));
  const to = query.to ?? (query.from && query.from > thisMonthEnd ? monthEnd(query.from) : thisMonthEnd);
  return { from, to };
}

/** The UTC instants that bound the calendar days `from`…`to` in the time zone (start inclusive, end exclusive). */
export function calendarRangeInstants(from: string, to: string, timeZone: string): { start: Date; end: Date } {
  const day = { timezone: timeZone, cutoffLocalTime: '00:00' };
  return { start: businessDayRange(from, day).start, end: businessDayRange(to, day).end };
}

/** A `@db.Date` value as Prisma reads it (UTC midnight) → `YYYY-MM-DD`. */
export function isoDateOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → the Date Prisma writes to a `@db.Date` column. */
export function dateColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
