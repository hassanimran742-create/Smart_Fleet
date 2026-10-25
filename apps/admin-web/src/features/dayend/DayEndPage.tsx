import { useMemo } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { FileSpreadsheet } from 'lucide-react';
import type { AdminDayEndListItem } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { useAdminSummary } from '../../hooks/useAdminSummary';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import { formatCalendarDate, formatNumber } from '../../i18n/format';
import { Button, EmptyState, ErrorState, PageHeader, StaleBanner, Table, Tabs, type TableColumn } from '../../ui';
import { whenText } from '../orders/format';
import { useDayEnds } from './api';
import { DayEndOff } from './DayEndOff';
import { DayEndStageChip } from './format';
import { DAY_END_TAB_STATUS, DAY_END_TABS, type DayEndTab } from './search';
import './dayend.css';

const route = getRouteApi('/day-end');

/** The i18n key of each tab (`dayend:tabs.<key>`, `dayend:empty.<key>`). */
const TAB_KEYS = {
  'to-approve': 'toApprove',
  open: 'open',
  approved: 'approved',
} as const satisfies Record<DayEndTab, string>;

/**
 * Day-end (`/day-end?tab`, UX_ADMIN §4.3, Inc 2/3 spec §4.9): the days the shops sent, by tab To approve
 * (with its count) · Open · Approved, from `GET /admin/day-end?status`. Columns Day · Distributor ·
 * Status · Differences · Uploaded, with "Review" on the rows to approve; the whole row opens the review.
 * A day the shop never downloaded a sheet for has no row.
 */
export function DayEndPage() {
  const { t } = useTranslation(['dayend', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { config, isLoading, isFallback } = useAppConfig();
  const summary = useAdminSummary();
  const now = useNow(60_000);
  const tab: DayEndTab = search.tab ?? DAY_END_TABS[0];
  const query = useDayEnds(DAY_END_TAB_STATUS[tab]);
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items), [query.data]);
  const toApprove = summary.data?.dayEnd?.toApprove;

  const openDay = (day: AdminDayEndListItem) => {
    void navigate({ to: '/day-end/$dayEndId', params: { dayEndId: day.id } });
  };

  const columns = useMemo<TableColumn<AdminDayEndListItem>[]>(
    () => [
      {
        id: 'day',
        header: t('columns.day'),
        cell: (day) => <span className="sf-record-no">{formatCalendarDate(day.businessDate)}</span>,
        priority: 1,
        sticky: true,
      },
      { id: 'distributor', header: t('columns.distributor'), cell: (day) => day.distributor.businessName, priority: 1 },
      { id: 'status', header: t('columns.status'), cell: (day) => <DayEndStageChip stage={day.stage} />, priority: 1 },
      {
        id: 'differences',
        header: t('columns.differences'),
        cell: (day) => <span className="sf-dayend__number">{formatNumber(day.differences)}</span>,
        align: 'end',
        priority: 1,
      },
      {
        id: 'uploaded',
        header: t('columns.uploaded'),
        cell: (day) =>
          day.uploadedAt ? (
            <span className="sf-dayend__nowrap">
              {day.uploadedBy
                ? t('uploaded', { time: whenText(day.uploadedAt, now), name: day.uploadedBy.name })
                : whenText(day.uploadedAt, now)}
            </span>
          ) : (
            <span className="sf-dayend__muted">{t('noUpload')}</span>
          ),
        priority: 2,
      },
      {
        id: 'action',
        header: <span className="sr-only">{t('actions.review')}</span>,
        align: 'end',
        cell: (day) =>
          day.status === 'SUBMITTED' ? (
            <Button
              size="sm"
              aria-label={t('actions.reviewFor', { distributor: day.distributor.businessName, day: formatCalendarDate(day.businessDate) })}
              onClick={() => void navigate({ to: '/day-end/$dayEndId', params: { dayEndId: day.id } })}
            >
              {t('actions.review')}
            </Button>
          ) : null,
        priority: 1,
      },
    ],
    [navigate, now, t],
  );

  // Switched off: the config says so (not merely couldn't be read), or the server refused for that reason.
  const off =
    (!isLoading && !isFallback && !config.features.dayEnd) || (query.isError && toApiError(query.error).is('FEATURE_DISABLED'));
  const tabKey = TAB_KEYS[tab];

  return (
    <div className="sf-dayend">
      <PageHeader title={t('title')} />
      {off ? (
        <DayEndOff />
      ) : (
        <>
          <StaleBanner query={query} />
          <Tabs
            label={t('tabsLabel')}
            items={DAY_END_TABS.map((id) => ({
              id,
              label: t(`tabs.${TAB_KEYS[id]}`),
              count: id === 'to-approve' ? (toApprove ?? null) : null,
              countPending: id === 'to-approve' && summary.isPending,
            }))}
            value={tab}
            onChange={(next) => void navigate({ to: '/day-end', search: { tab: next === DAY_END_TABS[0] ? undefined : next }, replace: true })}
          />
          <Table<AdminDayEndListItem>
            caption={t('caption')}
            columns={columns}
            rows={rows}
            rowKey={(day) => day.id}
            onRowClick={openDay}
            chevron={(day) => day.status !== 'SUBMITTED'}
            state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
            empty={<EmptyState compact icon={FileSpreadsheet} title={t(`empty.${tabKey}`)} />}
            error={
              <ErrorState compact error={query.error} title={t('loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
            }
            footer={
              query.hasNextPage ? (
                <Button variant="ghost" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
                  {t('common:actions.loadMore')}
                </Button>
              ) : null
            }
          />
        </>
      )}
    </div>
  );
}
