import { useMemo, useState } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
import { Inbox, SearchX, UserRoundCheck } from 'lucide-react';
import { ORDER_BOARD_TABS, type OrderBoardDto, type OrderBoardTab, type OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import type { OrdersSearch } from '../../app/search';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import {
  Button,
  EmptyState,
  ErrorState,
  FeeChip,
  FilterBar,
  FilterChips,
  PageHeader,
  SearchField,
  SearchSelect,
  StaleBanner,
  Table,
  Tabs,
  useFlashedRow,
  type FilterChipOption,
  type TableColumn,
} from '../../ui';
import { AnswerChip, answerValue } from '../problems/answer';
import { useDistributors, useOrderBoard } from './api';
import { AssignDriverDialog } from './AssignDriverDialog';
import { cylindersText, driverText, outcomeReason, rowWhen } from './format';
import { OrderStageChip } from './OrderStageChip';
import './orders.css';

const route = getRouteApi('/orders');

/** Up to this many distributors are chips; more get a search box (UX_ADMIN §1.4). */
const CHIP_DISTRIBUTORS = 5;
/** The "All" chip of the distributor filter. */
const ALL = '__all__';

/** A narrow column may break "Zone · Distributor" after the dot, never inside a name. */
const keepTogether = (name: string) => name.replace(/ /g, '\u00a0');

/** The i18n key of each board tab (`orders:tabs.<key>`, `orders:empty.<key>`). */
const TAB_KEYS = {
  'needs-driver': 'needsDriver',
  'in-progress': 'inProgress',
  'done-today': 'doneToday',
  'cancelled-failed': 'cancelledFailed',
  all: 'all',
} as const satisfies Record<OrderBoardTab, string>;

function tabCount(counts: OrderBoardDto['counts'] | undefined, tab: OrderBoardTab): number | null {
  if (!counts) return null;
  switch (tab) {
    case 'needs-driver':
      return counts.needsDriver;
    case 'in-progress':
      return counts.inProgress;
    case 'done-today':
      return counts.doneToday;
    case 'cancelled-failed':
      return counts.cancelledFailed;
    default:
      return null;
  }
}

/**
 * The Orders board (`/orders?tab&q&distributor`, UX_ADMIN §2.5, website spec W27): tabs with counts
 * from `GET /orders/board`, search, the distributor filter (only with more than one distributor) and a
 * table of 6 columns (5 on Needs a driver, where every row has the same status). Rows open the order
 * drawer; an order waiting for a driver has its own "Assign driver" button instead of the chevron. It
 * refreshes every 15 seconds.
 */
export function OrdersPage() {
  const { t } = useTranslation(['orders', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const params = useParams({ strict: false }) as { orderId?: string };
  const now = useNow(30_000);
  const tab: OrderBoardTab = search.tab ?? ORDER_BOARD_TABS[0];
  const q = search.q ?? '';
  const distributors = useDistributors();
  const board = useOrderBoard({ tab, q: q || undefined, distributorId: search.distributor });
  const flashed = useFlashedRow('orders');
  const [assigning, setAssigning] = useState<OrderDto | null>(null);
  // Inc 2: a delivered row adds the customer's answer under its status (UX_ADMIN §3.1), while it is on.
  const { config } = useAppConfig();
  const answers = config.features.confirmations;

  const setSearch = (patch: Partial<OrdersSearch>) => {
    void navigate({ to: '/orders', search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  const openOrder = (order: OrderDto) => {
    void navigate({ to: '/orders/$orderId', params: { orderId: order.id }, search: true });
  };

  const sortedDistributors = useMemo(
    () => [...(distributors.data ?? [])].sort((a, b) => a.businessName.localeCompare(b.businessName)),
    [distributors.data],
  );
  const many = sortedDistributors.length > 1;
  // The distributor shows under each customer only while every distributor's orders are listed.
  const showDistributor = many && !search.distributor;
  const counts = board.data?.pages[0]?.counts;
  const rows = useMemo(() => board.data?.pages.flatMap((page) => page.items), [board.data]);

  const columns = useMemo<TableColumn<OrderDto>[]>(() => {
    const list: TableColumn<OrderDto>[] = [
      {
        id: 'order',
        header: t('columns.order'),
        cell: (order) => (
          <span className="sf-orders__two-line">
            <span className="sf-record-no">{order.shortCode}</span>
            <span className="sf-orders__muted sf-orders__nowrap">{rowWhen(order, tab, now)}</span>
          </span>
        ),
        priority: 1,
        sticky: true,
      },
      {
        id: 'customer',
        header: t('columns.customer'),
        cell: (order) => (
          <span className="sf-orders__two-line">
            <span>{order.client.name}</span>
            <span className="sf-orders__muted">
              {showDistributor && order.distributor
                ? t('row.zoneDistributor', {
                    zone: keepTogether(order.destZone.name),
                    distributor: keepTogether(order.distributor.businessName),
                  })
                : order.destZone.name}
            </span>
          </span>
        ),
        priority: 1,
      },
      {
        id: 'cylinders',
        header: t('columns.cylinders'),
        cell: (order) => <span className="sf-orders__nowrap">{cylindersText(order)}</span>,
        priority: 2,
      },
    ];
    if (tab !== 'needs-driver') {
      list.push({
        id: 'status',
        header: t('columns.status'),
        cell: (order) => {
          const reason = outcomeReason(order);
          // The answer is its own chip under the status, never in place of it.
          const answer = answers ? answerValue(order.confirmation) : null;
          return (
            <span className="sf-orders__two-line">
              <span>
                <OrderStageChip order={order} />
              </span>
              {answer ? (
                <span>
                  <AnswerChip value={answer} />
                </span>
              ) : null}
              {reason ? <span className="sf-orders__muted">{reason}</span> : null}
            </span>
          );
        },
        priority: 1,
      });
    }
    list.push(
      {
        id: 'cost',
        header: t('columns.cost'),
        cell: (order) => <FeeChip amountPaisa={order.fee.totalPaisa} status={order.fee.status} />,
        priority: 3,
      },
      {
        id: 'driver',
        header: t('columns.driver'),
        cell: (order) => {
          if (order.allowedActions.includes('ASSIGN')) {
            return (
              <Button size="sm" variant="secondary" icon={UserRoundCheck} onClick={() => setAssigning(order)}>
                {t('row.assign')}
              </Button>
            );
          }
          return <span className="sf-orders__nowrap">{driverText(order) ?? t('row.noDriver')}</span>;
        },
        priority: 1,
      },
    );
    return list;
  }, [answers, now, showDistributor, t, tab]);

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
    <EmptyState compact icon={tab === 'needs-driver' ? UserRoundCheck : Inbox} title={t(`empty.${tabKey}.title`)} />
  );

  const distributorFilter = !many ? null : sortedDistributors.length <= CHIP_DISTRIBUTORS ? (
    <FilterChips<string>
      label={t('page.distributor')}
      options={[
        { value: ALL, label: t('page.allChip') },
        ...sortedDistributors.map((d): FilterChipOption<string> => ({ value: d.id, label: d.businessName })),
      ]}
      value={search.distributor ?? ALL}
      onChange={(value) => setSearch({ distributor: value === ALL ? undefined : value })}
    />
  ) : (
    <div className="sf-orders__distributor">
      <SearchSelect
        label={t('page.distributor')}
        placeholder={t('page.allDistributors')}
        clearLabel={t('page.allDistributors')}
        options={sortedDistributors.map((d) => ({ value: d.id, label: d.businessName }))}
        value={search.distributor ?? null}
        onChange={(value) => setSearch({ distributor: value ?? undefined })}
      />
    </div>
  );

  return (
    <div className="sf-orders">
      <PageHeader
        title={t('page.title')}
        updatedAt={board.dataUpdatedAt || null}
        onRefresh={() => void board.refetch()}
        refreshing={board.isFetching && !board.isPending}
      />

      <StaleBanner query={board} />

      <Tabs
        label={t('page.tabsLabel')}
        items={ORDER_BOARD_TABS.map((id) => ({
          id,
          label: t(`tabs.${TAB_KEYS[id]}`),
          count: tabCount(counts, id),
          countPending: id !== 'all' && !counts,
        }))}
        value={tab}
        onChange={(next) => setSearch({ tab: next === ORDER_BOARD_TABS[0] ? undefined : next })}
      />

      <FilterBar className="sf-orders__filters">
        <SearchField value={q} onChange={(next) => setSearch({ q: next || undefined })} placeholder={t('page.search')} />
        {distributorFilter}
      </FilterBar>

      <Table<OrderDto>
        caption={t('page.caption')}
        columns={columns}
        rows={rows}
        rowKey={(order) => order.id}
        onRowClick={openOrder}
        chevron={(order) => !order.allowedActions.includes('ASSIGN')}
        selectedKey={params.orderId ?? null}
        highlightKey={flashed}
        state={board.isPending ? 'loading' : board.isError && !board.data ? 'error' : 'ready'}
        empty={empty}
        error={
          <ErrorState
            compact
            error={board.error}
            title={t('page.loadFailed')}
            onRetry={() => void board.refetch()}
            retrying={board.isFetching}
          />
        }
        footer={
          board.hasNextPage ? (
            <div className="sf-orders__more">
              <Button variant="ghost" onClick={() => void board.fetchNextPage()} loading={board.isFetchingNextPage}>
                {t('common:actions.loadMore')}
              </Button>
            </div>
          ) : null
        }
      />

      {assigning ? <AssignDriverDialog order={assigning} onClose={() => setAssigning(null)} /> : null}
    </div>
  );
}
