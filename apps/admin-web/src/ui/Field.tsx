import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';

interface FieldContextValue {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding `<Field>`'s ids, for controls that wire their own label (RadioCards, Switch). */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

interface ControlA11yProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}

/** Merges the Field's id, description and invalid state into a control's props. */
export function useFieldControl<P extends ControlA11yProps>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy = [field.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
  };
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** The error under the field (already translated). */
  error?: string | null;
  /** Shows "(Optional)" after the label. */
  optional?: boolean;
  /** Hide the label visually (it is still read out). */
  labelHidden?: boolean;
  /** The control's id; generated when not given. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/** A label, an optional hint, the control and its error (UX_ADMIN §1.5). */
export function Field({ label, hint, error, optional, labelHidden, id, className, children }: FieldProps) {
  const { t } = useTranslation();
  const auto = useId();
  const controlId = id ?? `field-${auto}`;
  const labelId = `${controlId}-label`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('sf-field', error && 'is-invalid', className)}>
      <label id={labelId} htmlFor={controlId} className={cx('sf-field__label', labelHidden && 'sr-only')}>
        {label}
        {optional ? <span className="sf-field__optional"> ({t('field.optional')})</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="sf-field__hint">
          {hint}
        </p>
      ) : null}
      <FieldContext.Provider value={{ id: controlId, labelId, describedBy, invalid: Boolean(error) }}>
        {children}
      </FieldContext.Provider>
      <p id={errorId} className="sf-field__error" aria-live="polite">
        {error ?? ''}
      </p>
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Text or an icon inside the box before the value, for example "Rs". */
  startAdornment?: ReactNode;
  /** Text inside the box after the value, for example "Pakistan time". */
  endAdornment?: ReactNode;
  /** Monospace, for references and codes. */
  mono?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { startAdornment, endAdornment, mono, className, type = 'text', ...props },
  ref,
) {
  const controlProps = useFieldControl(props);
  const input = (
    <input
      {...controlProps}
      ref={ref}
      type={type}
      className={cx('sf-input', mono && 'sf-input--mono', !startAdornment && !endAdornment && className)}
    />
  );
  if (!startAdornment && !endAdornment) return input;
  return (
    <div className={cx('sf-input-group', props.disabled && 'is-disabled', className)}>
      {startAdornment ? <span className="sf-input-group__affix">{startAdornment}</span> : null}
      {input}
      {endAdornment ? <span className="sf-input-group__affix sf-input-group__affix--end">{endAdornment}</span> : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Shows "240 / 300" under the box when `maxLength` is set (default true), once the text reaches 80% of
   * the limit (UX_ADMIN §1.8): below that it is noise.
   */
  showCounter?: boolean;
}

/** The share of `maxLength` from which the counter shows. */
const COUNTER_FROM = 0.8;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { showCounter = true, className, rows = 3, ...props },
  ref,
) {
  const { t } = useTranslation();
  const controlProps = useFieldControl(props);
  const length = typeof props.value === 'string' ? props.value.length : 0;
  const limit = props.maxLength;
  return (
    <div className={cx('sf-textarea-wrap', className)}>
      <textarea {...controlProps} ref={ref} rows={rows} className="sf-textarea" />
      {showCounter && limit && length >= Math.ceil(limit * COUNTER_FROM) ? (
        <span className={cx('sf-textarea__counter', length >= limit && 'is-full')} aria-hidden>
          {t('field.counter', { count: length, max: limit })}
        </span>
      ) : null}
    </div>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: readonly SelectOption[];
  /** A first, empty option ("Pick a type"); its value is "". */
  placeholder?: string;
}

/** A native select (UX_ADMIN §1.5): reliable on every laptop and tablet, and with the keyboard. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, children, ...props },
  ref,
) {
  const controlProps = useFieldControl(props);
  return (
    <select {...controlProps} ref={ref} className={cx('sf-select', className)}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options?.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
      {children}
    </select>
  );
});
