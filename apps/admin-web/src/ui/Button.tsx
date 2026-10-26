import { forwardRef, useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ghost-danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  /** At most one `primary` per screen (UX_ADMIN rules). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the button's width and ignores clicks. */
  loading?: boolean;
  disabled?: boolean;
  /**
   * Why the button can't be pressed now ("Amounts must match"). The button stays focusable
   * (aria-disabled), shows the reason as a tooltip and announces it through aria-describedby.
   */
  disabledReason?: string;
  /**
   * Shows `disabledReason` as muted text beside the button instead of a tooltip (UX_ADMIN §1.7: a button
   * is disabled only when nothing on this screen can fix it, and then it says why where it can be read).
   */
  reasonVisible?: boolean;
  /** A lucide icon before the label; it is decorative, the label carries the meaning. */
  icon?: LucideIcon;
  /** A lucide icon after the label. */
  iconEnd?: LucideIcon;
  children?: ReactNode;
}

/** The one button (UX_ADMIN §1.5). Its type is "button" unless said otherwise, so it never submits by accident. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    disabledReason,
    reasonVisible = false,
    icon: Icon,
    iconEnd: IconEnd,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const reasonId = useId();
  const showReason = disabled && Boolean(disabledReason);
  const inert = disabled || loading;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const describedBy = [rest['aria-describedby'], showReason ? reasonId : undefined].filter(Boolean).join(' ') || undefined;

  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx('sf-btn', `sf-btn--${variant}`, `sf-btn--${size}`, loading && 'is-loading', className)}
      // A plain disabled button leaves the tab order; one with a reason stays reachable so it can explain itself.
      disabled={disabled && !disabledReason}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      aria-describedby={describedBy}
      onClick={handleClick}
    >
      <span className="sf-btn__content">
        {Icon ? <Icon aria-hidden className="sf-btn__icon" size={16} strokeWidth={2} /> : null}
        {children !== undefined && children !== null ? <span className="sf-btn__label">{children}</span> : null}
        {IconEnd ? <IconEnd aria-hidden className="sf-btn__icon" size={16} strokeWidth={2} /> : null}
      </span>
      {loading ? (
        <span className="sf-btn__spinner">
          <Spinner decorative size={16} />
        </span>
      ) : null}
    </button>
  );

  if (!showReason) return button;
  if (reasonVisible) {
    return (
      <span className="sf-btn-reason">
        <span id={reasonId} className="sf-btn-reason__text">
          {disabledReason}
        </span>
        {button}
      </span>
    );
  }
  return (
    <span className="sf-tip">
      {button}
      <span role="tooltip" id={reasonId} className="sf-tip__bubble">
        {disabledReason}
      </span>
    </span>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Required: what the button does, read by screen readers and shown as a tooltip. */
  label: string;
  icon: LucideIcon;
  variant?: 'ghost' | 'secondary' | 'ghost-danger' | 'nav';
  size?: 'sm' | 'md';
  /** Show the label as a tooltip on hover and focus (default true). */
  tooltip?: boolean;
}

/** A button with only an icon. It always has a label (UX_ADMIN §1.8). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, variant = 'ghost', size = 'md', tooltip = true, className, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      className={cx('sf-icon-btn', `sf-icon-btn--${variant}`, `sf-icon-btn--${size}`, className)}
    >
      <Icon aria-hidden size={size === 'sm' ? 16 : 18} strokeWidth={2} />
    </button>
  );
  if (!tooltip) return button;
  return (
    <span className="sf-tip">
      {button}
      <span aria-hidden className="sf-tip__bubble">
        {label}
      </span>
    </span>
  );
});
