import { useMemo, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Download, PencilLine } from 'lucide-react';
import type { AdminWalletDetail, StatementItem, WalletCorrectionResult } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import { formatAgo, formatDateTime, formatRs } from '../../i18n/format';
import {
  Button,
  DateRangeFilter,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  InlineAlert,
  MoneyText,
  PageHeader,
  Select,
  SkeletonText,
  StaleBanner,
  Table,
  useToast,
  type DateRange,
  type TableColumn,
} from '../../ui';
import { fetchStatementRows, useInvalidateAfterCorrection, useWalletDetail, useWalletHistory, useWalletList } from './api';
import { CorrectionModal } from './CorrectionModal';
import { HISTORY_PRESETS, historyToday, rangeFromSearch } from './historyDates';
import { integrityState } from './integrity';
import {
  downloadTextFile,
  HISTORY_TYPES,
  historyTypeOf,
  historyWords,
  kindParam,
  kindsOf,
  orderedDates,
  searchForRange,
  STATEMENT_MAX_ROWS,
  statementCsv,
  statementFileName,
  type HistoryType,
} from './statement';
import './wallets.css';

const route = getRouteApi('/wallets/$distributorId');

/**
 * One distributor's wallet (`/wallets/$distributorId?from&to&kind`, UX_ADMIN §2.6): one Balance card, the
 * money being checked, the live integrity line, the full history (paged, no row cap), the CSV statement
 * and the correction dialog. The page only reads; a history mismatch disables "Record correction"
 * (G01-06), while a balance below zero whose history matches keeps it on, since a correction is the fix.
 */
export function WalletPage() {
  const { t } = useTranslation(['wallets', 'common']);
  const { distributorId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const toast = useToast();
  const { config } = useAppConfig();
  const invalidate = useInvalidateAfterCorrection();
  const detail = useWalletDetail(distributorId);
  const list = useWalletList();
  const [customDates, setCustomDates] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [statementProblem, setStatementProblem] = useState<string | null>(null);

  const row = list.data?.find((candidate) => candidate.distributorId === distributorId);
  const name = row?.businessName ?? '';
  // The statement reads its dates as business days, so the presets count from the business date.
  const today = historyToday(config.day);
  const range = rangeFromSearch(search, customDates, today);
  const dates = orderedDates(range);
  const type = historyTypeOf(search.kind);
  const { from, to } = dates;
  const filters = useMemo(() => ({ from, to, kinds: kindsOf(type) }), [from, to, type]);
  const history = useWalletHistory(distributorId, filters);
  const items = useMemo(() => history.data?.pages.flatMap((page) => page.items), [history.data]);

  const setSearch = (patch: { from?: string; to?: string; kind?: ReturnType<typeof kindParam> }) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  const onRangeChange = (next: DateRange) => {
    setCustomDates(next.preset === 'custom');
    setStatementProblem(null);
    setSearch(next.preset === 'custom' ? { from: next.from || undefined, to: next.to || undefined } : searchForRange(next));
  };

  const download = async () => {
    setStatementProblem(null);
    setDownloading(true);
    try {
      const { rows, tooMany } = await fetchStatementRows(distributorId, filters, STATEMENT_MAX_ROWS);
      if (tooMany) setStatementProblem(t('statement.tooMany', { max: STATEMENT_MAX_ROWS.toLocaleString('en-US') }));
      else if (rows.length === 0) setStatementProblem(t('statement.nothing'));
      else downloadTextFile(statementFileName(name || row?.code || 'distributor', dates), statementCsv(rows));
    } catch (error) {
      setStatementProblem(toApiError(error).isNetwork ? t('correction.offline') : t('statement.failed'));
    } finally {
      setDownloading(false);
    }
  };

  const onSaved = async (result: WalletCorrectionResult) => {
    setCorrecting(false);
    toast.success(t('correction.saved', { distributor: name, balance: formatRs(result.wallet.balancePaisa) }));
    await invalidate();
  };

  const mismatch = detail.data ? integrityState(detail.data) === 'mismatch' : false;
  const title = name ? t('page.title', { distributor: name }) : t('page.fallbackTitle');

  if (detail.isError && !detail.data) {
    return (
      <div className="sf-wallet">
        <PageHeader title={title} />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} title={t('page.loadFailed')} />
      </div>
    );
  }

  return (
    <div className="sf-wallet">
      <PageHeader
        title={title}
        updatedAt={detail.dataUpdatedAt || null}
        onRefresh={() => void Promise.all([detail.refetch(), history.refetch()])}
        refreshing={detail.isFetching || (history.isFetching && !history.isFetchingNextPage)}
        secondaryActions={
          <>
            <Button
              icon={PencilLine}
              onClick={() => setCorrecting(true)}
              disabled={!detail.data || !row || mismatch}
              disabledReason={mismatch ? t('page.mismatchReason') : undefined}
            >
              {t('page.recordCorrection')}
            </Button>
            <Button icon={Download} onClick={() => void download()} loading={downloading} disabled={!detail.data}>
              {t('page.download')}
            </Button>
          </>
        }
      />

      <StaleBanner query={detail} />
      {list.isError && !row ? (
        <InlineAlert
          tone="warning"
          className="sf-wallet__statement-alert"
          action={
            <Button size="sm" onClick={() => void list.refetch()} loading={list.isFetching}>
              {t('common:actions.tryAgain')}
            </Button>
          }
        >
          {t('list.loadFailed')}
        </InlineAlert>
      ) : null}
      <BalanceCard detail={detail.data} />

      <section className="sf-wallet__history" aria-labelledby="sf-wallet-history-title">
        <h2 id="sf-wallet-history-title" className="sf-wallet__section-title">
          {t('history.title')}
        </h2>
        <FilterBar className="sf-wallet__filters">
          <DateRangeFilter value={range} onChange={onRangeChange} presets={HISTORY_PRESETS} today={today} />
          <Field label={t('history.type')} labelHidden>
            <Select
              value={type}
              options={HISTORY_TYPES.map((id) => ({ value: id, label: t(`history.types.${id}`) }))}
              onChange={(event) => {
                setStatementProblem(null);
                setSearch({ kind: kindParam(event.target.value as HistoryType) });
              }}
            />
          </Field>
        </FilterBar>
        {statementProblem ? (
          <InlineAlert tone="warning" live className="sf-wallet__statement-alert">
            {statementProblem}
          </InlineAlert>
        ) : null}
        <HistoryTable
          items={items}
          loading={history.isPending}
          error={history.isError && !history.data ? history.error : null}
          onRetry={() => void history.refetch()}
          retrying={history.isFetching}
          hasMore={history.hasNextPage}
          loadingMore={history.isFetchingNextPage}
          onLoadMore={() => void history.fetchNextPage()}
        />
      </section>

      {correcting && detail.data && row ? (
        <CorrectionModal
          distributorId={distributorId}
          distributorName={name}
          distributorCode={row.code}
          balancePaisa={detail.data.balancePaisa}
          onClose={() => setCorrecting(false)}
          onSaved={(result) => void onSaved(result)}
          onBalanceChanged={() => void detail.refetch()}
        />
      ) : null}
    </div>
  );
}

/** One Balance card, the money being checked, and the live integrity line (UX_ADMIN §2.6). */
function BalanceCard({ detail }: { detail: AdminWalletDetail | undefined }) {
  const { t } = useTranslation('wallets');
  const now = useNow(15_000);
  if (!detail) {
    return (
      <section className="sf-wallet__card">
        <SkeletonText lines={3} />
      </section>
    );
  }
  const { integrity } = detail;
  const state = integrityState(detail);
  const difference = integrity.differencePaisa.replace(/^-/, '');
  return (
    <>
      <section className="sf-wallet__card" aria-label={t('balance.label')}>
        <p className="sf-wallet__card-label">{t('balance.label')}</p>
        <MoneyText paisa={detail.balancePaisa} size="xl" strong className="sf-wallet__balance" />
        {detail.pendingTopupCount > 0 ? (
          <p className="sf-wallet__checking">{t('balance.checking', { amount: formatRs(detail.pendingTopupPaisa) })}</p>
        ) : null}
        {state === 'ok' ? (
          <p className="sf-wallet__integrity-ok">{t('integrity.ok', { ago: formatAgo(integrity.checkedAt, now) })}</p>
        ) : null}
      </section>
      {state === 'mismatch' ? (
        <InlineAlert tone="danger" className="sf-wallet__mismatch">
          {t('integrity.mismatch', { difference: formatRs(difference) })}
        </InlineAlert>
      ) : state === 'belowZero' ? (
        <InlineAlert tone="warning" className="sf-wallet__below-zero">
          {t('integrity.belowZero')}
        </InlineAlert>
      ) : null}
    </>
  );
}

interface HistoryTableProps {
  items: readonly StatementItem[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/** When · What happened · Change (signed) · Balance after · By, newest first, with "Load more". */
function HistoryTable({ items, loading, error, onRetry, retrying, hasMore, loadingMore, onLoadMore }: HistoryTableProps) {
  const { t } = useTranslation(['wallets', 'common']);
  const columns = useMemo<TableColumn<StatementItem>[]>(
    () => [
      {
        id: 'when',
        header: t('history.when'),
        sticky: true,
        cell: (item) => (
          <time dateTime={item.at} className="sf-wallet__when">
            {formatDateTime(item.at)}
          </time>
        ),
      },
      { id: 'what', header: t('history.what'), cell: (item) => historyWords(item) },
      { id: 'change', header: t('history.change'), align: 'end', cell: (item) => <MoneyText paisa={item.amountPaisa} signed tone="auto" /> },
      { id: 'balance', header: t('history.balanceAfter'), align: 'end', cell: (item) => <MoneyText paisa={item.balanceAfterPaisa} /> },
      {
        id: 'by',
        header: t('history.by'),
        priority: 3,
        cell: (item) => item.by?.name ?? <span className="sf-wallets__muted">{t('history.none')}</span>,
      },
    ],
    [t],
  );
  return (
    <Table
      caption={t('history.caption')}
      className="sf-wallet__table"
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      state={loading ? 'loading' : error ? 'error' : 'ready'}
      error={<ErrorState error={error} onRetry={onRetry} retrying={retrying} title={t('history.loadFailed')} />}
      empty={<EmptyState compact title={t('history.emptyTitle')} body={t('history.emptyBody')} />}
      footer={
        hasMore ? (
          <Button variant="ghost" onClick={onLoadMore} loading={loadingMore}>
            {t('common:actions.loadMore')}
          </Button>
        ) : undefined
      }
    />
  );
}
