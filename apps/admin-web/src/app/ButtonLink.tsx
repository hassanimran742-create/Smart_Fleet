import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { createLink } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ButtonSize, ButtonVariant } from '../ui/Button';
import { cx } from '../ui/cx';

interface ButtonAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
}

const ButtonAnchor = forwardRef<HTMLAnchorElement, ButtonAnchorProps>(function ButtonAnchor(
  { variant = 'secondary', size = 'md', icon: Icon, className, children, ...rest },
  ref,
) {
  return (
    <a {...rest} ref={ref} className={cx('sf-btn', `sf-btn--${variant}`, `sf-btn--${size}`, className)}>
      <span className="sf-btn__content">
        {Icon ? <Icon aria-hidden className="sf-btn__icon" size={16} strokeWidth={2} /> : null}
        <span className="sf-btn__label">{children}</span>
      </span>
    </a>
  );
});

/**
 * A router link that looks like a `<Button>`, for actions that open another page ("Check top-ups",
 * "Open settings"). Typed like `<Link>`: `<ButtonLink to="/topups" search={{ tab: 'to-check' }}>`.
 */
export const ButtonLink = createLink(ButtonAnchor);
