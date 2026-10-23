import { useCallback, useMemo } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
import { CircleCheck, Search } from 'lucide-react';
import { ADMIN_TOPUP_TABS, type AdminTopupTab, type PaymentDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import type { TopupsSearch } from '../../app/search';
import { formatDateTime, formatRs } from '../../i18n/format';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  MoneyText,
  PageHeader,
  SearchField,
  Skeleton,
  StaleBanner,
  StatusChip,
  Table,
  Tabs,
  useFlashedRow,
  WaitTime,
  type TableColumn,
} from '../../ui';
import { TOPUPS_FLASH, useTopupList } from './api';
import { paidFromWords } from './words';
import './topups.css';

const route = getRouteApi('/topups');

const DEFAULT_TAB: AdminTopupTab = 'to-check';
/** A request waiting this long shows as a warning (UX_ADMIN §2.2). */
const WAIT_WARN_MIN = 60;

/** A request still to check has a "Review" button; every other row ends with a chevron instead. */
function toCheck(row: PaymentDto): boolean {
  return row.status === 'PENDING';
}

/**
 * Top-ups (`/topups?tab&q`, website spec W06): the queue of "tell us you paid" requests, refreshed every
 * 20 seconds. "Review" (or the row) opens the drawer (`/topups/$paymentId`), where the office approves
 * against the company bank app or rejects with a reason.
 */
export function TopupsPage() {
  const { t } = useTranslation(['topups', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const params = useParams({ strict: false }) as { paymentId?: string };
  const tab = search.tab ?? DEFAULT_TAB;
  const q = search.q ?? '';
  const list = useTopupList({ tab, q: search.q });
  const flashed = useFlashedRow(TOPUPS_FLASH);

  const pages = list.data?.pages;
  const first = pages?.[0];
  const rows = useMemo(() => pages?.flatMap((page) => page.items), [pages]);

  const setSearch = (patch: Partial<TopupsSearch>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const open = useCallback(
    (row: PaymentDto) => {
      void navigate({ to: '/topups/$paymentId', params: { paymentId: row.id }, search: (prev) => prev });
    },
    [navigate],
  );

  const columns = useColumns(tab, open);
  const approvedToday = first?.approvedToday;
  const meta = approvedToday ? (
    t('page.approvedToday', { count: approvedToday.count, amount: formatRs(approvedToday.totalPaisa) })
  ) : list.isPending ? (
    <Skeleton width="16rem" />
  ) : undefined;

  const empty = q ? (
    <EmptyState
      compact
      icon={Search}
      title={t('empty.searchTitle', { q })}
      body={tab === 'all' ? undefined : t('empty.searchTab', { tab: t(`tabs.${tab}`) })}
      action={
        <Button size="sm" onClick={() => setSearch({ q: undefined })}>
          {t('common:actions.clearSearch')}
        </Button>
      }
    />
  ) : (
    <EmptyState compact icon={tab === 'to-check' ? CircleCheck : undefined} title={t(`empty.${tab}.title`)} />
  );

  return (
    <div className="sf-topups">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        meta={meta}
        updatedAt={list.dataUpdatedAt || null}
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching && !list.isFetchingNextPage}
      />

      <StaleBanner query={list} />

      <Tabs
        label={t('page.tabsLabel')}
        items={ADMIN_TOPUP_TABS.map((id) => ({
          id,
          label: t(`tabs.${id}`),
          count: id === 'to-check' ? first?.counts.toCheck : undefined,
          countPending: id === 'to-check' && list.isPending,
        }))}
        value={tab}
        onChange={(next) => setSearch({ tab: next === DEFAULT_TAB ? undefined : next })}
      />

      <FilterBar>
        <SearchField
          value={q}
          onChange={(next) => setSearch({ q: next || undefined })}
          placeholder={t('page.searchPlaceholder')}
          label={t('page.searchLabel')}
        />
      </FilterBar>

      <Table
        caption={t(`table.caption.${tab}`)}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={open}
        // To check rows end with "Review"; decided rows end with a chevron (All has both).
        chevron={tab === 'to-check' ? false : (row) => !toCheck(row)}
        selectedKey={params.paymentId ?? null}
        highlightKey={flashed}
        rowTone={(row) => (tab === 'to-check' && isLate(row) ? 'warning' : null)}
        state={list.isPending ? 'loading' : list.isError && !list.data ? 'error' : 'ready'}
        error={<ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} title={t('page.loadFailed')} />}
        empty={empty}
        footer={
          list.hasNextPage ? (
            <Button variant="ghost" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              {t('common:actions.loadMore')}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

function isLate(row: PaymentDto): boolean {
  return Date.now() - Date.parse(row.createdAt) >= WAIT_WARN_MIN * 60_000;
}

function useColumns(tab: AdminTopupTab, open: (row: PaymentDto) => void): TableColumn<PaymentDto>[] {
  const { t } = useTranslation('topups');
  return useMemo(() => {
    const none = <span className="sf-topups__muted">{t('table.none')}</span>;
    const mono = (text: string | null | undefined) => (text ? <span className="sf-topups__mono">{text}</span> : none);
    const at = (iso: string | null) => (iso ? <time dateTime={iso}>{formatDateTime(iso)}</time> : none);
    const distributor: TableColumn<PaymentDto> = {
      id: 'distributor',
      header: t('table.distributor'),
      cell: (row) => row.distributor?.businessName ?? none,
    };
    const amount: TableColumn<PaymentDto> = {
      id: 'amount',
      header: t('table.amount'),
      align: 'end',
      cell: (row) => <MoneyText paisa={row.amountPaisa} strong />,
    };
    const review: TableColumn<PaymentDto> = {
      id: 'action',
      header: <span className="sr-only">{t('table.action')}</span>,
      align: 'end',
      cell: (row) =>
        toCheck(row) ? (
          <Button size="sm" variant="secondary" onClick={() => open(row)}>
            {t('table.review')}
          </Button>
        ) : null,
    };
    const by: TableColumn<PaymentDto> = {
      id: 'by',
      header: t('table.by'),
      priority: 3,
      cell: (row) => row.reviewedBy?.name ?? none,
    };

    if (tab === 'to-check') {
      return [
        { id: 'waiting', header: t('table.waiting'), sticky: true, cell: (row) => <WaitTime since={row.createdAt} warnAfterMin={WAIT_WARN_MIN} /> },
        distributor,
        amount,
        { id: 'paidFrom', header: t('table.paidFrom'), priority: 2, cell: (row) => <span className="sf-topups__wrap">{paidFromWords(row)}</span> },
        { id: 'transactionId', header: t('table.transactionId'), priority: 2, cell: (row) => mono(row.transactionId) },
        review,
      ];
    }
    if (tab === 'approved') {
      return [
        { id: 'approvedAt', header: t('table.approvedAt'), sticky: true, cell: (row) => at(row.reviewedAt) },
        distributor,
        {
          id: 'credited',
          header: t('table.credited'),
          align: 'end',
          cell: (row) => (
            <span className="sf-topups__added">
              <MoneyText paisa={row.creditedPaisa} strong />
              {row.creditedPaisa !== null && row.creditedPaisa !== row.amountPaisa ? (
                <span className="sf-topups__muted sf-topups__asked">{t('table.askedLine', { amount: formatRs(row.amountPaisa) })}</span>
              ) : null}
            </span>
          ),
        },
        { id: 'bankReference', header: t('table.bankReference'), cell: (row) => mono(row.bankReference) },
        by,
      ];
    }
    if (tab === 'rejected') {
      return [
        { id: 'rejectedAt', header: t('table.rejectedAt'), sticky: true, cell: (row) => at(row.reviewedAt) },
        distributor,
        amount,
        {
          id: 'reason',
          header: t('table.reason'),
          cell: (row) => (row.rejectReasonCode ? t(`reject.reasons.${row.rejectReasonCode}`) : none),
        },
        by,
      ];
    }
    return [
      { id: 'sent', header: t('table.sent'), sticky: true, cell: (row) => at(row.createdAt) },
      distributor,
      amount,
      { id: 'status', header: t('table.status'), cell: (row) => <StatusChip kind="topup" value={row.stage} /> },
      review,
    ];
  }, [open, t, tab]);
}
