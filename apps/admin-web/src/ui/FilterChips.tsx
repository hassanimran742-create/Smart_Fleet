import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { useFieldContext } from './Field';

export interface FilterChipOption<T extends string = string> {
  value: T;
  /** 1–3 words. */
  label: ReactNode;
  /** A small muted count after the label ("Missing 1"); hidden when null or undefined. */
  count?: number | null;
  /** Words after the label in a tone, for example a red "1 missing" or a green "All set". */
  meta?: ReactNode;
  metaTone?: 'muted' | 'success' | 'danger' | 'warning';
  /** An icon before the label (for example CalendarDays on "Pick date"); the selected tick replaces it. */
  icon?: LucideIcon;
  disabled?: boolean;
}

interface FilterChipsBaseProps<T extends string> {
  options: readonly FilterChipOption<T>[];
  /** Names the group for screen readers when it isn't inside a `<Field>`, for example "Dates". */
  label?: string;
  className?: string;
}

export interface FilterChipsSingleProps<T extends string> extends FilterChipsBaseProps<T> {
  multiple?: false;
  /** The picked value, or null for none (a deliberate first tap, as the top-up bank date). */
  value: T | null;
  onChange: (value: T) => void;
}

export interface FilterChipsMultipleProps<T extends string> extends FilterChipsBaseProps<T> {
  /** Several can be on, each a toggle (Inc 2: the answers that open a problem). */
  multiple: true;
  value: readonly T[];
  onChange: (value: T[]) => void;
}

export type FilterChipsProps<T extends string> = FilterChipsSingleProps<T> | FilterChipsMultipleProps<T>;

function ChipContent<T extends string>({ option, selected }: { option: FilterChipOption<T>; selected: boolean }) {
  const Icon = selected ? Check : option.icon;
  return (
    <>
      {Icon ? <Icon aria-hidden className="sf-filter-chip__icon" size={14} strokeWidth={2.5} /> : null}
      <span className="sf-filter-chip__label">{option.label}</span>
      {option.count !== undefined && option.count !== null ? (
        <span className="sf-filter-chip__count">{option.count}</span>
      ) : null}
      {option.meta ? (
        <span className={cx('sf-filter-chip__meta', `sf-filter-chip__meta--${option.metaTone ?? 'muted'}`)}>{option.meta}</span>
      ) : null}
    </>
  );
}

/**
 * 2–6 short options as chips (UX_PRINCIPLES §3, UX_ADMIN §1.4): dates, distributors, the wallet history
 * type, Activity "What". One pick is a radio group (arrow keys move and pick, as Tabs do); `multiple`
 * makes each chip a toggle. A picked chip has the soft fill, the blue edge and a tick, so it never
 * relies on colour alone. The chips wrap; they never scroll sideways.
 */
export function FilterChips<T extends string>(props: FilterChipsProps<T>) {
  const { options, label, className } = props;
  const field = useFieldContext();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelling = { 'aria-labelledby': label ? undefined : field?.labelId, 'aria-label': label };

  if (props.multiple) {
    const picked = new Set<T>(props.value);
    const toggle = (value: T) => {
      const next = picked.has(value) ? props.value.filter((v) => v !== value) : [...props.value, value];
      props.onChange(next);
    };
    return (
      <div role="group" {...labelling} aria-describedby={field?.describedBy} className={cx('sf-chips', className)}>
        {options.map((option) => {
          const selected = picked.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={option.disabled}
              className={cx('sf-filter-chip', selected && 'is-selected')}
              onClick={() => toggle(option.value)}
            >
              <ChipContent option={option} selected={selected} />
            </button>
          );
        })}
      </div>
    );
  }

  const { value, onChange } = props;
  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  // The one chip in the tab order: the picked one, else the first that can be picked.
  const tabStop = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : (enabled[0] ?? -1);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const current = refs.current.findIndex((el) => el === document.activeElement);
    const position = enabled.indexOf(current >= 0 ? current : tabStop);
    const rtl = document.documentElement.dir === 'rtl';
    let next = position;
    if (event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (position + 1) % enabled.length;
    else if (event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (position - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    const index = enabled[next];
    const target = index === undefined ? undefined : options[index];
    if (index === undefined || !target) return;
    onChange(target.value);
    refs.current[index]?.focus();
  };

  return (
    <div
      role="radiogroup"
      {...labelling}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cx('sf-chips', className)}
      onKeyDown={move}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={option.disabled}
            className={cx('sf-filter-chip', selected && 'is-selected')}
            onClick={() => onChange(option.value)}
          >
            <ChipContent option={option} selected={selected} />
          </button>
        );
      })}
    </div>
  );
}

export interface ToggleChipProps {
  /** 1–3 words: "Show suspended", "Show removed", "Add driver fuel logs". */
  label: ReactNode;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  /** A small muted count after the label. */
  count?: number | null;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
}

/**
 * A yes/no list filter as one chip (UX_ADMIN §1.4), never a Switch with "Off" printed before its label.
 * It is a toggle button (`aria-pressed`) with the same look as FilterChips.
 */
export function ToggleChip({ label, pressed, onChange, count, disabled, id, className, ...rest }: ToggleChipProps) {
  return (
    <button
      id={id}
      type="button"
      aria-pressed={pressed}
      aria-describedby={rest['aria-describedby']}
      disabled={disabled}
      className={cx('sf-filter-chip', pressed && 'is-selected', className)}
      onClick={() => onChange(!pressed)}
    >
      <ChipContent option={{ value: 'toggle', label, count }} selected={pressed} />
    </button>
  );
}
