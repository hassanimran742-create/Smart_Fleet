import {
  formatDayLabel as formatDayLabelShared,
  formatPkDateTime,
  formatPkDay,
  formatPkPhone,
  formatPkTime,
  formatRs as formatRsShared,
  formatWhen as formatWhenShared,
  isIsoDate,
  PK_TIME_ZONE,
  wallClock,
  type FormatRsOptions,
  type FormatWhenKey,
  type PaisaLike,
  type TimeInput,
} from '@smartfleet/shared-utils';
import i18n from './index';

/**
 * Formatting for people (UX_ADMIN §1.6). Times are always shown in Asia/Karachi (a fixed UTC+5, as the
 * shared formatters use), money always with `formatRs`, and unit words come from `common`.
 *
 * | Function | Output |
 * |---|---|
 * | `formatRs` | "Rs 3,450", or signed "+Rs 5,000" |
 * | `formatDateTime` | "21 Oct, 4:12 pm" |
 * | `formatTime` | "4:12 pm" |
 * | `formatDay` | "Tue 21 Oct" |
 * | `formatWait` | "12 min", "1 h 20 min" |
 * | `formatCount` | "3 of 5 loaded" |
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function toMs(at: TimeInput): number {
  const ms = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : new Date(at).getTime();
  if (Number.isNaN(ms)) throw new RangeError(`Invalid time: ${String(at)}`);
  return ms;
}

/** "Rs 3,450"; `{ sign: 'always' }` gives "+Rs 5,000"; null or undefined gives "—". */
export function formatRs(paisa: PaisaLike | null | undefined, options?: FormatRsOptions): string {
  return formatRsShared(paisa, options);
}

/** "21 Oct, 4:12 pm" in Asia/Karachi; the year is added when it isn't this year. */
export function formatDateTime(at: TimeInput, now: TimeInput = Date.now()): string {
  const year = wallClock(at, PK_TIME_ZONE).year !== wallClock(now, PK_TIME_ZONE).year;
  return formatPkDateTime(at, { weekday: false, year });
}

/** "4:12 pm" in Asia/Karachi. */
export function formatTime(at: TimeInput): string {
  return formatPkTime(at);
}

/** "Tue 21 Oct" in Asia/Karachi. */
export function formatDay(at: TimeInput): string {
  return formatPkDay(at);
}

/** A plain calendar date (`YYYY-MM-DD`, for example an expense date) as "Tue 21 Oct", with no time-zone shift. */
export function formatCalendarDate(date: string, options: { year?: boolean } = {}): string {
  if (!isIsoDate(date)) return date;
  // Noon UTC is the same calendar day in Asia/Karachi, so the shared day formatter can be reused.
  return formatPkDay(`${date}T12:00:00.000Z`, { year: options.year ?? false });
}

/** "12 min", "1 h 20 min" or "2 d 3 h": how long something has been waiting. Never negative. */
export function formatWait(since: TimeInput, now: TimeInput = Date.now()): string {
  return formatDuration(Math.max(0, toMs(now) - toMs(since)));
}

/** A duration in milliseconds as "12 min", "1 h 20 min" or "2 d 3 h". */
export function formatDuration(ms: number): string {
  const t = i18n.t;
  if (ms < MINUTE_MS) return t('common:wait.underMinute');
  if (ms < HOUR_MS) return t('common:wait.minutes', { count: Math.floor(ms / MINUTE_MS) });
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? t('common:wait.hours', { hours }) : t('common:wait.hoursMinutes', { hours, minutes });
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return hours === 0 ? t('common:wait.days', { days }) : t('common:wait.daysHours', { days, hours });
}

/** "just now", "12 s ago", "5 min ago", "3 h ago", "2 d ago": for "Updated … ago". */
export function formatAgo(at: TimeInput, now: TimeInput = Date.now()): string {
  const t = i18n.t;
  const ms = Math.max(0, toMs(now) - toMs(at));
  if (ms < 5_000) return t('common:ago.justNow');
  if (ms < MINUTE_MS) return t('common:ago.seconds', { count: Math.floor(ms / 1000) });
  if (ms < HOUR_MS) return t('common:ago.minutes', { count: Math.floor(ms / MINUTE_MS) });
  if (ms < DAY_MS) return t('common:ago.hours', { count: Math.floor(ms / HOUR_MS) });
  return t('common:ago.days', { count: Math.floor(ms / DAY_MS) });
}

/** "3 of 5 loaded" (`loaded`), or "3 of 5". */
export function formatCount(done: number, total: number, kind: 'loaded' | 'plain' = 'loaded'): string {
  return kind === 'loaded' ? i18n.t('common:count.loaded', { done, total }) : i18n.t('common:count.of', { done, total });
}

/** A whole number with thousands separators: 12,345. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const negative = n < 0;
  const digits = String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `−${digits}` : digits;
}

/** A Pakistani mobile as "+92 300 1234567"; anything else as stored. */
export function formatPhone(phone: string | null | undefined): string {
  return formatPkPhone(phone, 'international');
}

const WHEN_KEYS: Record<FormatWhenKey, 'common:when.today' | 'common:when.yesterday' | 'common:day.today' | 'common:day.yesterday'> = {
  'common.when.today': 'common:when.today',
  'common.when.yesterday': 'common:when.yesterday',
  'common.day.today': 'common:day.today',
  'common.day.yesterday': 'common:day.yesterday',
};

function whenTranslate(key: FormatWhenKey, options?: { time: string }): string {
  const mapped = WHEN_KEYS[key];
  if (mapped === 'common:when.today' || mapped === 'common:when.yesterday') {
    return i18n.t(mapped, { time: options?.time ?? '' });
  }
  return i18n.t(mapped);
}

/** "Today, 4:12 pm", "Yesterday, 9:05 am" or "Mon 19 Oct, 4:12 pm", for lists and timelines. */
export function formatWhen(at: TimeInput, now: TimeInput = Date.now()): string {
  return formatWhenShared(at, now, whenTranslate);
}

/** A day heading for grouped lists: "Today", "Yesterday" or "Mon 19 Oct". */
export function formatDayLabel(at: TimeInput, now: TimeInput = Date.now()): string {
  return formatDayLabelShared(at, now, whenTranslate);
}
