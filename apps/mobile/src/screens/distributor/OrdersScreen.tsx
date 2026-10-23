import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type { DistributorHomeDto, OrderDto, OrderListTab, Page } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import {
  Button,
  colors,
  EmptyState,
  ErrorBanner,
  layout,
  SegmentedControl,
  Screen,
  SkeletonList,
  space,
  Text,
} from '../../ui';
import { fetchHome, fetchOrdersPage } from './shared/api';
import { activeTabCount } from './shared/format';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { OrderRow } from './shared/OrderRow';
import { StaleNotice } from './shared/StaleNotice';

/**
 * S10 My orders (replaces OrderHistoryScreen): "Active (n)" and "Done" from `GET /orders?tab`, each
 * row with its stage and fee chips. Polls every 30 seconds while the screen is open, plus pull to
 * refresh.
 */
export function OrdersScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'Orders'>();
  const [tab, setTab] = useState<OrderListTab>(params?.tab ?? 'active');
  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);

  const home = useQuery<DistributorHomeDto, ApiError>({ queryKey: qk.home, queryFn: fetchHome });
  const poll = useFocusedInterval(POLL_MS.ordersList);
  const orders = useInfiniteQuery<Page<OrderDto>, ApiError, InfiniteData<Page<OrderDto>>, ReturnType<typeof qk.orders.list>, string | null>({
    queryKey: qk.orders.list(tab),
    queryFn: ({ pageParam }) => fetchOrdersPage(tab, pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: poll,
  });
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.items) ?? [], [orders.data]);
  const firstLoad = orders.data === undefined;
  const activeCount = activeTabCount({
    tab,
    rowCount: firstLoad ? null : rows.length,
    hasMorePages: orders.hasNextPage,
    homeCount: home.data?.orders.active,
  });

  const refresh = () => {
    setRefreshing(true);
    Promise.all([orders.refetch(), home.refetch()])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(order) => order.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <SegmentedControl<OrderListTab>
              accessibilityLabel={t('orders.list.tabsLabel')}
              options={[
                {
                  value: 'active',
                  label:
                    activeCount === null
                      ? t('orders.list.activeNoCount')
                      : t('orders.list.active', { count: activeCount }),
                },
                { value: 'done', label: t('orders.list.done') },
              ]}
              value={tab}
              onChange={setTab}
            />
            {orders.isError && !firstLoad && !orders.isFetchNextPageError ? (
              <StaleNotice updatedAt={orders.dataUpdatedAt} onRetry={() => void orders.refetch()} />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <OrderRow order={item} onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })} />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.empty}>
            {firstLoad ? (
              orders.isError ? (
                <ErrorBanner error={orders.error} onRetry={() => void orders.refetch()} />
              ) : (
                <SkeletonList rows={4} />
              )
            ) : tab === 'active' ? (
              <EmptyState
                icon="order"
                title={t('orders.list.emptyActive')}
                action={{
                  label: t('orders.list.newOrder'),
                  onPress: () => navigation.navigate('NewOrder'),
                  icon: 'order',
                  variant: 'primary',
                }}
              />
            ) : (
              <EmptyState icon="order" title={t('orders.list.emptyDone')} />
            )}
          </View>
        }
        ListFooterComponent={
          orders.isFetchingNextPage ? (
            <Text tone="secondary" align="center" style={styles.footer}>
              {t('orders.list.loadingMore')}
            </Text>
          ) : orders.isFetchNextPageError ? (
            <View style={[styles.footer, styles.footerError]}>
              <Text tone="danger">{t('orders.list.loadMoreError')}</Text>
              <Button
                label={t('common.actions.tryAgain')}
                onPress={() => void orders.fetchNextPage()}
                variant="secondary"
                fullWidth={false}
              />
            </View>
          ) : (
            <View style={styles.footer} />
          )
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage && !orders.isFetchNextPageError) void orders.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} tintColor={colors.brand} />}
      />
    </Screen>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl, flexGrow: 1 },
  header: { padding: layout.gutter, gap: space.md },
  empty: { paddingHorizontal: layout.gutter },
  divider: { height: 1, backgroundColor: colors.border },
  footer: { padding: layout.gutter, minHeight: space.xxl },
  footerError: { alignItems: 'center', gap: space.sm },
});
