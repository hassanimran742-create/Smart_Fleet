import { useMemo, useState } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
import { Inbox, SearchX, UserRoundCheck } from 'lucide-react';
import { ORDER_BOARD_TABS, type OrderBoardDto, type OrderBoardTab, type OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import type { OrdersSearch } from '../../app/search';
import { useNow } from '../../hooks/useNow';
import { formatAgo } from '../../i18n/format';
import {
  Button,
  EmptyState,
  ErrorState,
  FeeChip,
  Field,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StaleBanner,
  StatusChip,
  Table,
  Tabs,
  type TableColumn,
} from '../../ui';
import { useDistributors, useOrderBoard } from './api';
import { AssignDriverDialog } from './AssignDriverDialog';
import { cylindersText, driverText } from './format';
import './orders.css';

const route = getRouteApi('/orders');

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
 * The Orders board (`/orders?tab&q&distributor`, UX_ADMIN §2.5): tabs with counts from
 * `GET /orders/board`, search, the distributor filter (only with more than one distributor) and the
 * table. Rows open the order drawer; an order waiting for a driver has its own "Assign driver" button.
 * It refreshes every 15 seconds.
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
  const [assigning, setAssigning] = useState<OrderDto | null>(null);

  const setSearch = (patch: Partial<OrdersSearch>) => {
    void navigate({ to: '/orders', search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  const openOrder = (order: OrderDto) => {
    void navigate({ to: '/orders/$orderId', params: { orderId: order.id }, search: true });
  };

  const many = (distributors.data?.length ?? 0) > 1;
  const counts = board.data?.pages[0]?.counts;
  const rows = useMemo(() => board.data?.pages.flatMap((page) => page.items), [board.data]);

  const columns = useMemo<TableColumn<OrderDto>[]>(() => {
    const list: TableColumn<OrderDto>[] = [
      {
        id: 'order',
        header: t('columns.order'),
        cell: (order) => <span className="sf-orders__no">{order.shortCode}</span>,
        priority: 1,
        sticky: true,
      },
      {
        id: 'stage',
        header: t('columns.stage'),
        cell: (order) => <StatusChip kind="order" value={order.stage} />,
        priority: 1,
      },
      {
        id: 'customer',
        header: t('columns.customer'),
        cell: (order) => (
          <span className="sf-orders__two-line">
            <span>{order.client.name}</span>
            <span className="sf-orders__muted">{order.destZone.name}</span>
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
      {
        id: 'cost',
        header: t('columns.cost'),
        cell: (order) => <FeeChip amountPaisa={order.fee.totalPaisa} status={order.fee.status} />,
        priority: 1,
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
    ];
    if (many) {
      list.push({
        id: 'distributor',
        header: t('columns.distributor'),
        cell: (order) => order.distributor?.businessName ?? '',
        priority: 3,
      });
    }
    list.push({
      id: 'placed',
      header: t('columns.placed'),
      cell: (order) => (
        <time dateTime={order.createdAt} className="sf-orders__nowrap">
          {formatAgo(order.createdAt, now)}
        </time>
      ),
      priority: 2,
    });
    return list;
  }, [many, now, t]);

  const tabKey = TAB_KEYS[tab];
  const empty = q ? (
    <EmptyState compact icon={SearchX} title={t('empty.search.title', { q })} body={t('empty.search.body')} />
  ) : (
    <EmptyState compact icon={Inbox} title={t(`empty.${tabKey}.title`)} body={t(`empty.${tabKey}.body`)} />
  );

  const distributorOptions = useMemo(
    () => (distributors.data ?? []).map((d) => ({ value: d.id, label: d.businessName })).sort((a, b) => a.label.localeCompare(b.label)),
    [distributors.data],
  );

  return (
    <div className="sf-orders">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        updatedAt={board.dataUpdatedAt || null}
        onRefresh={() => void board.refetch()}
        refreshing={board.isFetching && !board.isPending}
      />

      <Tabs
        label={t('page.tabsLabel')}
        items={ORDER_BOARD_TABS.map((id) => ({ id, label: t(`tabs.${TAB_KEYS[id]}`), count: tabCount(counts, id) }))}
        value={tab}
        onChange={(next) => setSearch({ tab: next === ORDER_BOARD_TABS[0] ? undefined : next })}
      />

      <FilterBar className="sf-orders__filters">
        <SearchField value={q} onChange={(next) => setSearch({ q: next || undefined })} placeholder={t('page.search')} />
        {many ? (
          <Field label={t('page.distributor')} labelHidden>
            <Select
              value={search.distributor ?? ''}
              placeholder={t('page.allDistributors')}
              options={distributorOptions}
              onChange={(event) => setSearch({ distributor: event.target.value || undefined })}
            />
          </Field>
        ) : null}
      </FilterBar>

      <StaleBanner query={board} />

      <Table<OrderDto>
        caption={t('page.caption')}
        columns={columns}
        rows={rows}
        rowKey={(order) => order.id}
        onRowClick={openOrder}
        selectedKey={params.orderId ?? null}
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
