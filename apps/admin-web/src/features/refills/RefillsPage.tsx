import { useMemo, useState } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
import { RefreshCw, SearchX, UserRoundCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNow } from '../../hooks/useNow';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  StaleBanner,
  Table,
  Tabs,
  useFlashedRow,
  type TableColumn,
} from '../../ui';
import { useRefillBoard, type RefillRow } from './api';
import { AssignRefillDialog } from './AssignRefillDialog';
import { boardRows, TAB_KEYS } from './board';
import { RefillStageChip, refillCylinders, refillDriver, requestedText } from './format';
import { REFILL_TABS, type RefillTab, type RefillsSearch } from './search';
import './refills.css';

const route = getRouteApi('/refills');

/**
 * Refills (`/refills?tab&q`, UX_ADMIN §4.1, Inc 2/3 spec §4.8), rebuilt in Inc 3 with the Orders pattern:
 * tabs Needs a driver · In progress · Done · Cancelled, a search by refill number or distributor, and 6
 * columns (Station only while the listed refills use more than one station). Each tab is its own server
 * list with "Load more", and the Needs a driver count is the server's, so an old refill waiting for a
 * driver never drops out of its tab. A refill waiting for a driver has its own "Assign driver"; every row
 * opens the drawer. It refreshes every 15 seconds. Refills carry no money: no cost, no cancel (only the
 * distributor cancels, before pickup) and no "Mark complete" (the shop's receive scans finish a refill).
 */
export function RefillsPage() {
  const { t } = useTranslation(['refills', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const params = useParams({ strict: false }) as { refillId?: string };
  const now = useNow(30_000);
  const tab: RefillTab = search.tab ?? REFILL_TABS[0];
  const q = search.q ?? '';
  const board = useRefillBoard({ tab, q: q || undefined });
  const flashed = useFlashedRow('refills');
  const [assigning, setAssigning] = useState<RefillRow | null>(null);

  const setSearch = (patch: Partial<RefillsSearch>) => {
    void navigate({ to: '/refills', search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const openRefill = (refill: RefillRow) => {
    void navigate({ to: '/refills/$refillId', params: { refillId: refill.id }, search: true });
  };

  // The counts stay from the last answer while another tab loads; its rows don't.
  const counts = board.data?.pages[0]?.counts;
  const ownRows = board.data?.pages[0]?.tab === tab;
  const rows = useMemo(() => (board.data && ownRows ? boardRows(board.data.pages) : undefined), [board.data, ownRows]);

  // The Station column shows only while the listed refills use more than one station (UX_ADMIN §4.5).
  const manyStations = useMemo(() => new Set((rows ?? []).map((refill) => refill.fillingStation?.id ?? '')).size > 1, [rows]);

  const columns = useMemo<TableColumn<RefillRow>[]>(() => {
    const list: TableColumn<RefillRow>[] = [
      {
        id: 'refill',
        header: t('columns.refill'),
        cell: (refill) => (
          <span className="sf-refills__two-line">
            <span className="sf-record-no">{refill.shortCode ?? t('none')}</span>
            <span className="sf-refills__muted sf-refills__nowrap">{refillCylinders(refill)}</span>
          </span>
        ),
        priority: 1,
        sticky: true,
      },
      { id: 'status', header: t('columns.status'), cell: (refill) => <RefillStageChip refill={refill} />, priority: 1 },
      { id: 'distributor', header: t('columns.distributor'), cell: (refill) => refill.distributor.businessName, priority: 1 },
      {
        id: 'driver',
        header: t('columns.driver'),
        cell: (refill) =>
          refill.allowedActions?.includes('ASSIGN') ? (
            <Button size="sm" icon={UserRoundCheck} onClick={() => setAssigning(refill)}>
              {t('assign')}
            </Button>
          ) : (
            <span className="sf-refills__nowrap">{refillDriver(refill) ?? t('none')}</span>
          ),
        priority: 1,
      },
      {
        id: 'requested',
        header: t('columns.requested'),
        cell: (refill) => <span className="sf-refills__nowrap">{requestedText(refill.createdAt, now)}</span>,
        priority: 2,
      },
    ];
    if (manyStations) {
      list.push({ id: 'station', header: t('columns.station'), cell: (refill) => refill.fillingStation?.name ?? t('none'), priority: 3 });
    }
    return list;
  }, [manyStations, now, t]);

  const tabKey = TAB_KEYS[tab];
  const empty = q ? (
    <EmptyState
      compact
      icon={SearchX}
      title={t('empty.search.title', { q })}
      body={t('empty.search.tab', { tab: t(`tabs.${tabKey}`) })}
      action={<Button onClick={() => setSearch({ q: undefined })}>{t('common:actions.clearSearch')}</Button>}
    />
  ) : (
    <EmptyState compact icon={tab === 'needs-driver' ? UserRoundCheck : RefreshCw} title={t(`empty.${tabKey}`)} />
  );

  return (
    <div className="sf-refills">
      <PageHeader title={t('title')} />
      <StaleBanner query={board} />

      <Tabs
        label={t('tabsLabel')}
        items={REFILL_TABS.map((id) => ({
          id,
          label: t(`tabs.${TAB_KEYS[id]}`),
          // The queue tab carries its count, as Orders' Needs a driver does.
          count: id === 'needs-driver' && counts ? counts[TAB_KEYS[id]] : null,
          countPending: id === 'needs-driver' && !counts,
        }))}
        value={tab}
        onChange={(next) => setSearch({ tab: next === REFILL_TABS[0] ? undefined : next })}
      />

      <FilterBar className="sf-refills__filters">
        <SearchField value={q} onChange={(next) => setSearch({ q: next || undefined })} placeholder={t('search')} />
      </FilterBar>

      <Table<RefillRow>
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(refill) => refill.id}
        onRowClick={openRefill}
        chevron={(refill) => !refill.allowedActions?.includes('ASSIGN')}
        selectedKey={params.refillId ?? null}
        highlightKey={flashed}
        state={board.isError && !board.data ? 'error' : rows ? 'ready' : 'loading'}
        empty={empty}
        error={
          <ErrorState compact error={board.error} title={t('loadFailed')} onRetry={() => void board.refetch()} retrying={board.isFetching} />
        }
        footer={
          rows && board.hasNextPage ? (
            <div className="sf-refills__more">
              <Button variant="ghost" onClick={() => void board.fetchNextPage()} loading={board.isFetchingNextPage}>
                {t('common:actions.loadMore')}
              </Button>
            </div>
          ) : null
        }
      />

      {assigning ? <AssignRefillDialog refill={assigning} onClose={() => setAssigning(null)} /> : null}
    </div>
  );
}
