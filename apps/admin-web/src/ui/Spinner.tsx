import { useTranslation } from 'react-i18next';
import { cx } from './cx';

export interface SpinnerProps {
  /** Pixel size; 16 by default. */
  size?: number;
  /** Announced to screen readers; "Loading…" by default. */
  label?: string;
  /** A spinner inside something that already says it's busy (a button with aria-busy) stays silent. */
  decorative?: boolean;
  className?: string;
}

export function Spinner({ size = 16, label, decorative = false, className }: SpinnerProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cx('sf-spinner', className)}
      style={{ inlineSize: size, blockSize: size }}
      {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label ?? t('state.loading') })}
    />
  );
}
