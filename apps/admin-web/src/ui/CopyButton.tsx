import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from './Button';
import { cx } from './cx';

export interface CopyButtonProps {
  value: string;
  /** The button's text; "Copy" by default. With `iconOnly` it is the button's label for screen readers. */
  label?: string;
  size?: 'sm' | 'md';
  /** Only the Copy icon (a transaction ID in a list of facts, the error reference). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Copies `value` and says "Copied" for two seconds (UX_ADMIN §1.5). When the browser blocks the
 * clipboard, it shows the value in a selected read-only box so the person can copy it by hand.
 */
export function CopyButton({ value, label, size = 'sm', iconOnly = false, className }: CopyButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state !== 'copied') return;
    const id = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [state]);

  useEffect(() => {
    if (state === 'manual') inputRef.current?.select();
  }, [state]);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('manual');
    }
  };

  if (state === 'manual') {
    return (
      <span className={cx('sf-copy-manual', className)}>
        <input ref={inputRef} className="sf-input sf-input--mono" readOnly value={value} aria-label={t('copy.failed')} />
        <span className="sf-copy-manual__hint">{t('copy.failed')}</span>
      </span>
    );
  }

  if (iconOnly) {
    return (
      <span className={cx('sf-copy-icon', className)}>
        <IconButton
          icon={state === 'copied' ? Check : Copy}
          size={size}
          label={state === 'copied' ? t('copy.copied') : (label ?? t('actions.copy'))}
          onClick={() => void copy()}
        />
        <span className="sr-only" aria-live="polite">
          {state === 'copied' ? t('copy.copied') : ''}
        </span>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size={size}
      icon={state === 'copied' ? Check : Copy}
      onClick={() => void copy()}
      className={className}
      aria-live="polite"
    >
      {state === 'copied' ? t('copy.copied') : (label ?? t('actions.copy'))}
    </Button>
  );
}
