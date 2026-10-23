import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type { DistributorHomeDto, Page, PaymentDto, StatementItem, StatementKind } from '@smartfleet/shared-types';
import { formatPkTime, formatRs, localDate } from '@smartfleet/shared-utils';
import { isNetworkError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { formatDayLabelText } from '../../i18n';
import {
  Button,
  Card,
  ChoiceChips,
  colors,
  EmptyState,
  ErrorBanner,
  Icon,
  layout,
  ListRow,
  MoneyText,
  moneyA11yLabel,
  OfflineEmpty,
  Screen,
  SkeletonCard,
  SkeletonList,
  sizes,
  space,
  StatusChip,
  Text,
} from '../../ui';
import { fetchHome, fetchMyTopups, fetchStatement } from './shared/api';
import { feeText, isPositivePaisa, paisaOrZero } from './shared/format';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { StaleNotice } from './shared/StaleNotice';

/** The three filters of History (shop spec §J): every row, the top-up requests, the delivery costs. */
export type WalletFilter = 'all' | 'topups' | 'deliveryCosts';

/** The statement kinds each ledger filter asks for; "Delivery costs" shows refunds beside their costs. */
const FILTER_KINDS: Record<Exclude<WalletFilter, 'topups'>, readonly StatementKind[] | undefined> = {
  all: undefined,
  deliveryCosts: ['DELIVERY_COST', 'DELIVERY_COST_RETURNED'],
};

interface Section<T> {
  key: string;
  title: string;
  data: T[];
}

/** Groups rows by their Asia/Karachi calendar day, newest first ("Today", "Yesterday", "Mon 19 Oct"). */
function byDay<T>(rows: readonly T[], at: (row: T) => string): Section<T>[] {
  const sections: Section<T>[] = [];
  for (const row of rows) {
    const day = localDate(at(row));
    const last = sections[sections.length - 1];
    if (last && last.key === day) last.data.push(row);
    else sections.push({ key: day, title: formatDayLabelText(at(row)), data: [row] });
  }
  return sections;
}

/** The query parts a list's header and empty state read. */
interface ListQuery {
  data: unknown;
  error: ApiError | null;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

/**
 * S7 History (shop spec §J; DECIDED "History rows"): the balance, three chips (All · Top-ups ·
 * Delivery costs), and the rows by day. A row's title is its kind ("Delivery cost", "Top-up",
 * "Refund"), its grey line the order or top-up number and the customer's name, and the amount is on
 * the right with the time under it; there is no "Balance after". "Top-ups" lists every request
 * (`GET /payments/mine`), because one that wasn't added never reaches the ledger.
 */
export function WalletScreen() {
  const { t } = useTranslation();
  const { params } = useShopRoute<'Wallet'>();
  const [filter, setFilter] = useState<WalletFilter>(params?.filter ?? 'all');
  useEffect(() => {
    if (params?.filter) setFilter(params.filter);
  }, [params?.filter]);

  const home = useQuery<DistributorHomeDto, ApiError>({ queryKey: qk.home, queryFn: fetchHome });
  const topups = useQuery<PaymentDto[], ApiError>({
    queryKey: qk.topups.mine,
    queryFn: fetchMyTopups,
    enabled: filter === 'topups',
  });

  // The header of either list; the chips hide only when the list has nothing to show and failed.
  const header = (showChips: boolean, stale: ReactNode) => (
    <View style={styles.header}>
      <SummaryCard home={home.data} loading={home.isPending} onBeingChecked={() => setFilter('topups')} />
      {showChips ? (
        <ChoiceChips<WalletFilter>
          columns={3}
          accessibilityLabel={t('wallet.history.filtersLabel')}
          options={[
            { value: 'all', label: t('wallet.history.filter.all') },
            { value: 'topups', label: t('wallet.history.filter.topups') },
            { value: 'deliveryCosts', label: t('wallet.history.filter.deliveryCosts') },
          ]}
          value={filter}
          onChange={setFilter}
        />
      ) : null}
      {stale}
    </View>
  );

  return (
    <Screen scroll={false} padded={false}>
      {filter === 'topups' ? (
        <RequestsList header={header} topups={topups} onRefreshAlso={home.refetch} />
      ) : (
        <StatementList key={filter} filter={filter} header={header} onRefreshAlso={home.refetch} />
      )}
    </Screen>
  );
}

/** Balance, and "Being checked" when above Rs 0 (never a skeleton "Rs 0"); that row opens "Top-ups". */
function SummaryCard({
  home,
  loading,
  onBeingChecked,
}: {
  home: DistributorHomeDto | undefined;
  loading: boolean;
  onBeingChecked: () => void;
}) {
  const { t } = useTranslation();
  if (!home) return loading ? <SkeletonCard lines={1} /> : null;
  const wallet = home.wallet;
  return (
    <Card>
      <View style={styles.summaryRow}>
        <Text variant="label" tone="secondary" style={styles.flex}>
          {t('wallet.card.balance')}
        </Text>
        <MoneyText paisa={wallet.balancePaisa} variant="title" numberOfLines={1} />
      </View>
      {isPositivePaisa(wallet.pendingTopupPaisa) ? (
        <Pressable
          onPress={onBeingChecked}
          accessibilityRole="button"
          android_ripple={{ color: colors.ripple }}
          style={[styles.summaryRow, styles.pendingRow]}
        >
          <Icon name="checking" size={20} tone="warning" />
          <Text tone="warning" style={styles.flex}>
            {t('wallet.card.beingChecked')}
          </Text>
          <MoneyText paisa={wallet.pendingTopupPaisa} variant="bodyStrong" tone="warning" />
          <Icon name="chevron" size={20} tone="secondary" />
        </Pressable>
      ) : null}
    </Card>
  );
}

/** What a list shows with no rows: skeletons, the offline or error state, or its empty state. */
function emptyOf(query: ListQuery, empty: ReactNode): ReactNode {
  if (query.data === undefined) {
    if (!query.isError) return <SkeletonList rows={4} />;
    return isNetworkError(query.error) ? (
      <OfflineEmpty onRetry={() => void query.refetch()} />
    ) : (
      <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />
    );
  }
  return empty;
}

function StatementList({
  filter,
  header,
  onRefreshAlso,
}: {
  filter: Exclude<WalletFilter, 'topups'>;
  header: (showChips: boolean, stale: ReactNode) => ReactElement;
  onRefreshAlso: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const statement = useInfiniteQuery<
    Page<StatementItem>,
    ApiError,
    InfiniteData<Page<StatementItem>>,
    ReturnType<typeof qk.wallet.statement>,
    string | null
  >({
    queryKey: qk.wallet.statement(filter),
    queryFn: ({ pageParam }) => fetchStatement({ kinds: FILTER_KINDS[filter], cursor: pageParam }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = useMemo(() => statement.data?.pages.flatMap((page) => page.items) ?? [], [statement.data]);
  const sections = useMemo(() => byDay(rows, (row) => row.at), [rows]);

  const refresh = () => {
    setRefreshing(true);
    Promise.all([statement.refetch(), onRefreshAlso()])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  const openRow = (row: StatementItem) => {
    const subject = row.subject;
    if (!subject) return;
    if (subject.type === 'ORDER') navigation.navigate('OrderDetail', { orderId: subject.id });
    else if (subject.type === 'TOPUP') navigation.navigate('TopupStatus', { id: subject.id });
  };

  const firstLoad = statement.data === undefined;
  const stale = statement.isError && !firstLoad && !statement.isFetchNextPageError;
  const addMoney = { label: t('common.actions.addMoney'), onPress: () => navigation.navigate('TopupAmount'), icon: 'addMoney' as const };

  return (
    <SectionList<StatementItem, Section<StatementItem>>
      sections={sections}
      keyExtractor={(row) => row.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header(
        !(firstLoad && statement.isError),
        stale ? <StaleNotice updatedAt={statement.dataUpdatedAt} onRetry={() => void statement.refetch()} /> : null,
      )}
      renderSectionHeader={({ section }) => (
        <Text variant="label" tone="secondary" style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => <StatementRow row={item} onPress={opensSomething(item) ? () => openRow(item) : undefined} />}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        <View style={styles.empty}>
          {emptyOf(
            statement,
            filter === 'all' ? (
              <EmptyState icon="wallet" title={t('wallet.empty')} action={addMoney} />
            ) : (
              <EmptyState icon="wallet" title={t('wallet.history.emptyFiltered')} />
            ),
          )}
        </View>
      }
      ListFooterComponent={
        <PageFooter
          loading={statement.isFetchingNextPage}
          failed={statement.isFetchNextPageError}
          onRetry={() => void statement.fetchNextPage()}
        />
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (statement.hasNextPage && !statement.isFetchingNextPage && !statement.isFetchNextPageError) {
          void statement.fetchNextPage();
        }
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} tintColor={colors.brand} />}
    />
  );
}

/** Rows that point at an order or a top-up open it. */
function opensSomething(row: StatementItem): boolean {
  return row.subject?.type === 'ORDER' || row.subject?.type === 'TOPUP';
}

/**
 * The amount, signed and green for money in, with the time under it (History's right side). A row
 * that opens nothing keeps the chevron's room, so the amounts line up in one column.
 */
function AmountAndTime({
  amount,
  time,
  signed = true,
  tone,
  inset = false,
}: {
  amount: string;
  time: string;
  signed?: boolean;
  tone?: 'success';
  inset?: boolean;
}) {
  return (
    <View style={[styles.trailing, inset ? styles.trailingInset : null]}>
      <MoneyText paisa={amount} sign={signed ? 'always' : 'none'} variant="bodyStrong" tone={tone} numberOfLines={1} />
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {time}
      </Text>
    </View>
  );
}

/**
 * One ledger row (DECIDED, review finding mobile-ux-05): the kind ("Delivery cost", "Refund"), the
 * grey line "AG-0142 · Sana" (or the top-up number, or the correction's reason), and on the right the
 * signed amount with its time.
 */
function StatementRow({ row, onPress }: { row: StatementItem; onPress?: () => void }) {
  const { t } = useTranslation();
  const title = t(`wallet.kind.${row.kind}`);
  const subject = row.subject;
  const subjectLine = subject
    ? subject.type === 'ORDER' && subject.clientName
      ? t('wallet.history.subjectLine', { code: subject.shortCode, name: subject.clientName })
      : subject.shortCode
    : null;
  const reasonCode = row.kind === 'CORRECTION' ? row.reasonCode : null;
  const reason = reasonCode && reasonCode !== 'OTHER' ? t(`wallet.correction.${reasonCode}`) : null;
  const subtitle =
    subjectLine && reason ? t('wallet.history.lineWithReason', { line: subjectLine, reason }) : subjectLine ?? reason ?? undefined;
  const time = formatPkTime(row.at);
  const moneyIn = paisaOrZero(row.amountPaisa) > 0;
  const spokenAmount = moneyA11yLabel(signedText(row.amountPaisa), t);

  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      chevron={!!onPress}
      accessibilityLabel={[title, spokenAmount, subtitle, time].filter(Boolean).join(', ')}
      trailing={<AmountAndTime amount={row.amountPaisa} time={time} tone={moneyIn ? 'success' : undefined} inset={!onPress} />}
    />
  );
}

function signedText(paisa: string): string {
  try {
    return formatRs(paisa, { sign: 'always' });
  } catch {
    return formatRs(null);
  }
}

function RequestsList({
  header,
  topups,
  onRefreshAlso,
}: {
  header: (showChips: boolean, stale: ReactNode) => ReactElement;
  topups: ListQuery & { data: PaymentDto[] | undefined };
  onRefreshAlso: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const sections = useMemo(() => byDay(topups.data ?? [], (p) => p.createdAt), [topups.data]);
  const firstLoad = topups.data === undefined;

  const refresh = () => {
    setRefreshing(true);
    Promise.all([topups.refetch(), onRefreshAlso()])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <SectionList<PaymentDto, Section<PaymentDto>>
      sections={sections}
      keyExtractor={(payment) => payment.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header(
        !(firstLoad && topups.isError),
        topups.isError && !firstLoad ? (
          <StaleNotice updatedAt={topups.dataUpdatedAt} onRetry={() => void topups.refetch()} />
        ) : null,
      )}
      renderSectionHeader={({ section }) => (
        <Text variant="label" tone="secondary" style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => <RequestRow payment={item} onPress={() => navigation.navigate('TopupStatus', { id: item.id })} />}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        <View style={styles.empty}>
          {emptyOf(
            topups,
            <EmptyState
              icon="receipt"
              title={t('wallet.history.requestsEmpty')}
              action={{ label: t('common.actions.addMoney'), onPress: () => navigation.navigate('TopupAmount'), icon: 'addMoney' }}
            />,
          )}
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} tintColor={colors.brand} />}
    />
  );
}

/**
 * A top-up request, in History's row shape: "Top-up", the grey line "AG-T031 · Ahmed Raza" ("You told
 * us Rs 5,000" under it when a different amount was added), the amount and time on the right, and
 * its chip (Being checked, Added, Not added) under the grey line.
 */
function RequestRow({ payment, onPress }: { payment: PaymentDto; onPress: () => void }) {
  const { t } = useTranslation();
  const added = payment.stage === 'ADDED';
  const amount = added && payment.creditedPaisa ? payment.creditedPaisa : payment.amountPaisa;
  const differs = added && !!payment.creditedPaisa && paisaOrZero(payment.creditedPaisa) !== paisaOrZero(payment.amountPaisa);
  const title = t('wallet.history.topupTitle');
  const subtitle = payment.payerName
    ? t('wallet.history.subjectLine', { code: payment.shortCode, name: payment.payerName })
    : payment.shortCode;
  const toldUs = differs ? t('wallet.history.toldUs', { amount: feeText(payment.amountPaisa) }) : undefined;
  const time = formatPkTime(payment.createdAt);
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      meta={toldUs}
      onPress={onPress}
      chevron
      accessibilityLabel={[
        title,
        moneyA11yLabel(feeText(amount), t),
        t(`stages.topup.${payment.stage}`),
        subtitle,
        toldUs,
        time,
      ]
        .filter(Boolean)
        .join(', ')}
      trailing={<AmountAndTime amount={amount} time={time} signed={false} />}
      below={<StatusChip kind="topup" value={payment.stage} />}
    />
  );
}

function PageFooter({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Text tone="secondary" align="center" style={styles.footer}>
        {t('wallet.history.loadingMore')}
      </Text>
    );
  }
  if (failed) {
    return (
      <View style={[styles.footer, styles.footerError]}>
        <Text tone="danger">{t('wallet.history.loadMoreError')}</Text>
        <Button label={t('common.actions.tryAgain')} onPress={onRetry} variant="secondary" fullWidth={false} />
      </View>
    );
  }
  return <View style={styles.footer} />;
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl, flexGrow: 1 },
  header: { padding: layout.gutter, gap: space.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  pendingRow: { minHeight: sizes.touch, marginTop: space.xs, borderTopWidth: 1, borderTopColor: colors.border },
  flex: { flex: 1 },
  sectionTitle: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    backgroundColor: colors.canvas,
  },
  divider: { height: 1, backgroundColor: colors.border },
  trailing: { alignItems: 'flex-end', gap: 2 },
  // The chevron (24) and the row's gap before it (12).
  trailingInset: { marginEnd: 24 + space.md },
  footer: { padding: layout.gutter, minHeight: space.xxl },
  footerError: { alignItems: 'center', gap: space.sm },
  empty: { paddingHorizontal: layout.gutter },
});
