import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, CircleUserRound, LogOut, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { signOut } from '../api/client';
import { useMe } from '../hooks/useMe';
import { cx } from '../ui/cx';
import { Skeleton } from '../ui/Skeleton';

export interface AccountMenuProps {
  /** `up` at the foot of the sidebar, `down` in the top bar under 1024 px. */
  placement?: 'up' | 'down';
  /** `nav` on the dark sidebar, `bar` on the white top bar. */
  tone?: 'nav' | 'bar';
  className?: string;
}

/**
 * The one place for the account (website spec §1.1): a row with an icon, the person's name and a
 * chevron, opening a menu with My profile and Sign out. While the name loads, a fixed-width skeleton
 * keeps its space. Arrow keys move between the two items; Esc closes the menu and returns the focus.
 */
export function AccountMenu({ placement = 'up', tone = 'nav', className }: AccountMenuProps) {
  const { t } = useTranslation(['common', 'nav']);
  const me = useMe();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const menuId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusFirst.current = true;
      setOpen(true);
    }
  };

  const moveInMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const index = items.findIndex((item) => item === document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  };

  const name = me.data?.name;
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <div ref={rootRef} className={cx('sf-account', `sf-account--${tone}`, className)}>
      <button
        ref={buttonRef}
        type="button"
        className="sf-account__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          // A keyboard press (Enter or Space reports no pointer position) puts the focus on the first item.
          focusFirst.current = event.detail === 0;
          setOpen((value) => !value);
        }}
        onKeyDown={onButtonKey}
      >
        <CircleUserRound aria-hidden className="sf-account__icon" size={20} strokeWidth={2} />
        <span className="sf-account__name">{name ?? (me.isPending ? <Skeleton width="7em" /> : null)}</span>
        <span className="sr-only">{t('shell.accountMenu')}</span>
        <Chevron aria-hidden className="sf-account__chevron" size={16} strokeWidth={2} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('shell.accountMenu')}
          className={cx('sf-account__menu', `sf-account__menu--${placement}`)}
          onKeyDown={moveInMenu}
        >
          <Link to="/profile" role="menuitem" className="sf-account__item" onClick={() => close(false)}>
            <UserRound aria-hidden size={16} strokeWidth={2} />
            {t('nav:items.profile')}
          </Link>
          <button type="button" role="menuitem" className="sf-account__item" onClick={signOut}>
            <LogOut aria-hidden size={16} strokeWidth={2} />
            {t('actions.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
