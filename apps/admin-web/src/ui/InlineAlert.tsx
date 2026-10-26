import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cx } from './cx';

/** `neutral` is a plain fact with nothing to do (an order's outcome: "Rs 400 returned to the wallet"). */
export type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const ICONS: Record<AlertTone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export interface InlineAlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button or link on the end side ("Reload", "Show only missing"). */
  action?: ReactNode;
  /** Replaces the tone's icon, for example Wallet on "Rs 360 goes back to Ahmed Gas's wallet." */
  icon?: LucideIcon;
  /**
   * Announce it when it appears (an error after a submit). Leave false for alerts that are part of the
   * page, so a screen reader isn't interrupted on every load.
   */
  live?: boolean;
  className?: string;
}

/** A message inside the page (UX_ADMIN §1.5). The icon is decorative: the words carry the meaning. */
export function InlineAlert({ tone = 'info', title, children, action, icon, live = false, className }: InlineAlertProps) {
  const Icon = icon ?? ICONS[tone];
  const liveProps = live ? (tone === 'danger' ? { role: 'alert' } : { role: 'status' }) : {};
  return (
    <div {...liveProps} className={cx('sf-alert', `sf-alert--${tone}`, className)}>
      <Icon aria-hidden className="sf-alert__icon" size={18} strokeWidth={2} />
      <div className="sf-alert__content">
        {title ? <p className="sf-alert__title">{title}</p> : null}
        {children ? <div className="sf-alert__body">{children}</div> : null}
      </div>
      {action ? <div className="sf-alert__action">{action}</div> : null}
    </div>
  );
}
