import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { CaseDto, Page } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { formatWhenText } from '../../i18n';
import { colors, EmptyState, ErrorBanner, layout, ListRow, Screen, SkeletonList, space, StatusChip } from '../../ui';
import { fetchMyCases } from './shared/api';
import { useShopNavigation } from './shared/navigation';
import { usePullRefresh } from './shared/refresh';
import { StaleNotice } from './shared/StaleNotice';

/**
 * [Inc 2] S15 Customer problems: the shop's open cases (`GET /alerts/mine`), each "AG-0142 · Sana",
 * the customer's answer and "since …"; a row opens its order. Reached from Home only while
 * `features.confirmations` is on. The office closes cases; the shop only sees them.
 */
export function CasesScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const cases = useQuery<Page<CaseDto>, ApiError>({ queryKey: qk.cases.mine, queryFn: fetchMyCases });
  const pull = usePullRefresh(cases.refetch);
  const items = cases.data?.items ?? [];

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          cases.isError && cases.data ? (
            <View style={styles.header}>
              <StaleNotice updatedAt={cases.dataUpdatedAt} onRetry={() => void cases.refetch()} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ListRow
            title={t('home.cases.row', { shortCode: item.order.shortCode, customer: item.customerName })}
            subtitle={t('home.cases.since', { when: formatWhenText(item.openedAt) })}
            trailing={<StatusChip kind="answer" value={item.answer} />}
            onPress={() => navigation.navigate('OrderDetail', { orderId: item.order.id })}
            chevron
          />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.empty}>
            {!cases.data ? (
              cases.isError ? (
                <ErrorBanner error={cases.error} onRetry={() => void cases.refetch()} />
              ) : (
                <SkeletonList rows={3} />
              )
            ) : (
              <EmptyState icon="ok" title={t('home.cases.empty')} />
            )}
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} colors={[colors.brand]} tintColor={colors.brand} />
        }
      />
    </Screen>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl, flexGrow: 1 },
  header: { padding: layout.gutter },
  empty: { padding: layout.gutter },
  divider: { height: 1, backgroundColor: colors.border },
});
