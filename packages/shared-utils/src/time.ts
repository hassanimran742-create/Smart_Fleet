/**
 * Time helpers for the business day (API_CONTRACT §1.1, ADR-21). Times on the wire are ISO-8601 UTC;
 * people see Asia/Karachi. The business day starts at 03:00 local time (settings `day.timezone` and
 * `day.cutoffLocalTime`).
 *
 * Pakistan has kept UTC+5 with no daylight saving since 2009, so Asia/Karachi (and UTC) use a fixed
 * offset and never touch Intl: the formatters work on Hermes without ICU data. Any other IANA zone,
 * which only the business-day helpers accept, is resolved with `Intl.DateTimeFormat`.
 */

export const PK_TIME_ZONE = 'Asia/Karachi';
export const DEFAULT_DAY_CUTOFF = '03:00';

/** A point in time: a Date, an ISO-8601 string or epoch milliseconds. */
export type TimeInput = Date | string | number;

const MINUTE_MS = 60000;
const DAY_MS = 86400000;

const FIXED_OFFSET_MINUTES: Readonly<Record<string, number>> = {
  'Asia/Karachi': 300,
  UTC: 0,
  'Etc/UTC': 0,
  GMT: 0,
  'Etc/GMT': 0,
};

function toDate(value: TimeInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid time: ${String(value)}`);
  return date;
}

const intlFormatters = new Map<string, Intl.DateTimeFormat>();

function intlOffsetMinutes(date: Date, timeZone: string): number {
  if (
    typeof Intl === 'undefined' ||
    typeof Intl.DateTimeFormat !== 'function' ||
    typeof Intl.DateTimeFormat.prototype.formatToParts !== 'function'
  ) {
    throw new RangeError(`Time zone ${timeZone} needs Intl support on this device`);
  }
  let formatter = intlFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    intlFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  return Math.round((wall - (date.getTime() - date.getUTCMilliseconds())) / MINUTE_MS);
}

/** Minutes to add to UTC to get the wall clock of `timeZone` at that moment (Asia/Karachi: 300). */
export function timeZoneOffsetMinutes(at: TimeInput, timeZone: string = PK_TIME_ZONE): number {
  if (Object.prototype.hasOwnProperty.call(FIXED_OFFSET_MINUTES, timeZone)) return FIXED_OFFSET_MINUTES[timeZone];
  return intlOffsetMinutes(toDate(at), timeZone);
}

/** The wall clock in a time zone. `month` is 1–12; `weekday` is 0 (Sunday) to 6. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function wallClock(at: TimeInput, timeZone: string = PK_TIME_ZONE): WallClock {
  const date = toDate(at);
  const local = new Date(date.getTime() + timeZoneOffsetMinutes(date, timeZone) * MINUTE_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: local.getUTCDay(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function isoDateFromUtcFields(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Splits a `YYYY-MM-DD` calendar date, or returns null when it isn't a real date. */
function splitIsoDate(text: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return [year, month, day];
}

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(text: unknown): text is string {
  return typeof text === 'string' && splitIsoDate(text) !== null;
}

/** `YYYY-MM-DD` plus `days` calendar days (negative goes back). */
export function addDays(date: string, days: number): string {
  const parts = splitIsoDate(date);
  if (!parts || !Number.isSafeInteger(days)) throw new RangeError(`addDays: invalid date ${date} or days ${days}`);
  return isoDateFromUtcFields(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)));
}

/** The calendar date (`YYYY-MM-DD`) in a time zone, Asia/Karachi by default. No cut-off applies. */
export function localDate(at: TimeInput, timeZone: string = PK_TIME_ZONE): string {
  const date = toDate(at);
  return isoDateFromUtcFields(new Date(date.getTime() + timeZoneOffsetMinutes(date, timeZone) * MINUTE_MS));
}

/** Minutes after midnight for a local "HH:mm" time. */
function parseLocalTime(text: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) throw new RangeError(`Expected a local time like "03:00", got "${text}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Business-day settings. The field names match `PublicAppConfig.day`, so `appConfig.day` can be passed as is. */
export interface BusinessDayOptions {
  /** Setting `day.timezone`; Asia/Karachi by default. */
  timezone?: string;
  /** Setting `day.cutoffLocalTime`; "03:00" by default. */
  cutoffLocalTime?: string;
}

/**
 * The business date (`YYYY-MM-DD`) of a moment: its local date, moved to the day before when it falls
 * before the cut-off. With the defaults, 02:59 Karachi on the 22nd still belongs to the 21st.
 * It matches the parameterised SQL rule (DATA_MODEL §5.4)
 * `((ts AT TIME ZONE 'UTC') AT TIME ZONE $tz - $cutoff::interval)::date`, with `$tz` = `day.timezone`
 * and `$cutoff` = `day.cutoffLocalTime` read from settings: never write the zone or the cut-off as
 * literals in SQL.
 */
export function businessDate(at: TimeInput, options: BusinessDayOptions = {}): string {
  const timeZone = options.timezone ?? PK_TIME_ZONE;
  const cutoff = parseLocalTime(options.cutoffLocalTime ?? DEFAULT_DAY_CUTOFF);
  const date = toDate(at);
  const local = date.getTime() + timeZoneOffsetMinutes(date, timeZone) * MINUTE_MS;
  return isoDateFromUtcFields(new Date(local - cutoff * MINUTE_MS));
}

/** The instant whose wall clock in `timeZone` reads `wallMs` (wall time written as if it were UTC). */
function wallTimeToInstant(wallMs: number, timeZone: string): number {
  const first = wallMs - timeZoneOffsetMinutes(wallMs, timeZone) * MINUTE_MS;
  return wallMs - timeZoneOffsetMinutes(first, timeZone) * MINUTE_MS;
}

/**
 * The UTC instants that bound a business date: `start` (inclusive) is the cut-off on that date and
 * `end` (exclusive) the cut-off on the next. Use them to query "today" in the database.
 */
export function businessDayRange(date: string, options: BusinessDayOptions = {}): { start: Date; end: Date } {
  const parts = splitIsoDate(date);
  if (!parts) throw new RangeError(`businessDayRange: expected YYYY-MM-DD, got "${date}"`);
  const timeZone = options.timezone ?? PK_TIME_ZONE;
  const cutoffMs = parseLocalTime(options.cutoffLocalTime ?? DEFAULT_DAY_CUTOFF) * MINUTE_MS;
  const dayStartWall = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return {
    start: new Date(wallTimeToInstant(dayStartWall + cutoffMs, timeZone)),
    end: new Date(wallTimeToInstant(dayStartWall + DAY_MS + cutoffMs, timeZone)),
  };
}

// ---- Formatting for people, always in Asia/Karachi ----

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function clockTime(clock: WallClock): string {
  return `${clock.hour % 12 || 12}:${pad2(clock.minute)} ${clock.hour < 12 ? 'am' : 'pm'}`;
}

function clockDay(clock: WallClock, weekday: boolean, year: boolean): string {
  const day = `${clock.day} ${MONTHS[clock.month - 1]}${year ? ` ${clock.year}` : ''}`;
  return weekday ? `${WEEKDAYS[clock.weekday]} ${day}` : day;
}

export interface PkDayOptions {
  /** Start with the weekday ("Tue 21 Oct"); true by default. */
  weekday?: boolean;
  /** End with the year ("21 Oct 2026"); false by default. */
  year?: boolean;
}

/** "4:12 pm" in Asia/Karachi. */
export function formatPkTime(at: TimeInput): string {
  return clockTime(wallClock(at, PK_TIME_ZONE));
}

/**
 * A local clock time from a setting, such as `topup.checkingHours` or `day.cutoffLocalTime`, for people:
 * 12-hour, with the minutes only when they aren't :00. "21:00" is "9 pm", "21:30" "9:30 pm", "00:00"
 * "12 am" and "12:00" "12 pm" ("Money is checked 9 am to 9 pm"; "09:00–21:00" is never shown). It reads
 * "HH:mm" (or "H:mm") as written, with no time zone and no Intl. A value that isn't a real time of day
 * is returned unchanged.
 */
export function formatClock(time: string): string {
  const match = typeof time === 'string' ? /^(\d{1,2}):([0-5]\d)$/.exec(time) : null;
  const hour = match ? Number(match[1]) : NaN;
  if (!match || hour > 23) return time;
  const minute = Number(match[2]);
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 || 12}${minute === 0 ? '' : `:${pad2(minute)}`} ${suffix}`;
}

/** "Tue 21 Oct" in Asia/Karachi; "21 Oct" with `weekday: false`. */
export function formatPkDay(at: TimeInput, options: PkDayOptions = {}): string {
  return clockDay(wallClock(at, PK_TIME_ZONE), options.weekday ?? true, options.year ?? false);
}

/**
 * A plain calendar date `YYYY-MM-DD` for people: "Tue 20 Oct" ("Tue 20 Oct 2026" with `year: true`).
 * The date is read as written, with no time zone and no Intl (business dates, expense dates). A value
 * that isn't a real `YYYY-MM-DD` date is returned unchanged.
 */
export function formatIsoDay(date: string, options: { year?: boolean } = {}): string {
  const parts = typeof date === 'string' ? splitIsoDate(date) : null;
  if (!parts) return date;
  const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return `${WEEKDAYS[weekday]} ${parts[2]} ${MONTHS[parts[1] - 1]}${options.year ? ` ${parts[0]}` : ''}`;
}

/** "Tue 21 Oct, 4:12 pm" in Asia/Karachi, at the fixed UTC+5 offset with no Intl. */
export function formatPkDateTime(at: TimeInput, options: PkDayOptions = {}): string {
  const clock = wallClock(at, PK_TIME_ZONE);
  return `${clockDay(clock, options.weekday ?? true, options.year ?? false)}, ${clockTime(clock)}`;
}

/** The i18n keys {@link formatWhen} and {@link formatDayLabel} ask for (shop and driver apps, `common`). */
export const FORMAT_WHEN_KEYS = {
  today: 'common.when.today',
  yesterday: 'common.when.yesterday',
  dayToday: 'common.day.today',
  dayYesterday: 'common.day.yesterday',
} as const;
export type FormatWhenKey = (typeof FORMAT_WHEN_KEYS)[keyof typeof FORMAT_WHEN_KEYS];

/** English for {@link FORMAT_WHEN_KEYS}, shaped to sit inside the apps' `common` resource. */
export const FORMAT_WHEN_EN = {
  when: { today: 'Today, {{time}}', yesterday: 'Yesterday, {{time}}' },
  day: { today: 'Today', yesterday: 'Yesterday' },
} as const;

/** The translate function the formatters call, such as i18next's `t`. */
export type WhenTranslate = (key: FormatWhenKey, options?: { time: string }) => string;

function dayIndex(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day) / DAY_MS;
}

function translated(t: WhenTranslate | undefined, key: FormatWhenKey, english: string, time?: string): string {
  if (t) return time === undefined ? t(key) : t(key, { time });
  return time === undefined ? english : english.replace('{{time}}', time);
}

/**
 * When something happened, for lists and timelines: "Today, 4:12 pm", "Yesterday, 9:05 am" or
 * "Mon 19 Oct, 4:12 pm" (the year is added for another year), in Asia/Karachi calendar days.
 * `now` is passed in so the function stays pure. Without `t` it prints English.
 */
export function formatWhen(at: TimeInput, now: TimeInput, t?: WhenTranslate): string {
  const clock = wallClock(at, PK_TIME_ZONE);
  const today = wallClock(now, PK_TIME_ZONE);
  const time = clockTime(clock);
  const daysAgo = dayIndex(today) - dayIndex(clock);
  if (daysAgo === 0) return translated(t, FORMAT_WHEN_KEYS.today, FORMAT_WHEN_EN.when.today, time);
  if (daysAgo === 1) return translated(t, FORMAT_WHEN_KEYS.yesterday, FORMAT_WHEN_EN.when.yesterday, time);
  return `${clockDay(clock, true, clock.year !== today.year)}, ${time}`;
}

/** A day heading for grouped lists: "Today", "Yesterday" or "Mon 19 Oct", in Asia/Karachi calendar days. */
export function formatDayLabel(at: TimeInput, now: TimeInput, t?: WhenTranslate): string {
  const clock = wallClock(at, PK_TIME_ZONE);
  const today = wallClock(now, PK_TIME_ZONE);
  const daysAgo = dayIndex(today) - dayIndex(clock);
  if (daysAgo === 0) return translated(t, FORMAT_WHEN_KEYS.dayToday, FORMAT_WHEN_EN.day.today);
  if (daysAgo === 1) return translated(t, FORMAT_WHEN_KEYS.dayYesterday, FORMAT_WHEN_EN.day.yesterday);
  return clockDay(clock, true, clock.year !== today.year);
}
