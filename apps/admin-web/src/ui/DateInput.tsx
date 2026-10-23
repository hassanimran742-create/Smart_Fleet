import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { wallClock } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { DateChips } from './DateChips';
import { Field, TextInput } from './Field';

export { todayInKarachi } from './dateRange';

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** `YYYY-MM-DD`, or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest date, `YYYY-MM-DD`. */
  min?: string;
  /** Latest date, `YYYY-MM-DD` (for "not in the future", pass `todayInKarachi()`). */
  max?: string;
}

/**
 * A calendar date box (UX_ADMIN §1.5), for example the From and To of a custom range. A form date that
 * a person picks uses DateChips (Today · Yesterday · Pick date) instead.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, ...rest },
  ref,
) {
  return <TextInput {...rest} ref={ref} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
});

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO instant as the `datetime-local` text of its Asia/Karachi wall clock ("2026-10-21T16:12"). */
export function toKarachiLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  const c = wallClock(time);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}`;
}

/** A `datetime-local` text read as Asia/Karachi wall time (+05:00), as an ISO UTC instant; null if empty or invalid. */
export function fromKarachiLocalInput(text: string): string | null {
  const m = LOCAL_PATTERN.exec(text);
  if (!m) return null;
  const wallMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(wallMs)) return null;
  return new Date(wallMs - KARACHI_OFFSET_MS).toISOString();
}

/** The date (`YYYY-MM-DD`) and time (`HH:mm`) a person picked, either of which may still be "". */
export interface DateTimeParts {
  date: string;
  time: string;
}

/** An ISO instant split into its Asia/Karachi date and time; empty parts for null or an invalid instant. */
export function splitKarachiInstant(iso: string | null | undefined): DateTimeParts {
  const local = toKarachiLocalInput(iso);
  return local ? { date: local.slice(0, 10), time: local.slice(11, 16) } : { date: '', time: '' };
}

/** A date and a time read as Asia/Karachi wall time, as one ISO UTC instant; null until both are complete. */
export function karachiInstant(parts: DateTimeParts): string | null {
  if (!parts.date || !/^\d{2}:\d{2}$/.test(parts.time)) return null;
  return fromKarachiLocalInput(`${parts.date}T${parts.time}`);
}

export interface DateTimeInputProps {
  /** An ISO-8601 UTC instant, or null while either part is missing. */
  value: string | null;
  /** Called with an ISO UTC instant, or null when the date or the time is still missing. */
  onChange: (iso: string | null) => void;
  /** Reports the parts as picked, so the form can say which one is missing ("Pick the date."). */
  onPartsChange?: (parts: DateTimeParts) => void;
  /** Earliest instant (ISO). */
  min?: string;
  /** Latest instant (ISO): it limits the date chips and, on that date, the time. */
  max?: string;
  /** "Date" and "Time" by default. */
  dateLabel?: string;
  timeLabel?: string;
  /** The one-line errors under each part. */
  dateError?: string | null;
  timeError?: string | null;
  /** Today's date for the chips (`YYYY-MM-DD`); the Asia/Karachi calendar date by default. */
  today?: string;
  disabled?: boolean;
  /** The time box's name, for forms that focus the first missing field. */
  name?: string;
  /** Called when the focus leaves the date and time controls. */
  onBlur?: () => void;
  className?: string;
}

/**
 * A date and a time in Pakistan time (+05:00, UX_ADMIN §1.8), whatever time zone the laptop is set to,
 * for example the time a payment shows in the bank app. The date is picked with DateChips (Today ·
 * Yesterday · Pick date) and the time is the browser's time box (minutes, no seconds). It hands back one
 * ISO UTC instant once both are set, and the parts through `onPartsChange`.
 */
export function DateTimeInput({
  value,
  onChange,
  onPartsChange,
  min,
  max,
  dateLabel,
  timeLabel,
  dateError,
  timeError,
  today,
  disabled = false,
  name,
  onBlur,
  className,
}: DateTimeInputProps) {
  const { t } = useTranslation();
  const [parts, setParts] = useState<DateTimeParts>(() => splitKarachiInstant(value));
  const lastEmitted = useRef<string | null | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  // Follow a change from outside (a reset, a prefill), never our own echo, so a half-picked date stays.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = undefined;
    setParts(splitKarachiInstant(value));
  }, [value]);

  const update = (next: DateTimeParts) => {
    setParts(next);
    onPartsChange?.(next);
    const iso = karachiInstant(next);
    lastEmitted.current = iso;
    onChange(iso);
  };

  const minParts = splitKarachiInstant(min);
  const maxParts = splitKarachiInstant(max);

  return (
    <div
      ref={rootRef}
      className={cx('sf-datetime', className)}
      onBlur={(event) => {
        if (onBlur && !(event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget))) onBlur();
      }}
    >
      <Field label={dateLabel ?? t('dates.date')} error={dateError}>
        <DateChips
          value={parts.date}
          onChange={(date) => update({ ...parts, date })}
          today={today}
          min={minParts.date || undefined}
          max={maxParts.date || undefined}
          disabled={disabled}
        />
      </Field>
      <Field label={timeLabel ?? t('dates.time')} error={timeError} className="sf-datetime__time">
        <TextInput
          type="time"
          step={60}
          name={name}
          value={parts.time}
          min={parts.date && parts.date === minParts.date ? minParts.time : undefined}
          max={parts.date && parts.date === maxParts.date ? maxParts.time : undefined}
          disabled={disabled}
          onChange={(event) => update({ ...parts, time: event.target.value })}
        />
      </Field>
    </div>
  );
}
