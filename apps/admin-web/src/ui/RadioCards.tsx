import { useId, type ReactNode } from 'react';
import { cx } from './cx';
import { useFieldContext } from './Field';

export interface RadioCardOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  /** Extra facts on the card's end side, for example "On duty". */
  meta?: ReactNode;
  disabled?: boolean;
  /** Why it can't be picked ("No van — give one in Vans"); shown on the card. */
  disabledReason?: ReactNode;
}

export interface RadioCardsProps<T extends string = string> {
  options: readonly RadioCardOption<T>[];
  /** The picked value, or null for none (UX_ADMIN §2.6: no default for a correction's direction). */
  value: T | null;
  onChange: (value: T) => void;
  /** Read out when the group isn't inside a `<Field>`. */
  label?: string;
  name?: string;
  columns?: 1 | 2 | 3;
  className?: string;
}

/**
 * Large choice cards (UX_ADMIN §1.5). They are native radio buttons underneath, so the arrow keys move
 * between enabled cards and the group is read as one question.
 */
export function RadioCards<T extends string>({
  options,
  value,
  onChange,
  label,
  name,
  columns = 1,
  className,
}: RadioCardsProps<T>) {
  const field = useFieldContext();
  const auto = useId();
  const groupName = name ?? `radio-${auto}`;
  return (
    <div
      role="radiogroup"
      aria-labelledby={label ? undefined : field?.labelId}
      aria-label={label}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cx('sf-radio-cards', `sf-radio-cards--cols-${columns}`, className)}
    >
      {options.map((option, index) => {
        const id = `${groupName}-${index}`;
        const checked = value === option.value;
        return (
          <label key={option.value} htmlFor={id} className={cx('sf-radio-card', option.disabled && 'is-disabled')}>
            <input
              id={id}
              type="radio"
              name={groupName}
              value={option.value}
              checked={checked}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="sf-radio-card__input"
            />
            <span className={cx('sf-radio-card__body', checked && 'is-checked')}>
              <span className="sf-radio-card__mark" aria-hidden />
              <span className="sf-radio-card__text">
                <span className="sf-radio-card__label">{option.label}</span>
                {option.description ? <span className="sf-radio-card__description">{option.description}</span> : null}
                {option.disabled && option.disabledReason ? (
                  <span className="sf-radio-card__reason">{option.disabledReason}</span>
                ) : null}
              </span>
              {option.meta ? <span className="sf-radio-card__meta">{option.meta}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
