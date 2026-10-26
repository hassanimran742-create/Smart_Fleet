import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { useFieldControl } from './Field';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Read out when the switch isn't inside a `<Field>` (which labels it). */
  label?: string;
}

/** An on/off switch that says "On" or "Off" in words, never by colour alone (UX_ADMIN §1.5). */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, label, className, disabled, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const controlProps = useFieldControl(rest);
  return (
    <button
      {...controlProps}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx('sf-switch', checked && 'is-on', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="sf-switch__track" aria-hidden>
        <span className="sf-switch__thumb" />
      </span>
      <span className="sf-switch__text" aria-hidden>
        {checked ? t('switch.on') : t('switch.off')}
      </span>
    </button>
  );
});
