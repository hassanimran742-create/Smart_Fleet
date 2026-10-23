import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useMatches, useRouter } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Cylinder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { rememberedListSearch } from '../app/lastSearch';
import { MODULES } from '../app/modules';
import { groupOf, NAV_GROUPS, NAV_PINNED, QUEUE_BADGES, type NavBadge, type NavItem, type NavItemId } from '../app/nav';
import { useAppConfig } from '../hooks/useAppConfig';
import { cx } from '../ui/cx';
import { AccountMenu } from './AccountMenu';

export type SidebarCounts = Record<NavBadge, number>;

export interface SidebarProps {
  counts: SidebarCounts;
  /** `docked`: the side column from 1024 px, with the account row; `overlay`: the menu sheet under 1024 px. */
  variant?: 'docked' | 'overlay';
  /** Called after a link is followed, so the menu sheet can close. */
  onNavigate?: () => void;
  className?: string;
}

const SETUP_OPEN_KEY = 'smartfleet.admin.nav.setupOpen';
/** The height of the fade at the bottom of the scrolling list (`.sf-nav__fade`). */
const FADE_PX = 24;
/** A window at least this tall starts with Setup open; a 768 px laptop starts with it closed. */
const SETUP_OPEN_MIN_HEIGHT = 860;

function readSetupOpen(): boolean {
  try {
    const saved = window.localStorage.getItem(SETUP_OPEN_KEY);
    if (saved === '1' || saved === '0') return saved === '1';
  } catch {
    // Storage unavailable: use the window height.
  }
  return typeof window !== 'undefined' && window.innerHeight >= SETUP_OPEN_MIN_HEIGHT;
}

function writeSetupOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SETUP_OPEN_KEY, open ? '1' : '0');
  } catch {
    // The choice then lasts until the page reloads.
  }
}

/** The navigation item of the current page, from the deepest route that names one. */
function useActiveNavId(): NavItemId | undefined {
  const matches = useMatches();
  return [...matches].reverse().find((match) => match.staticData?.navId)?.staticData.navId;
}

/**
 * True while the list scrolls past its bottom edge, to show the fade there. It follows scrolling and any
 * change of size (a window resize, Setup opening, a feature's item appearing).
 */
function useMoreBelow(ref: { current: HTMLElement | null }): boolean {
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref]);
  return more;
}

interface NavLinkProps {
  item: NavItem;
  count: number;
  active: boolean;
  onNavigate?: () => void;
}

/**
 * One menu row: icon, label and badge. The link reopens the list's last tab and filters, except a queue
 * page with work waiting, which opens on its queue tab (UX_ADMIN §1.4).
 */
function NavLink({ item, count, active, onNavigate }: NavLinkProps) {
  const { t } = useTranslation('nav');
  const router = useRouter();
  const Icon = item.icon;
  const queue = QUEUE_BADGES[item.id];
  const href = queue && count > 0 ? item.to : `${item.to}${rememberedListSearch(item.to)}`;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void router.navigate({ href });
    onNavigate?.();
  };

  return (
    <a
      href={href}
      className={cx('sf-nav__link', active && 'is-active')}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon aria-hidden className="sf-nav__icon" size={18} strokeWidth={2} />
      <span className="sf-nav__label">{t(`items.${item.id}`)}</span>
      {item.badge && count > 0 ? (
        <>
          <span className="sf-nav__badge" aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
          <span className="sr-only">{t(`badges.${item.badge}`, { count })}</span>
        </>
      ) : null}
    </a>
  );
}

/**
 * The navigation (UX_ADMIN §1.3, website spec §1.1): the labelled sidebar from 1024 px (232 px from
 * 1280, 200 px below) and the same menu in the sheet under 1024 px. Today, then Work, Money and Setup
 * (which opens and closes, and remembers the choice), with Settings and Activity log pinned at the foot
 * and one account row under them. Badges: Today (everything waiting), Orders, Top-ups and Alerts.
 */
export function Sidebar({ counts, variant = 'docked', onNavigate, className }: SidebarProps) {
  const { t } = useTranslation(['nav', 'common']);
  const { config } = useAppConfig();
  const activeId = useActiveNavId();
  const activeGroup = activeId ? groupOf(activeId)?.id : undefined;
  const [setupOpen, setSetupOpen] = useState(() => activeGroup === 'setup' || readSetupOpen());
  const setupListId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Setup always opens when the current page is inside it.
  useEffect(() => {
    if (activeGroup === 'setup') setSetupOpen(true);
  }, [activeGroup]);

  const moreBelow = useMoreBelow(scrollRef);

  // Keep the current page's row in view (a Setup page on a short screen), clear of the bottom fade.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const active = container?.querySelector<HTMLElement>('.sf-nav__link.is-active');
    if (!container || !active || active.getClientRects().length === 0) return;
    const box = container.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    if (row.top < box.top) container.scrollTop -= box.top - row.top + FADE_PX;
    else if (row.bottom > box.bottom - FADE_PX) container.scrollTop += row.bottom - box.bottom + FADE_PX;
  }, [activeId, setupOpen]);

  const visible = (item: NavItem) => !item.module || config.features[MODULES[item.module].feature] === true;
  const countOf = (item: NavItem) => (item.badge ? counts[item.badge] : 0);
  const row = (item: NavItem) => (
    <li key={item.id}>
      <NavLink item={item} count={countOf(item)} active={item.id === activeId} onNavigate={onNavigate} />
    </li>
  );

  return (
    <nav aria-label={t('common:shell.mainNav')} className={cx('sf-nav', `sf-nav--${variant}`, className)}>
      <div className="sf-nav__brand">
        <span className="sf-nav__logo" aria-hidden>
          <Cylinder size={18} strokeWidth={2.25} />
        </span>
        <span className="sf-nav__product">{t('common:appName')}</span>
      </div>

      <div className="sf-nav__body">
        <div ref={scrollRef} className="sf-nav__scroll">
          <div className="sf-nav__groups">
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter(visible);
              if (items.length === 0) return null;
              if (group.heading === 'toggle') {
                const groupName = t(`groups.${group.id as 'setup'}`);
                const Chevron = setupOpen ? ChevronDown : ChevronRight;
                return (
                  <div key={group.id} className="sf-nav__group">
                    <button
                      type="button"
                      className="sf-nav__heading sf-nav__toggle"
                      aria-expanded={setupOpen}
                      aria-controls={setupListId}
                      aria-label={t('groupToggle', { group: groupName })}
                      onClick={() => {
                        const next = !setupOpen;
                        setSetupOpen(next);
                        writeSetupOpen(next);
                      }}
                    >
                      <span>{groupName}</span>
                      <Chevron aria-hidden className="sf-nav__toggle-icon" size={14} strokeWidth={2.25} />
                    </button>
                    <ul id={setupListId} className="sf-nav__list" hidden={!setupOpen}>
                      {items.map(row)}
                    </ul>
                  </div>
                );
              }
              return (
                <div key={group.id} className="sf-nav__group">
                  {group.heading === 'plain' ? (
                    <p className="sf-nav__heading">{t(`groups.${group.id as 'work' | 'money'}`)}</p>
                  ) : null}
                  <ul className="sf-nav__list">{items.map(row)}</ul>
                </div>
              );
            })}
          </div>
        </div>
        {moreBelow ? <span className="sf-nav__fade" aria-hidden /> : null}
      </div>

      <div className="sf-nav__pinned">
        <ul className="sf-nav__list">{NAV_PINNED.filter(visible).map(row)}</ul>
      </div>

      {variant === 'docked' ? (
        <div className="sf-nav__footer">
          <AccountMenu placement="up" tone="nav" />
        </div>
      ) : null}
    </nav>
  );
}
