import { useCallback, useMemo, useState } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
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
  StaleBanner,
  StatusChip,
  Table,
  Tabs,
  WaitTime,
  type TableColumn,
} from '../../ui';
import { useTopupList } from './api';
import { paidFromWords } from './words';
import './topups.css';

const route = getRouteApi('/topups');

const DEFAULT_TAB: AdminTopupTab = 'to-check';
/** A request waiting this long shows as a warning (UX_ADMIN §2.2). */
const WAIT_WARN_MIN = 60;

/**
 * Top-up requests (`/topups?tab&q`, UX_ADMIN §2.2): the queue of "tell us you paid" requests, refreshed
 * every 20 seconds. A row opens the review drawer (`/topups/$paymentId`), where the office approves
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

  return (
    <div className="sf-topups">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        meta={
          approvedToday
            ? t('page.approvedToday', { count: approvedToday.count, amount: formatRs(approvedToday.totalPaisa) })
            : undefined
        }
        updatedAt={list.dataUpdatedAt || null}
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching && !list.isFetchingNextPage}
      />

      <Tabs
        label={t('page.tabsLabel')}
        items={ADMIN_TOPUP_TABS.map((id) => ({
          id,
          label: t(`tabs.${id}`),
          count: id === 'to-check' ? first?.counts.toCheck : undefined,
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

      <StaleBanner query={list} />

      <Table
        caption={t(`table.caption.${tab}`)}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={open}
        selectedKey={params.paymentId ?? null}
        rowTone={(row) => (tab === 'to-check' && isLate(row) ? 'warning' : null)}
        state={list.isPending ? 'loading' : list.isError && !list.data ? 'error' : 'ready'}
        error={<ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} title={t('page.loadFailed')} />}
        empty={
          q ? (
            <EmptyState compact title={t('empty.searchTitle', { q })} body={t('empty.searchBody')} />
          ) : (
            <EmptyState compact title={t(`empty.${tab}.title`)} body={t(`empty.${tab}.body`)} />
          )
        }
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

/** A 32 px screenshot thumbnail, or "None" (and "None" when the signed link no longer loads). */
function Thumbnail({ payment }: { payment: PaymentDto }) {
  const { t } = useTranslation('topups');
  const [broken, setBroken] = useState(false);
  if (!payment.proofUrl || broken) return <span className="sf-topups__muted">{t('table.noScreenshot')}</span>;
  return (
    <img
      src={payment.proofUrl}
      alt={t('table.screenshotAlt', { distributor: payment.distributor?.businessName ?? '' })}
      className="sf-topups__thumb"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function useColumns(tab: AdminTopupTab, open: (row: PaymentDto) => void): TableColumn<PaymentDto>[] {
  const { t } = useTranslation('topups');
  return useMemo(() => {
    const none = <span className="sf-topups__muted">{t('table.none')}</span>;
    const distributor: TableColumn<PaymentDto> = {
      id: 'distributor',
      header: t('table.distributor'),
      cell: (row) => row.distributor?.businessName ?? none,
    };
    const review: TableColumn<PaymentDto> = {
      id: 'action',
      header: <span className="sr-only">{t('table.action')}</span>,
      align: 'end',
      cell: (row) => (
        <Button size="sm" variant={row.status === 'PENDING' ? 'secondary' : 'ghost'} onClick={() => open(row)}>
          {row.status === 'PENDING' ? t('table.review') : t('table.open')}
        </Button>
      ),
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
        { id: 'amount', header: t('table.amount'), align: 'end', cell: (row) => <MoneyText paisa={row.amountPaisa} /> },
        { id: 'paidFrom', header: t('table.paidFrom'), priority: 2, cell: (row) => paidFromWords(row) },
        {
          id: 'transactionId',
          header: t('table.transactionId'),
          priority: 3,
          cell: (row) => (row.transactionId ? <span className="sf-topups__mono">{row.transactionId}</span> : none),
        },
        {
          id: 'screenshot',
          header: t('table.screenshot'),
          priority: 3,
          // A fresh signed link (every refresh signs again) gets a fresh try.
          cell: (row) => <Thumbnail key={row.proofUrl ?? 'none'} payment={row} />,
        },
        review,
      ];
    }
    if (tab === 'approved') {
      return [
        {
          id: 'approvedAt',
          header: t('table.approvedAt'),
          sticky: true,
          cell: (row) => (row.reviewedAt ? <time dateTime={row.reviewedAt}>{formatDateTime(row.reviewedAt)}</time> : none),
        },
        distributor,
        { id: 'credited', header: t('table.credited'), align: 'end', cell: (row) => <MoneyText paisa={row.creditedPaisa} /> },
        {
          id: 'bankReference',
          header: t('table.bankReference'),
          priority: 2,
          cell: (row) => (row.bankReference ? <span className="sf-topups__mono">{row.bankReference}</span> : none),
        },
        {
          id: 'bankTime',
          header: t('table.bankTime'),
          priority: 2,
          cell: (row) => (row.bankReceivedAt ? formatDateTime(row.bankReceivedAt) : none),
        },
        by,
        {
          id: 'asked',
          header: t('table.asked'),
          align: 'end',
          priority: 3,
          cell: (row) =>
            row.creditedPaisa !== null && row.creditedPaisa !== row.amountPaisa ? <MoneyText paisa={row.amountPaisa} /> : null,
        },
      ];
    }
    if (tab === 'rejected') {
      return [
        {
          id: 'rejectedAt',
          header: t('table.rejectedAt'),
          sticky: true,
          cell: (row) => (row.reviewedAt ? <time dateTime={row.reviewedAt}>{formatDateTime(row.reviewedAt)}</time> : none),
        },
        distributor,
        { id: 'amountAsked', header: t('table.amountAsked'), align: 'end', cell: (row) => <MoneyText paisa={row.amountPaisa} /> },
        {
          id: 'reason',
          header: t('table.reason'),
          priority: 2,
          cell: (row) => (row.rejectReasonCode ? t(`reject.reasons.${row.rejectReasonCode}`) : none),
        },
        by,
      ];
    }
    return [
      { id: 'sent', header: t('table.sent'), sticky: true, cell: (row) => <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time> },
      { id: 'number', header: t('table.number'), priority: 2, cell: (row) => <span className="sf-topups__mono">{row.shortCode}</span> },
      distributor,
      { id: 'amount', header: t('table.amount'), align: 'end', cell: (row) => <MoneyText paisa={row.amountPaisa} /> },
      { id: 'status', header: t('table.status'), cell: (row) => <StatusChip kind="topup" value={row.stage} /> },
      review,
    ];
  }, [open, t, tab]);
}
