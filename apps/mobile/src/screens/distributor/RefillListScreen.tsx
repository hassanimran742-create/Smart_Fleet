import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { FillingOrderDto } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { whenTranslate } from '../../i18n';
import {
  colors,
  EmptyState,
  FirstLoadState,
  Fab,
  FAB_CLEARANCE,
  layout,
  ListRow,
  Screen,
  SkeletonList,
  StatusChip,
  Text,
} from '../../ui';
import { refillChip, stageOf } from './refill/refillModel';
import { fetchMyRefills } from './shared/api';
import { rowTime } from './shared/format';
import { useShopNavigation } from './shared/navigation';
import { usePullRefresh, useRefetchOnReturn } from './shared/refresh';
import { StaleNotice } from './shared/StaleNotice';

/**
 * S16 Refills (UX_MOBILE §8.1; Inc 2/3 spec §4.1): the shop's refills newest first, in WhatsApp-like
 * rows ("3 × 6 kg", the refill number as the grey line, the time on the right, the stage chip with
 * "· 1 of 2" while the cylinders move), each opening the refill (S18), which holds the cancel. "+ New
 * refill" floats; it hides while the list is empty, whose empty state carries the button. No money
 * anywhere (ADR-16).
 */
export function RefillListScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const poll = useFocusedInterval(POLL_MS.ordersList);
  const refills = useQuery<FillingOrderDto[], ApiError>({
    queryKey: qk.refills.mine,
    queryFn: fetchMyRefills,
    refetchInterval: poll,
  });
  const pull = usePullRefresh(refills.refetch);
  useRefetchOnReturn(refills.refetch);

  const rows = [...(refills.data ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const isEmpty = refills.data !== undefined && rows.length === 0;
  const newRefill = () => navigation.navigate('NewRefill');

  return (
    <Screen
      scroll={false}
      padded={false}
      // The empty state carries the button while there is nothing to list.
      fab={<Fab label={t('refill.list.new')} onPress={newRefill} visible={!isEmpty} />}
    >
      <FlatList
        data={rows}
        keyExtractor={(refill) => refill.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          refills.isError && refills.data ? (
            <View style={styles.header}>
              <StaleNotice updatedAt={refills.dataUpdatedAt} onRetry={() => void refills.refetch()} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <RefillRow refill={item} onPress={() => navigation.navigate('RefillDetail', { refillId: item.id })} />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.empty}>
            {!refills.data ? (
              <FirstLoadState
                error={refills.error}
                isError={refills.isError}
                skeleton={<SkeletonList rows={3} />}
                onRetry={() => void refills.refetch()}
              />
            ) : (
              <EmptyState
                icon="cylinder"
                title={t('refill.list.empty')}
                action={{ label: t('refill.list.new'), onPress: newRefill, icon: 'plus', variant: 'primary' }}
              />
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

/** A refill (the shop's one row, shop spec §3.4): what, its number, when, and where it is now. */
function RefillRow({ refill, onPress }: { refill: FillingOrderDto; onPress: () => void }) {
  const { t } = useTranslation();
  const title = t('refill.list.row', { count: refill.requestedCount, size: refill.sizeLabel });
  const time = rowTime(refill.createdAt, whenTranslate);
  const chip = refillChip(stageOf(refill), refill.counts, t);
  const spoken = [title, refill.shortCode, time, chip?.label].filter(Boolean).join(', ');
  return (
    <ListRow
      leadingIcon="cylinder"
      title={title}
      subtitle={refill.shortCode ?? undefined}
      accessibilityLabel={spoken}
      trailing={
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {time}
        </Text>
      }
      below={chip ? <StatusChip tone={chip.tone} icon={chip.icon} label={chip.label} /> : <StatusChip kind="refill" value={null} />}
      onPress={onPress}
      chevron
    />
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  // The last row clears the floating "+ New refill".
  content: { paddingBottom: FAB_CLEARANCE, flexGrow: 1 },
  header: { padding: layout.gutter },
  empty: { padding: layout.gutter },
  divider: { height: 1, backgroundColor: colors.border },
});
