import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { DistributorHomeDto, OrderListTab } from '@smartfleet/shared-types';
import { isNetworkError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import {
  Button,
  colors,
  EmptyState,
  ErrorBanner,
  Fab,
  FAB_CLEARANCE,
  layout,
  OfflineEmpty,
  SegmentedControl,
  Screen,
  SkeletonList,
  space,
  Text,
} from '../../ui';
import { fetchHome } from './shared/api';
import { activeTabCount } from './shared/format';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { OrderRow } from './shared/OrderRow';
import { useOrderPages } from './shared/queries';
import { StaleNotice } from './shared/StaleNotice';

/**
 * S10 My orders (shop spec §S): "Active (n)" and "Done" from `GET /orders?tab`, in WhatsApp-like rows
 * with the time on the right and the stage chip under the grey line ("Rs 400 returned" or "No refund"
 * only on a cancelled order). "+ New order" floats at the bottom end. Polls every 30 seconds while the
 * screen is open, plus pull to refresh.
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
  const orders = useOrderPages(tab, { refetchInterval: poll });
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
    <Screen
      scroll={false}
      padded={false}
      fab={<Fab label={t('orders.list.newOrder')} onPress={() => navigation.navigate('NewOrder')} />}
    >
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
                isNetworkError(orders.error) ? (
                  <OfflineEmpty onRetry={() => void orders.refetch()} />
                ) : (
                  <ErrorBanner error={orders.error} onRetry={() => void orders.refetch()} />
                )
              ) : (
                <SkeletonList rows={4} />
              )
            ) : (
              // The Fab is the empty state's button.
              <EmptyState icon="order" title={tab === 'active' ? t('orders.list.emptyActive') : t('orders.list.emptyDone')} />
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
          ) : null
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
  // The last row clears the floating "+ New order".
  content: { paddingBottom: FAB_CLEARANCE, flexGrow: 1 },
  header: { padding: layout.gutter, gap: space.md },
  empty: { paddingHorizontal: layout.gutter },
  divider: { height: 1, backgroundColor: colors.border },
  footer: { padding: layout.gutter },
  footerError: { alignItems: 'center', gap: space.sm },
});
