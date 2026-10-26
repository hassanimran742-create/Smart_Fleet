import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { toAsciiDigits } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { TextInput } from './Field';

export interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /**
   * What the form holds: E.164 ("+923001234567") once the number is complete, "+92" and the digits typed
   * so far while it isn't (the form's check then says what to fix), or "" when the box is empty.
   */
  value: string;
  onChange: (value: string) => void;
}

/** A Pakistani mobile has 10 digits after +92: 3XX XXXXXXX. */
const NATIONAL_DIGITS = 10;

/**
 * The digits after +92 in what was typed or stored, and how many leading digits were dropped: Urdu
 * digits are read, a +92, 0092 or 92 country code and a trunk 0 are dropped, and at most 10 digits stay.
 */
export function splitPkNational(raw: string): { digits: string; dropped: number } {
  const all = toAsciiDigits(raw).replace(/\D/g, '');
  let digits = all;
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (/^\s*\+/.test(raw) && digits.startsWith('92')) digits = digits.slice(2);
  // "92…" with no plus is a country code only once it is too long to be a number without one.
  else if (digits.startsWith('92') && digits.length > NATIONAL_DIGITS) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  return { digits: digits.slice(0, NATIONAL_DIGITS), dropped: all.length - digits.length };
}

/** "3001234567" → "300 1234567", spaced as it is typed. */
function spaced(digits: string): string {
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** Where the caret goes in the spaced text so it stays after the same digit. */
function caretFor(digitIndex: number): number {
  return digitIndex > 3 ? digitIndex + 1 : digitIndex;
}

function toFormValue(digits: string): string {
  return digits ? `+92${digits}` : '';
}

/**
 * A Pakistani mobile number (UX_ADMIN §1.8): "+92" is fixed before the box and the person types only
 * "300 1234567". A typed or pasted leading 0, +92 or 0092 is dropped as it is typed, and the number is
 * spaced the way it is read, never rewritten into another form. The form gets E.164; the server
 * normalises again and is the judge (CLIENT_PHONE_INVALID).
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, placeholder, autoComplete, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => spaced(splitPkNational(value).digits));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastEmitted = useRef<string | undefined>(undefined);
  const pendingCaret = useRef<number | null>(null);

  // Follow a change from outside (a reset, a prefill), but never undo what is being typed.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    setText(spaced(splitPkNational(value).digits));
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (pendingCaret.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <TextInput
      {...rest}
      ref={setRefs}
      type="tel"
      inputMode="tel"
      autoComplete={autoComplete ?? 'tel-national'}
      startAdornment={t('phone.prefix')}
      placeholder={placeholder ?? t('phone.placeholder')}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        const caret = event.target.selectionStart ?? raw.length;
        const { digits, dropped } = splitPkNational(raw);
        const digitsBeforeCaret = toAsciiDigits(raw.slice(0, caret)).replace(/\D/g, '').length;
        pendingCaret.current = caretFor(Math.min(Math.max(digitsBeforeCaret - dropped, 0), digits.length));
        setText(spaced(digits));
        const next = toFormValue(digits);
        lastEmitted.current = next;
        onChange(next);
      }}
    />
  );
});
