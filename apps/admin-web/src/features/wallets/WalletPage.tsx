import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Download, SquarePen, Wallet } from 'lucide-react';
import type { AdminWalletDetail, StatementItem, WalletCorrectionResult } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import { formatDayLabel, formatRs, formatTime } from '../../i18n/format';
import {
  Button,
  Chip,
  cx,
  DateRangeFilter,
  EmptyState,
  ErrorState,
  FilterChips,
  InlineAlert,
  MoneyText,
  PageHeader,
  Skeleton,
  SkeletonText,
  StaleBanner,
  Table,
  useHighlight,
  useToast,
  type DateRange,
  type TableColumn,
} from '../../ui';
import {
  fetchStatementRows,
  useInvalidateAfterCorrection,
  useWalletDetail,
  useWalletHasHistory,
  useWalletHistory,
  useWalletList,
} from './api';
import { CorrectionModal } from './CorrectionModal';
import { HISTORY_PRESETS, historyToday, rangeFromSearch } from './historyDates';
import { integrityState } from './integrity';
import {
  downloadTextFile,
  HISTORY_TYPES,
  historyTarget,
  historyTypeOf,
  historyWords,
  kindParam,
  kindsOf,
  orderedDates,
  searchForRange,
  STATEMENT_MAX_ROWS,
  statementCsv,
  statementFileName,
} from './statement';
import './wallets.css';

const route = getRouteApi('/wallets/$distributorId');

/** The balance card's key for `useHighlight` after a correction. */
const BALANCE_CARD = 'balance';

/**
 * One distributor's wallet (`/wallets/$distributorId?from&to&kind`, website spec W13): the balance card
 * with the money in top-ups to check and the integrity chip, the history by day (paged, no row cap), the
 * CSV statement and the correction dialog. The page only reads; a history that doesn't add up disables
 * "Record correction…" (G01-06), while a balance below zero whose history adds up keeps it on, since a
 * correction is the fix.
 */
export function WalletPage() {
  const { t } = useTranslation(['wallets', 'common', 'nav']);
  const { distributorId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const goTo = useNavigate();
  const toast = useToast();
  const { config } = useAppConfig();
  const invalidate = useInvalidateAfterCorrection();
  const detail = useWalletDetail(distributorId);
  const list = useWalletList();
  const [customDates, setCustomDates] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [statementProblem, setStatementProblem] = useState<string | null>(null);
  const [cardFlash, flashCard] = useHighlight();
  const [rowFlash, flashHistoryRow] = useHighlight();

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
  const defaultFilters = !search.from && !search.to && !search.kind && !customDates;
  // Nothing this month: a new wallet or a quiet one? One row with no dates tells them apart.
  const anyHistory = useWalletHasHistory(distributorId, defaultFilters && items !== undefined && items.length === 0);

  const setSearch = (patch: { from?: string; to?: string; kind?: ReturnType<typeof kindParam> }) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  const onRangeChange = (next: DateRange) => {
    setCustomDates(next.preset === 'custom');
    setStatementProblem(null);
    setSearch(next.preset === 'custom' ? { from: next.from || undefined, to: next.to || undefined } : searchForRange(next));
  };

  const clearFilters = () => {
    setCustomDates(false);
    setStatementProblem(null);
    void navigate({ search: {}, replace: true });
  };

  const openRecord = useCallback(
    (item: StatementItem) => {
      const target = historyTarget(item);
      if (target?.kind === 'TOPUP') void goTo({ to: '/topups/$paymentId', params: { paymentId: target.id }, search: {} });
      else if (target?.kind === 'ORDER') void goTo({ to: '/orders/$orderId', params: { orderId: target.id }, search: {} });
    },
    [goTo],
  );

  const download = async () => {
    setStatementProblem(null);
    setDownloading(true);
    try {
      const { rows, tooMany } = await fetchStatementRows(distributorId, filters, STATEMENT_MAX_ROWS);
      if (tooMany) setStatementProblem(t('statement.tooMany'));
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
    // The changed card and the new row are tinted once the refreshed data is on screen.
    flashCard(BALANCE_CARD);
    flashHistoryRow(result.entry.id);
  };

  const mismatch = detail.data ? integrityState(detail.data) === 'mismatch' : false;
  const title = name ? t('page.title', { distributor: name }) : list.isPending ? <Skeleton width="14rem" /> : t('nav:pages.wallet');

  if (detail.isError && !detail.data) {
    return (
      <div className="sf-wallet">
        <PageHeader title={title} />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} title={t('page.loadFailed')} />
      </div>
    );
  }

  const historyEmpty =
    defaultFilters && anyHistory.data === false ? (
      <EmptyState compact icon={Wallet} title={t('history.emptyNew')} />
    ) : defaultFilters ? (
      <EmptyState compact title={t('history.emptyTitle')} />
    ) : (
      <EmptyState
        compact
        title={t('history.emptyTitle')}
        action={
          <Button size="sm" onClick={clearFilters}>
            {t('common:actions.clearFilters')}
          </Button>
        }
      />
    );
  // Until the one-row check answers, an empty default view keeps its skeleton rather than guess.
  const checkingNew = defaultFilters && items !== undefined && items.length === 0 && anyHistory.isPending;

  return (
    <div className="sf-wallet">
      <PageHeader
        title={title}
        secondaryActions={
          detail.data && row ? (
            <>
              <Button variant="ghost" icon={Download} onClick={() => void download()} loading={downloading}>
                {t('page.download')}
              </Button>
              <Button
                icon={SquarePen}
                onClick={() => setCorrecting(true)}
                disabled={mismatch}
                disabledReason={mismatch ? t('page.mismatchReason') : undefined}
                reasonVisible
              >
                {t('page.recordCorrection')}
              </Button>
            </>
          ) : undefined
        }
      />

      <StaleBanner query={detail} />
      {list.isError && !row ? (
        <InlineAlert
          tone="warning"
          className="sf-wallet__alert"
          action={
            <Button size="sm" onClick={() => void list.refetch()} loading={list.isFetching}>
              {t('common:actions.tryAgain')}
            </Button>
          }
        >
          {t('list.loadFailed')}
        </InlineAlert>
      ) : null}
      <BalanceCard detail={detail.data} name={name} highlighted={cardFlash === BALANCE_CARD} />

      <section className="sf-wallet__history" aria-labelledby="sf-wallet-history-title">
        <h2 id="sf-wallet-history-title" className="sf-wallet__section-title">
          {t('history.title')}
        </h2>
        <div className="sf-wallet__filters">
          <DateRangeFilter value={range} onChange={onRangeChange} presets={HISTORY_PRESETS} today={today} />
          <FilterChips
            label={t('history.type')}
            options={HISTORY_TYPES.map((id) => ({ value: id, label: t(`history.types.${id}`) }))}
            value={type}
            onChange={(next) => {
              setStatementProblem(null);
              setSearch({ kind: kindParam(next) });
            }}
          />
        </div>
        {statementProblem ? (
          <InlineAlert tone="warning" live className="sf-wallet__alert">
            {statementProblem}
          </InlineAlert>
        ) : null}
        <HistoryTable
          items={items}
          loading={history.isPending || checkingNew}
          error={history.isError && !history.data ? history.error : null}
          onRetry={() => void history.refetch()}
          retrying={history.isFetching}
          hasMore={history.hasNextPage}
          loadingMore={history.isFetchingNextPage}
          onLoadMore={() => void history.fetchNextPage()}
          onOpen={openRecord}
          highlightKey={rowFlash}
          empty={historyEmpty}
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

/**
 * The balance in one full-width row (W13): the amount, the money in top-ups to check (a link to them),
 * and "History adds up"; under it, the one alert that applies when it doesn't, or when the balance is
 * below zero.
 */
function BalanceCard({ detail, name, highlighted }: { detail: AdminWalletDetail | undefined; name: string; highlighted: boolean }) {
  const { t } = useTranslation('wallets');
  if (!detail) {
    return (
      <section className="sf-wallet__card" aria-hidden>
        <SkeletonText lines={2} className="sf-wallet__card-skeleton" />
      </section>
    );
  }
  const state = integrityState(detail);
  const difference = detail.integrity.differencePaisa.replace(/^-/, '');
  return (
    <>
      <section className={cx('sf-wallet__card', highlighted && 'sf-highlight')} aria-label={t('balance.label')}>
        <div className="sf-wallet__balance-block">
          <p className="sf-wallet__card-label">{t('balance.label')}</p>
          <MoneyText paisa={detail.balancePaisa} size="xl" strong className="sf-wallet__balance" />
        </div>
        {detail.pendingTopupCount > 0 ? (
          <Link to="/topups" search={{ tab: 'to-check', q: name || undefined }} className="sf-wallet__checking">
            {t('balance.checking', { amount: formatRs(detail.pendingTopupPaisa) })}
          </Link>
        ) : null}
        {state === 'ok' ? (
          <Chip tone="success" className="sf-wallet__adds-up">
            {t('integrity.ok')}
          </Chip>
        ) : null}
      </section>
      {state === 'mismatch' ? (
        <InlineAlert tone="danger" className="sf-wallet__alert">
          {t('integrity.mismatch', { difference: formatRs(difference) })}
        </InlineAlert>
      ) : state === 'belowZero' ? (
        <InlineAlert tone="warning" className="sf-wallet__alert">
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
  onOpen: (item: StatementItem) => void;
  highlightKey: string | null;
  empty: ReactNode;
}

/**
 * The history by day ("Today", "Thu 22 Oct"): When · What happened · Change (signed) · Balance after ·
 * By, newest first, with "Load more". A top-up or order row opens its record.
 */
function HistoryTable({
  items,
  loading,
  error,
  onRetry,
  retrying,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  highlightKey,
  empty,
}: HistoryTableProps) {
  const { t } = useTranslation(['wallets', 'common']);
  const now = useNow(60_000);
  const columns = useMemo<TableColumn<StatementItem>[]>(
    () => [
      {
        id: 'when',
        header: t('history.when'),
        sticky: true,
        cell: (item) => (
          <time dateTime={item.at} className="sf-wallet__when">
            {formatTime(item.at)}
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
      onRowClick={onOpen}
      canOpenRow={(item) => historyTarget(item) !== null}
      chevron
      groupBy={(item) => formatDayLabel(item.at, now)}
      highlightKey={highlightKey}
      state={loading ? 'loading' : error ? 'error' : 'ready'}
      error={<ErrorState error={error} onRetry={onRetry} retrying={retrying} title={t('history.loadFailed')} />}
      empty={empty}
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
