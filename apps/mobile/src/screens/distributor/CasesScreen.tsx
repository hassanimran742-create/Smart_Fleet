import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { CaseDto, Page } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { whenTranslate } from '../../i18n';
import {
  colors,
  EmptyState,
  FirstLoadState,
  layout,
  ListRow,
  resolveStatus,
  Screen,
  SkeletonList,
  space,
  StatusChip,
  Text,
} from '../../ui';
import { fetchMyCases } from './shared/api';
import { rowTime } from './shared/format';
import { useShopNavigation } from './shared/navigation';
import { usePullRefresh, useRefetchOnReturn } from './shared/refresh';
import { StaleNotice } from './shared/StaleNotice';

/**
 * [Inc 2] S15 Customer problems (UX_MOBILE §7.3; Inc 2/3 spec §2.7): the shop's open problems
 * (`GET /alerts/mine`), WhatsApp-like: the customer's name, the grey line "AG-0142 · “Nothing came”"
 * (or just the order number), the time on the right and the red answer chip below; a row opens its
 * order. Reached from Home only while `features.confirmations` is on. No footer: the office closes
 * problems; the shop only reads them.
 */
export function CasesScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const cases = useQuery<Page<CaseDto>, ApiError>({ queryKey: qk.cases.mine, queryFn: fetchMyCases });
  const pull = usePullRefresh(cases.refetch);
  useRefetchOnReturn(cases.refetch);
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
        renderItem={({ item }) => <CaseRow item={item} onPress={() => navigation.navigate('OrderDetail', { orderId: item.order.id })} />}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.empty}>
            {!cases.data ? (
              <FirstLoadState
                error={cases.error}
                isError={cases.isError}
                skeleton={<SkeletonList rows={3} />}
                onRetry={() => void cases.refetch()}
              />
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

/** One problem: who, then what (the order and the customer's note), the time on the right. */
function CaseRow({ item, onPress }: { item: CaseDto; onPress: () => void }) {
  const { t } = useTranslation();
  const comment = item.comment?.trim();
  const time = rowTime(item.openedAt, whenTranslate);
  const title = t('home.cases.row', { customer: item.customerName });
  const subtitle = comment ? t('home.cases.sub', { shortCode: item.order.shortCode, comment }) : item.order.shortCode;
  const spoken = [title, subtitle, time, resolveStatus('answer', item.answer, t)?.label].filter(Boolean).join(', ');
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      accessibilityLabel={spoken}
      trailing={
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {time}
        </Text>
      }
      below={<StatusChip kind="answer" value={item.answer} />}
      onPress={onPress}
      chevron
    />
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
