import type { MouseEvent, ReactNode } from 'react';
import { useMatches, useRouter } from '@tanstack/react-router';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNow } from '../hooks/useNow';
import { formatAgo } from '../i18n/format';
import { IconButton } from './Button';
import { cx } from './cx';

/** Where a sub-page's back link goes ("← Wallets"). */
export interface PageHeaderBack {
  /** An in-app path, for example "/wallets". */
  to: string;
  label: string;
}

export interface PageHeaderProps {
  /** The page's h1 (20 px). While loading, a skeleton bar or the record's name from the list. */
  title: ReactNode;
  /** One line of 12 words or fewer (UX_PRINCIPLES §6). */
  subtitle?: ReactNode;
  /** A muted line under the subtitle, for example "Approved today: Rs 12,000 · 3 top-ups". */
  meta?: ReactNode;
  /** A status chip next to the title. */
  chip?: ReactNode;
  /** The one primary action of the screen. */
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  /**
   * A sub-page's back link above the title (UX_ADMIN §1.3: there is no breadcrumb from 1024 px).
   * Left out, it follows the route's parent page (`staticData.parent`, so the wallet page links back to
   * Wallets); `null` shows none.
   */
  back?: PageHeaderBack | null;
  /**
   * When the data was last loaded (epoch ms, e.g. `query.dataUpdatedAt`): shows "Updated 12 s ago". Only
   * pages that refresh by themselves pass it (Today, Top-ups, Orders).
   */
  updatedAt?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}

/** The parent page named by the route (app/routeMeta.ts), as a back link. */
function useRouteBack(): PageHeaderBack | null {
  const { t } = useTranslation('nav');
  const matches = useMatches();
  const parent = [...matches].reverse().find((match) => match.staticData?.parent)?.staticData.parent;
  return parent ? { to: parent.href, label: t(`pages.${parent.titleKey}`) } : null;
}

function BackLink({ to, label }: PageHeaderBack) {
  const router = useRouter();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/Cmd-click and middle-click still open a new tab.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void router.navigate({ href: to });
  };
  return (
    <a href={to} className="sf-page-header__back" onClick={onClick}>
      <ArrowLeft aria-hidden className="sf-page-header__back-icon" size={16} strokeWidth={2} />
      <span>{label}</span>
    </a>
  );
}

/**
 * The top of every page (UX_ADMIN §1.2): the back link on sub-pages, then one row with the title, its
 * chip, the freshness ("Updated 12 s ago ⟳", polled pages only) and the actions; then the subtitle and
 * the meta line.
 */
export function PageHeader({
  title,
  subtitle,
  meta,
  chip,
  primaryAction,
  secondaryActions,
  back,
  updatedAt,
  onRefresh,
  refreshing = false,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation();
  const now = useNow(updatedAt ? 1000 : 60_000);
  const routeBack = useRouteBack();
  const backLink = back === undefined ? routeBack : back;
  const hasActions = Boolean(primaryAction || secondaryActions);
  const freshness = updatedAt ? (
    <p className="sf-page-header__freshness">
      <span aria-live="off">
        {refreshing ? t('state.refreshing') : t('freshness.updated', { ago: formatAgo(updatedAt, now) })}
      </span>
      {onRefresh ? (
        <IconButton
          icon={RotateCw}
          size="sm"
          label={t('actions.refresh')}
          onClick={onRefresh}
          disabled={refreshing}
          className={cx(refreshing && 'is-spinning')}
        />
      ) : null}
    </p>
  ) : null;

  return (
    <header className={cx('sf-page-header', className)}>
      {backLink ? <BackLink to={backLink.to} label={backLink.label} /> : null}
      <div className="sf-page-header__row">
        <div className="sf-page-header__title-row">
          <h1 className="sf-page-header__title">{title}</h1>
          {chip}
        </div>
        {freshness || hasActions ? (
          <div className="sf-page-header__end">
            {freshness}
            {hasActions ? (
              <div className="sf-page-header__actions">
                {secondaryActions}
                {primaryAction}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {subtitle ? <p className="sf-page-header__subtitle">{subtitle}</p> : null}
      {meta ? <p className="sf-page-header__meta">{meta}</p> : null}
    </header>
  );
}
