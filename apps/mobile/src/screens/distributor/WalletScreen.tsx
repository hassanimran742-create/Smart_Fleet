import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type { DistributorHomeDto, Page, PaymentDto, StatementItem, StatementKind } from '@smartfleet/shared-types';
import { formatPkTime, formatRs, localDate } from '@smartfleet/shared-utils';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { formatDayLabelText, formatWhenText } from '../../i18n';
import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorBanner,
  layout,
  ListRow,
  MoneyText,
  moneyA11yLabel,
  Screen,
  SkeletonList,
  space,
  StatusChip,
  Text,
} from '../../ui';
import { fetchHome, fetchMyTopups, fetchStatement } from './shared/api';
import { FilterChips } from './shared/FilterChips';
import { feeText, isPositivePaisa, paisaOrZero } from './shared/format';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { StaleNotice } from './shared/StaleNotice';

/** The four filters of Wallet history (UX_MOBILE S7). */
export type WalletFilter = 'all' | 'topups' | 'deliveryCosts' | 'requests';

/** The statement kinds each ledger filter asks for; "Delivery costs" shows returned costs beside their costs. */
const FILTER_KINDS: Record<Exclude<WalletFilter, 'requests'>, readonly StatementKind[] | undefined> = {
  all: undefined,
  topups: ['TOPUP_ADDED'],
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

/**
 * S7 Wallet history (replaces the unrouted LedgerScreen): the balance, filter chips (All · Money added
 * · Delivery costs · Top-up requests), top-ups being checked pinned at the top, and the ledger rows by
 * day with their kind, number, customer and "Balance after". "Top-up requests" lists every request
 * from `GET /payments/mine`, because a refused one never reaches the ledger.
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
    enabled: filter === 'all' || filter === 'requests',
  });

  const header = (
    <View style={styles.header}>
      <WalletSummaryCard home={home.data} loading={home.isPending} />
      {/* Two rows of two, so all four show on a 360 dp phone; "Top-up requests" is the only place a
          refused top-up appears, and Home's "Being checked" opens it chosen (S2, S7). */}
      <FilterChips<WalletFilter>
        columns={2}
        accessibilityLabel={t('wallet.history.filtersLabel')}
        options={[
          { value: 'all', label: t('wallet.history.filter.all') },
          { value: 'topups', label: t('wallet.history.filter.topups') },
          { value: 'deliveryCosts', label: t('wallet.history.filter.deliveryCosts') },
          { value: 'requests', label: t('wallet.history.filter.requests') },
        ]}
        value={filter}
        onChange={setFilter}
      />
    </View>
  );

  return (
    <Screen scroll={false} padded={false}>
      {filter === 'requests' ? (
        <RequestsList header={header} topups={topups} onRefreshAlso={home.refetch} />
      ) : (
        <StatementList
          key={filter}
          filter={filter}
          header={header}
          pending={(topups.data ?? []).filter((p) => p.stage === 'BEING_CHECKED')}
          onRefreshAlso={() => Promise.all([home.refetch(), topups.refetch()])}
        />
      )}
    </Screen>
  );
}

/** Balance, and "Being checked" when above Rs 0 (never a skeleton "Rs 0"). */
function WalletSummaryCard({ home, loading }: { home: DistributorHomeDto | undefined; loading: boolean }) {
  const { t } = useTranslation();
  if (!home) {
    return loading ? <SkeletonList rows={1} /> : null;
  }
  const wallet = home.wallet;
  return (
    <Card>
      <View style={styles.summaryRow}>
        <Text variant="label" tone="secondary" style={styles.flex}>
          {t('wallet.card.balance')}
        </Text>
        <MoneyText paisa={wallet.balancePaisa} variant="title" />
      </View>
      {isPositivePaisa(wallet.pendingTopupPaisa) ? (
        <View style={styles.summaryRow}>
          <Text variant="label" tone="warning" style={styles.flex}>
            {t('wallet.card.beingChecked')}
          </Text>
          <MoneyText paisa={wallet.pendingTopupPaisa} variant="bodyStrong" tone="warning" />
        </View>
      ) : null}
    </Card>
  );
}

function StatementList({
  filter,
  header,
  pending,
  onRefreshAlso,
}: {
  filter: Exclude<WalletFilter, 'requests'>;
  header: ReactNode;
  pending: PaymentDto[];
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

  const listHeader = (
    <View style={styles.listHeader}>
      {header}
      {stale ? <StaleNotice updatedAt={statement.dataUpdatedAt} onRetry={() => void statement.refetch()} /> : null}
      {filter === 'all' && pending.length > 0 ? (
        <View style={styles.pinned}>
          <Text variant="label" tone="secondary">
            {t('wallet.history.pinned')}
          </Text>
          <Card padding={0}>
            {pending.map((payment, index) => (
              <View key={payment.id}>
                {index > 0 ? <Divider /> : null}
                <RequestRow payment={payment} onPress={() => navigation.navigate('TopupStatus', { id: payment.id })} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  );

  return (
    <SectionList<StatementItem, Section<StatementItem>>
      sections={sections}
      keyExtractor={(row) => row.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      ListHeaderComponent={listHeader}
      renderSectionHeader={({ section }) => (
        <Text variant="label" tone="secondary" style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => <StatementRow row={item} onPress={item.subject ? () => openRow(item) : undefined} />}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        <View style={styles.empty}>
          {firstLoad ? (
            statement.isError ? (
              <ErrorBanner error={statement.error} onRetry={() => void statement.refetch()} />
            ) : (
              <SkeletonList rows={4} />
            )
          ) : filter === 'all' ? (
            <EmptyState
              icon="wallet"
              title={t('wallet.empty')}
              action={{ label: t('common.actions.addMoney'), onPress: () => navigation.navigate('TopupAmount'), icon: 'addMoney' }}
            />
          ) : (
            <EmptyState icon="wallet" title={t('wallet.history.emptyFiltered')} />
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

/** One ledger row: "Delivery cost · AG-0142 · Sana", the time, "Balance after Rs 4,520", the signed amount. */
function StatementRow({ row, onPress }: { row: StatementItem; onPress?: () => void }) {
  const { t } = useTranslation();
  const kind = t(`wallet.kind.${row.kind}`);
  const subject = row.subject;
  const title = !subject
    ? kind
    : subject.type === 'ORDER' && subject.clientName
      ? t('wallet.history.rowWithCodeAndName', { kind, code: subject.shortCode, name: subject.clientName })
      : t('wallet.history.rowWithCode', { kind, code: subject.shortCode });
  const time = formatPkTime(row.at);
  const reason = row.kind === 'CORRECTION' && row.reasonCode ? t(`wallet.correction.${row.reasonCode}`) : null;
  const subtitle = reason ? t('wallet.history.timeWithReason', { time, reason }) : time;
  const balanceAfter = t('wallet.history.balanceAfter', { balance: feeText(row.balanceAfterPaisa) });
  const moneyIn = paisaOrZero(row.amountPaisa) > 0;
  const spokenAmount = moneyA11yLabel(formatSigned(row.amountPaisa), t);

  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      meta={balanceAfter}
      onPress={onPress}
      chevron={!!onPress}
      accessibilityLabel={[title, spokenAmount, subtitle, balanceAfter].join(', ')}
      trailing={<MoneyText paisa={row.amountPaisa} sign="always" variant="bodyStrong" tone={moneyIn ? 'success' : 'default'} />}
    />
  );
}

function formatSigned(paisa: string): string {
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
  header: ReactNode;
  topups: { data: PaymentDto[] | undefined; error: ApiError | null; isError: boolean; dataUpdatedAt: number; refetch: () => Promise<unknown> };
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
      ListHeaderComponent={
        <View style={styles.listHeader}>
          {header}
          {topups.isError && !firstLoad ? (
            <StaleNotice updatedAt={topups.dataUpdatedAt} onRetry={() => void topups.refetch()} />
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text variant="label" tone="secondary" style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <RequestRow payment={item} onPress={() => navigation.navigate('TopupStatus', { id: item.id })} />
      )}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        <View style={styles.empty}>
          {firstLoad ? (
            topups.isError ? (
              <ErrorBanner error={topups.error} onRetry={() => void topups.refetch()} />
            ) : (
              <SkeletonList rows={4} />
            )
          ) : (
            <EmptyState
              icon="receipt"
              title={t('wallet.history.requestsEmpty')}
              action={{ label: t('common.actions.addMoney'), onPress: () => navigation.navigate('TopupAmount'), icon: 'addMoney' }}
            />
          )}
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} tintColor={colors.brand} />}
    />
  );
}

/** A top-up request: "Top-up AG-T031", when it was sent, the amount and its stage chip. */
function RequestRow({ payment, onPress }: { payment: PaymentDto; onPress: () => void }) {
  const { t } = useTranslation();
  const title = t('wallet.history.requestTitle', { code: payment.shortCode });
  const subtitle = t('wallet.history.requestedAt', { when: formatWhenText(payment.createdAt) });
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      chevron
      accessibilityLabel={[title, moneyA11yLabel(feeText(payment.amountPaisa), t), t(`stages.topup.${payment.stage}`), subtitle].join(', ')}
      trailing={
        <View style={styles.requestTrailing}>
          <MoneyText paisa={payment.amountPaisa} variant="bodyStrong" />
          <StatusChip kind="topup" value={payment.stage} />
        </View>
      }
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
  header: { gap: space.md },
  listHeader: { padding: layout.gutter, gap: space.md },
  pinned: { gap: space.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  flex: { flex: 1 },
  sectionTitle: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    backgroundColor: colors.canvas,
  },
  divider: { height: 1, backgroundColor: colors.border },
  requestTrailing: { alignItems: 'flex-end', gap: space.xs },
  footer: { padding: layout.gutter, minHeight: space.xxl },
  footerError: { alignItems: 'center', gap: space.sm },
  empty: { paddingHorizontal: layout.gutter },
});
