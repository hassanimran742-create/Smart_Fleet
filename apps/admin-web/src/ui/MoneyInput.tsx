import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { formatRs, formatRupeesInput, parseRupeesInput, toRupeesInput } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { translateDynamic } from '../i18n';
import { TextInput, useFieldContext } from './Field';

export interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'inputMode'> {
  /** The amount in paisa as a digit string ("500000" is Rs 5,000), or null when empty. */
  valuePaisa: string | null;
  /** Called with a paisa digit string, or null when the box is empty or isn't whole rupees. */
  onChange: (valuePaisa: string | null) => void;
  /** Smallest amount in paisa; checked when the box loses focus. */
  min?: number;
  /** Largest amount in paisa; checked when the box loses focus. */
  max?: number;
  /** Allow Rs 0 (delivery prices allow it); false by default. */
  allowZero?: boolean;
}

function textFor(valuePaisa: string | null): string {
  if (valuePaisa === null || !/^\d+$/.test(valuePaisa)) return '';
  return toRupeesInput(valuePaisa);
}

/**
 * A rupee amount (UX_ADMIN §1.5, §1.8): "Rs" prefix, digits and commas only, whole rupees, separators
 * added on blur. A typed decimal ("275.50") stays in the box with "Whole rupees only" until it is fixed;
 * the box is never emptied behind the person's back. It hands back a paisa digit string.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { valuePaisa, onChange, min, max, allowZero = false, onBlur, onFocus, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const field = useFieldContext();
  const localId = useId();
  const [text, setText] = useState(() => textFor(valuePaisa));
  /** A typed decimal: always shown, since it is why the form has no amount. */
  const [decimal, setDecimal] = useState(false);
  /** Below the minimum or above the maximum: shown unless the form already shows its own error. */
  const [boundsMessage, setBoundsMessage] = useState<string | null>(null);
  // The last value this box handed to the form: when the form echoes it back, the typed text stays.
  const lastEmitted = useRef<string | null | undefined>(undefined);

  // Follow a change from outside (a reset, a prefill, "Copy from…"), never our own echo.
  useEffect(() => {
    if (valuePaisa === lastEmitted.current) return;
    lastEmitted.current = undefined;
    setText(textFor(valuePaisa));
    setDecimal(false);
    setBoundsMessage(null);
  }, [valuePaisa]);

  const emit = (paisa: string | null) => {
    lastEmitted.current = paisa;
    onChange(paisa);
  };

  const boundsError = (paisa: number): string | null => {
    const floor = min ?? (allowZero ? 0 : 100);
    if (paisa < floor) {
      return translateDynamic('validation:AMOUNT_TOO_SMALL', { min: formatRs(floor) });
    }
    if (max !== undefined && paisa > max) {
      return translateDynamic('validation:AMOUNT_TOO_LARGE', { max: formatRs(max) });
    }
    return null;
  };

  const handleChange = (raw: string) => {
    if (/[.٫]/.test(raw)) {
      // Keep what they typed so they can see it, but it isn't an amount.
      setText(raw);
      setDecimal(true);
      setBoundsMessage(null);
      emit(null);
      return;
    }
    const cleaned = raw.replace(/[^\d,\s٠-٩۰-۹]/g, '');
    setText(cleaned);
    setDecimal(false);
    setBoundsMessage(null);
    const paisa = parseRupeesInput(cleaned);
    emit(paisa === null ? null : String(paisa));
  };

  const localError = decimal ? t('money.wholeRupeesOnly') : boundsMessage;
  const showLocal = decimal || (boundsMessage !== null && !field?.invalid);
  const describedBy = [rest['aria-describedby'], showLocal ? `${localId}-msg` : undefined].filter(Boolean).join(' ');

  return (
    <>
      <TextInput
        {...rest}
        ref={ref}
        value={text}
        inputMode="numeric"
        autoComplete="off"
        startAdornment={t('money.prefix')}
        aria-describedby={describedBy || undefined}
        aria-invalid={showLocal || undefined}
        onFocus={onFocus}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={(event) => {
          const paisa = parseRupeesInput(text);
          if (paisa !== null) {
            setText(formatRupeesInput(text));
            setBoundsMessage(boundsError(paisa));
          }
          onBlur?.(event);
        }}
        className="sf-money-input"
      />
      {showLocal ? (
        <p id={`${localId}-msg`} className="sf-field__error" aria-live="polite">
          {localError}
        </p>
      ) : null}
    </>
  );
});
