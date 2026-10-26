import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { qk } from '../api/keys';
import { AccountMenu } from '../components/AccountMenu';
import { Sidebar, type SidebarCounts } from '../components/Sidebar';
import { navBadgeCounts, useAdminSummary } from '../hooks/useAdminSummary';
import { useAppConfig } from '../hooks/useAppConfig';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { IconButton } from '../ui/Button';
import { EnvBadge } from '../ui/EnvBadge';
import { Portal, useOverlay } from '../ui/overlay';
import { resolveEnvKind } from './env';
import { rememberListSearch } from './lastSearch';
import { NAV_GROUPS, NAV_PINNED } from './nav';
import { useDocumentTitle, usePageTitle } from './titles';

const ALERTS_POLL_MS = 60_000;

/** The list pages whose last tab and filters the menu links reopen (UX_ADMIN §1.4). */
const LIST_PATHS: ReadonlySet<string> = new Set([...NAV_GROUPS.flatMap((group) => group.items), ...NAV_PINNED].map((item) => item.to));

/** The Alerts badge, from the same route the old sidebar used. */
function useUnreadAlerts(): number {
  const query = useQuery({
    queryKey: qk.alertsUnread(),
    queryFn: async ({ signal }) => (await api.get<{ count?: number }>('/alerts/unread-count', { signal })).data,
    refetchInterval: ALERTS_POLL_MS,
  });
  const count = query.data?.count;
  return typeof count === 'number' && count > 0 ? count : 0;
}

function NavSheet({ counts, onClose }: { counts: SidebarCounts; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(ref, true, { onEscape: onClose });
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  return (
    <Portal>
      <div className="sf-overlay sf-overlay--nav" onMouseDown={onBackdrop}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label={t('shell.mainNav')} className="sf-nav-sheet" tabIndex={-1}>
          <div className="sf-nav-sheet__close">
            <IconButton icon={X} variant="nav" label={t('shell.closeMenu')} onClick={onClose} tooltip={false} />
          </div>
          <Sidebar counts={counts} variant="overlay" onNavigate={onClose} />
        </div>
      </div>
    </Portal>
  );
}

/**
 * The shell (UX_ADMIN §1.3, website spec §1.1): the environment strip on test and training servers,
 * the labelled sidebar from 1024 px with no top bar (the page header starts at the top), and under
 * 1024 px a 56 px top bar with the menu button, the page title and the account menu. Pages render into
 * its `<Outlet/>`.
 */
export function AppShell() {
  const { t } = useTranslation();
  const { config } = useAppConfig();
  const summary = useAdminSummary();
  const alerts = useUnreadAlerts();
  const badges = navBadgeCounts(summary.data);
  const counts: SidebarCounts = { ...badges, alerts };
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const pageTitle = usePageTitle();

  useIdleLogout();
  useDocumentTitle(badges.waiting, config.environment);

  // A new page closes the menu sheet.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The menu link of a list page reopens its last tab and filters.
  useEffect(() => {
    const path = pathname.replace(/\/+$/, '') || '/';
    if (LIST_PATHS.has(path)) rememberListSearch(path, searchStr);
  }, [pathname, searchStr]);

  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('main')?.focus();
  };

  const envKind = resolveEnvKind(config.environment);

  return (
    <div className="sf-app" data-env={envKind}>
      <a href="#main" className="sf-skip-link" onClick={skipToContent}>
        {t('shell.skipToContent')}
      </a>
      <EnvBadge kind={envKind} />
      <div className="sf-shell">
        <Sidebar counts={counts} className="sf-shell__nav" />
        <div className="sf-shell__body">
          {/* Under 1024 px only: from 1024 px the sidebar holds the menu and the account. */}
          <header className="sf-topbar">
            <IconButton
              icon={Menu}
              label={t('shell.openMenu')}
              className="sf-topbar__menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              tooltip={false}
            />
            <span className="sf-topbar__title" aria-hidden>
              {pageTitle}
            </span>
            <div className="sf-topbar__end">
              <AccountMenu placement="down" tone="bar" />
            </div>
          </header>
          <main id="main" className="sf-main" tabIndex={-1}>
            <div className="sf-main__inner">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {menuOpen ? <NavSheet counts={counts} onClose={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
