import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { DateInput } from './DateInput';
import { presetRange, presetRangeFrom, type DatePreset, type DateRange } from './dateRange';
import { Field, TextInput } from './Field';
import { FilterChips } from './FilterChips';

/** A row of filters above a table (UX_ADMIN §1.4): a search box, then chips. It wraps; it never scrolls sideways. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('sf-filter-bar', className)}>{children}</div>;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export interface SearchFieldProps {
  /** The committed search (from `?q=`). */
  value: string;
  /** Called 300 ms after typing stops, and at once on clear. */
  onChange: (value: string) => void;
  /** Says what can be searched: "Name, transaction ID or bank reference". */
  placeholder: string;
  /** Read out; the placeholder by default. */
  label?: string;
  /** Focus the box with the `/` key (default true). */
  slashShortcut?: boolean;
  debounceMs?: number;
  className?: string;
}

/** The search box of a filter bar: 300 ms debounce, and the `/` key focuses it. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  slashShortcut = true,
  debounceMs = 300,
  className,
}: SearchFieldProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow the URL when it changes from outside (Back, a link), without eating a space being typed.
  useEffect(() => {
    setText((current) => (current.trim() === value ? current : value));
  }, [value]);

  useEffect(() => {
    if (text.trim() === value) return;
    const id = window.setTimeout(() => onChangeRef.current(text.trim()), debounceMs);
    return () => window.clearTimeout(id);
  }, [text, value, debounceMs]);

  useEffect(() => {
    if (!slashShortcut) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slashShortcut]);

  return (
    <div className={cx('sf-search', className)}>
      <TextInput
        ref={inputRef}
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        aria-describedby={slashShortcut ? hintId : undefined}
        startAdornment={<Search aria-hidden size={16} />}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.stopPropagation();
            setText('');
            onChange('');
          }
        }}
      />
      {text ? (
        <button
          type="button"
          className="sf-search__clear"
          aria-label={t('actions.clearSearch')}
          onClick={() => {
            setText('');
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <X aria-hidden size={14} />
        </button>
      ) : null}
      {slashShortcut ? (
        <span id={hintId} className="sr-only">
          {t('search.shortcut')}
        </span>
      ) : null}
    </div>
  );
}

export interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: readonly Exclude<DatePreset, 'custom'>[];
  /**
   * The date the presets count from (`YYYY-MM-DD`): today's Asia/Karachi calendar date when left out. A
   * page whose API reads business days (the wallet history) passes the business date.
   */
  today?: string;
  className?: string;
}

/**
 * Date presets as chips (UX_ADMIN §1.4): Today · Last 7 days · This month · Last month · Custom, and the
 * From and To boxes only while Custom is picked.
 */
export function DateRangeFilter({
  value,
  onChange,
  presets = ['today', 'last7', 'thisMonth', 'lastMonth'],
  today,
  className,
}: DateRangeFilterProps) {
  const { t } = useTranslation();
  const labels: Record<DatePreset, string> = {
    today: t('dates.today'),
    last7: t('dates.last7'),
    thisMonth: t('dates.thisMonth'),
    lastMonth: t('dates.lastMonth'),
    custom: t('dates.custom'),
  };
  const options = [...presets, 'custom' as const].map((preset) => ({ value: preset, label: labels[preset] }));
  return (
    <div className={cx('sf-date-range', className)}>
      <FilterChips
        label={t('dates.preset')}
        options={options}
        value={value.preset}
        onChange={(preset: DatePreset) => {
          if (preset === 'custom') onChange({ ...value, preset });
          else onChange(today ? presetRangeFrom(preset, today) : presetRange(preset));
        }}
      />
      {value.preset === 'custom' ? (
        <>
          <Field label={t('dates.from')} labelHidden>
            <DateInput
              value={value.from}
              max={value.to || undefined}
              onChange={(from) => onChange({ ...value, from })}
              aria-label={t('dates.from')}
            />
          </Field>
          <Field label={t('dates.to')} labelHidden>
            <DateInput
              value={value.to}
              min={value.from || undefined}
              onChange={(to) => onChange({ ...value, to })}
              aria-label={t('dates.to')}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}
