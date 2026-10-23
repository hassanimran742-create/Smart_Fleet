import { presetRange, type DateRange } from '../../ui';
import type { ExpensesSearch } from '../../app/search';
import type { ExpenseFilters } from './api';

/** The date presets of the Expenses filter bar (UX_ADMIN §2.7): This month (default), Last month, Custom. */
export const EXPENSE_DATE_PRESETS = ['thisMonth', 'lastMonth'] as const;

/**
 * The date range the URL describes. No dates is This month. Dates equal to last month's are shown as
 * Last month unless the person picked Custom (`customMode`), so choosing Custom never snaps back.
 */
export function rangeFromSearch(search: ExpensesSearch, customMode: boolean, now: number = Date.now()): DateRange {
  const thisMonth = presetRange('thisMonth', now);
  if (!search.from && !search.to) return customMode ? { ...thisMonth, preset: 'custom' } : thisMonth;
  const from = search.from ?? thisMonth.from;
  const to = search.to ?? thisMonth.to;
  const lastMonth = presetRange('lastMonth', now);
  if (!customMode && from === lastMonth.from && to === lastMonth.to) return lastMonth;
  return { preset: 'custom', from, to };
}

/** The search params for a range: This month is the default, so it leaves the dates out of the URL. */
export function searchForRange(range: DateRange): Pick<ExpensesSearch, 'from' | 'to'> {
  if (range.preset === 'thisMonth') return { from: undefined, to: undefined };
  return { from: range.from || undefined, to: range.to || undefined };
}

/** The API filters of the page: dates in order (a reversed custom range is read the right way round). */
export function filtersFor(range: DateRange, search: ExpensesSearch): ExpenseFilters {
  const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
  return {
    from,
    to,
    typeId: search.type,
    vehicleId: search.van,
    driverId: search.driver,
    includeVoided: search.removed === true,
  };
}

/** True when the list is narrowed by more than the dates (the totals then still cover every expense). */
export function hasListFilters(search: ExpensesSearch): boolean {
  return Boolean(search.type || search.van || search.driver);
}

/** True when the range covers more than one calendar month (the month × type table shows then). */
export function spansMonths(range: { from: string; to: string }): boolean {
  return range.from.slice(0, 7) !== range.to.slice(0, 7);
}

/** The month keys of the `expenses:months.names` copy. */
export type MonthKey = 'm01' | 'm02' | 'm03' | 'm04' | 'm05' | 'm06' | 'm07' | 'm08' | 'm09' | 'm10' | 'm11' | 'm12';

/** "2026-09" → { key: 'm09', year: '2026' }. */
export function splitMonth(month: string): { key: MonthKey; year: string } {
  return { key: `m${month.slice(5, 7)}` as MonthKey, year: month.slice(0, 4) };
}

/** The UTC instant at which a Pakistan calendar date starts (UTC+5, no daylight saving). */
export function karachiDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00+05:00`).toISOString();
}

/** The Pakistan calendar date of an instant. */
export function karachiDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
