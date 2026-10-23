import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Ellipsis } from 'lucide-react';
import { Button, cx, useOverlay } from '../../ui';
import './orders.css';

export interface MoreMenuItem {
  id: string;
  label: string;
  /** A short line under the label, for example why another action isn't offered. */
  description?: string;
  /** Destructive actions are drawn in the danger colour, and come last after a divider. */
  danger?: boolean;
  /** A thin line above this item, between routine actions and a dangerous one. */
  dividerBefore?: boolean;
  onSelect: () => void;
}

export interface MoreMenuProps {
  /** The button's text, for example "More". */
  label: string;
  /** Read out for the button, for example "More actions for AG-0142". */
  ariaLabel?: string;
  items: readonly MoreMenuItem[];
  /** `up` in a drawer footer, `down` under a page header. */
  placement?: 'up' | 'down';
  /** `sm` beside the small buttons of a table row. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A "More" button with a small menu of actions (UX_ADMIN §2.4, §1.5): the distributor page's Change
 * code and Suspend…, a legacy row's rarer actions. It holds at least 2 items (a single action is its
 * own button). The focus starts on the first item, so a dangerous last item is never focused first.
 * Arrow keys, Home and End move between items, Esc closes it and returns focus to the button, and a
 * click outside closes it. It sits on top of any open drawer, so Esc closes only the menu.
 */
export function MoreMenu({ label, ariaLabel, items, placement = 'down', size = 'md', className }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useOverlay(menuRef, open, { onEscape: () => setOpen(false), lockScroll: false });

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (buttons.length === 0) return;
    const index = buttons.findIndex((button) => button === document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className={cx('sf-more', className)}>
      <Button
        size={size}
        icon={Ellipsis}
        iconEnd={ChevronDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? label}
          tabIndex={-1}
          className={cx('sf-more__menu', `sf-more__menu--${placement}`)}
          onKeyDown={move}
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.dividerBefore ? <div role="separator" className="sf-more__divider" /> : null}
              <button
                type="button"
                role="menuitem"
                className={cx('sf-more__item', item.danger && 'is-danger')}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="sf-more__label">{item.label}</span>
                {item.description ? <span className="sf-more__description">{item.description}</span> : null}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
