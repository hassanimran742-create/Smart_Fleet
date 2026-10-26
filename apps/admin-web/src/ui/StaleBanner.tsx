import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '../hooks/useOnline';
import { formatTime } from '../i18n/format';
import { Button } from './Button';
import { InlineAlert } from './InlineAlert';

/** The parts of a TanStack `useQuery` result the banner needs. */
export interface StaleQuery {
  data: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  errorUpdateCount: number;
  isFetching: boolean;
  refetch: () => unknown;
}

/** Failed refreshes since the data last loaded (each refresh already includes its automatic retries). */
export function useFailedRefreshes(query: StaleQuery): number {
  const baseline = useRef({ dataUpdatedAt: query.dataUpdatedAt, errors: query.errorUpdateCount });
  useEffect(() => {
    if (query.dataUpdatedAt !== baseline.current.dataUpdatedAt) {
      baseline.current = { dataUpdatedAt: query.dataUpdatedAt, errors: query.errorUpdateCount };
    }
  }, [query.dataUpdatedAt, query.errorUpdateCount]);
  if (query.errorUpdatedAt <= query.dataUpdatedAt) return 0;
  return Math.max(0, query.errorUpdateCount - baseline.current.errors);
}

/**
 * Why the data on screen may be old (UX_ADMIN §1.11):
 * - `offline`: a refresh failed while the browser has no network: "No connection." at once;
 * - `stale`: refreshes keep failing while online (the server is down): "Not updated since 4:12 pm."
 *   after `after` failures;
 * - null: the data is current, or there is none yet (a first load that fails shows ErrorState instead).
 * `since` is when the data last loaded, for "Nothing waiting at 4:12 pm." on an all-clear line.
 */
export interface Staleness {
  kind: 'offline' | 'stale' | null;
  since: number;
}

export function useStaleness(query: StaleQuery, after = 2): Staleness {
  const online = useOnline();
  const failures = useFailedRefreshes(query);
  const since = query.dataUpdatedAt;
  if (query.data === undefined || failures === 0) return { kind: null, since };
  if (!online) return { kind: 'offline', since };
  return { kind: failures >= after ? 'stale' : null, since };
}

export interface StaleBannerProps {
  query: StaleQuery;
  /** How many failed refreshes (while online) before "Not updated since …" shows; 2 (UX_ADMIN §1.9). */
  after?: number;
}

/**
 * One banner at the top of the content when a page keeps its data but can't refresh it (UX_ADMIN
 * §1.11): "No connection." while the browser is offline, or "Not updated since 4:12 pm." when the
 * server can't be reached, each with Try again. The data stays on screen, and the page adds no second
 * error for the same cause.
 */
export function StaleBanner({ query, after = 2 }: StaleBannerProps) {
  const { t } = useTranslation();
  const { kind, since } = useStaleness(query, after);
  if (kind === null) return null;
  return (
    <InlineAlert
      tone="warning"
      live
      className="sf-stale-banner"
      action={
        <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
          {t('actions.tryAgain')}
        </Button>
      }
    >
      {kind === 'offline' ? t('freshness.offline') : t('freshness.stale', { time: formatTime(since) })}
    </InlineAlert>
  );
}
