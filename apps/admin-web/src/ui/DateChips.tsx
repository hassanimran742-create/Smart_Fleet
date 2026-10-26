import { useEffect, useRef, useState } from 'react';
import { addDays } from '@smartfleet/shared-utils';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { todayInKarachi } from './dateRange';
import { useFieldContext } from './Field';
import { FilterChips, type FilterChipOption } from './FilterChips';

type DateChoice = 'today' | 'yesterday' | 'pick';

export interface DateChipsProps {
  /** `YYYY-MM-DD`, or "" for none (the top-up bank date starts with none: one deliberate tap). */
  value: string;
  onChange: (value: string) => void;
  /** Today's date, `YYYY-MM-DD`; the Asia/Karachi calendar date by default. */
  today?: string;
  /** Earliest date, `YYYY-MM-DD`. */
  min?: string;
  /** Latest date, `YYYY-MM-DD`: pass today where the future is blocked. */
  max?: string;
  /** Names the chips for screen readers when they aren't inside a `<Field>`. */
  label?: string;
  disabled?: boolean;
  /** Called when the focus leaves the chips and the calendar box. */
  onBlur?: () => void;
  className?: string;
}

function within(date: string, min?: string, max?: string): boolean {
  return (!min || date >= min) && (!max || date <= max);
}

/**
 * A date by tapping (UX_ADMIN §1.8): Today · Yesterday · Pick date. "Pick date" shows the browser's own
 * calendar box beside the chips and opens it, so no date is ever typed as text. Dates outside `min` and
 * `max` can't be picked (the future stays blocked where it is today).
 */
export function DateChips({ value, onChange, today, min, max, label, disabled = false, onBlur, className }: DateChipsProps) {
  const { t } = useTranslation();
  const field = useFieldContext();
  const todayDate = today ?? todayInKarachi();
  const yesterday = addDays(todayDate, -1);
  const [picking, setPicking] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const derived: DateChoice | null =
    value === todayDate ? 'today' : value === yesterday ? 'yesterday' : value ? 'pick' : null;
  const choice: DateChoice | null = picking ? 'pick' : derived;

  // A date that is Today or Yesterday again (picked in the calendar, or set from outside) shows on its chip.
  useEffect(() => {
    if (value === todayDate || value === yesterday) setPicking(false);
  }, [value, todayDate, yesterday]);

  const openCalendar = () => {
    window.requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      try {
        box.showPicker?.();
      } catch {
        // Some browsers allow showPicker only on a direct click; the box is focused and can be typed in.
      }
    });
  };

  const options: FilterChipOption<DateChoice>[] = [
    { value: 'today', label: t('dates.today'), disabled: disabled || !within(todayDate, min, max) },
    { value: 'yesterday', label: t('dates.yesterday'), disabled: disabled || !within(yesterday, min, max) },
    { value: 'pick', label: t('dates.pickDate'), icon: CalendarDays, disabled },
  ];

  const pick = (next: DateChoice) => {
    if (next === 'today') {
      setPicking(false);
      onChange(todayDate);
    } else if (next === 'yesterday') {
      setPicking(false);
      onChange(yesterday);
    } else {
      setPicking(true);
      openCalendar();
    }
  };

  return (
    <div
      ref={rootRef}
      className={cx('sf-date-chips', className)}
      onBlur={(event) => {
        if (onBlur && !(event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget))) onBlur();
      }}
    >
      <FilterChips options={options} value={choice} onChange={pick} label={label} />
      {choice === 'pick' ? (
        <input
          ref={boxRef}
          type="date"
          className="sf-input sf-date-chips__box"
          value={derived === 'pick' ? value : ''}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={t('dates.pickDate')}
          aria-describedby={field?.describedBy}
          aria-invalid={field?.invalid || undefined}
          onChange={(event) => {
            const picked = event.target.value;
            if (!picked) return;
            // Today or Yesterday picked in the calendar shows on its own chip.
            if (picked === todayDate || picked === yesterday) setPicking(false);
            onChange(picked);
          }}
        />
      ) : null}
    </div>
  );
}
