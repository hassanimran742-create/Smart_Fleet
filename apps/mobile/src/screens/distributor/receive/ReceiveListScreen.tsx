import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { StoreIncomingDto } from '@smartfleet/shared-types';
import type { ApiError } from '../../../api/errors';
import { POLL_MS, qk } from '../../../api/keys';
import { useFocusedInterval } from '../../../hooks/useFocusedInterval';
import {
  colors,
  EmptyState,
  FirstLoadState,
  layout,
  ListRow,
  Screen,
  SkeletonList,
  space,
  StatusChip,
} from '../../../ui';
import { fetchStoreIncoming } from '../shared/api';
import { useShopNavigation } from '../shared/navigation';
import { usePullRefresh, useRefetchOnReturn } from '../shared/refresh';
import { StaleNotice } from '../shared/StaleNotice';
import { vanProgress, type IncomingVan } from './receiveModel';

/**
 * [Inc 2] S13 Receive from driver, the list (Inc 2/3 spec §2.2): one row per van coming back, "{{driver}}
 * · {{plate}}" with "{{done}} of {{total}} received", a "Refill" chip when a cylinder came back from a
 * refill, and "All received" once a van is done (until the next poll drops it). Each row is the action:
 * it opens the scan. No footer. Polls `GET /store/incoming` every 15 s while focused. Home opens the
 * scan straight away when exactly one van is coming back.
 */
export function ReceiveListScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const poll = useFocusedInterval(POLL_MS.storeIncoming);
  const incoming = useQuery<StoreIncomingDto, ApiError>({
    queryKey: qk.store.incoming,
    queryFn: fetchStoreIncoming,
    refetchInterval: poll,
  });
  const pull = usePullRefresh(incoming.refetch);
  useRefetchOnReturn(incoming.refetch);
  const vans = incoming.data?.vans ?? [];

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={vans}
        keyExtractor={(van) => van.vehicle.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          incoming.isError && incoming.data ? (
            <View style={styles.header}>
              <StaleNotice updatedAt={incoming.dataUpdatedAt} onRetry={() => void incoming.refetch()} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <VanRow van={item} onPress={() => navigation.navigate('ReceiveScan', { vehicleId: item.vehicle.id })} />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.empty}>
            {!incoming.data ? (
              <FirstLoadState
                error={incoming.error}
                isError={incoming.isError}
                skeleton={<SkeletonList rows={2} />}
                onRetry={() => void incoming.refetch()}
              />
            ) : (
              <EmptyState icon="store" title={t('receive.empty')} />
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

/** The van's name as people know it: "Kashif · LEA-101", or the plate alone with no driver. */
export function vanTitle(van: IncomingVan, t: TFunction): string {
  return van.driver ? t('receive.row', { driver: van.driver.name, plate: van.vehicle.plateNo }) : van.vehicle.plateNo;
}

function VanRow({ van, onPress }: { van: IncomingVan; onPress: () => void }) {
  const { t } = useTranslation();
  const progress = vanProgress(van);
  const title = vanTitle(van, t);
  const subtitle = t('receive.progress', { done: progress.done, total: progress.total });
  const spoken = [
    title,
    subtitle,
    progress.hasRefill ? t('receive.refill') : null,
    progress.complete ? t('receive.allDone') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <ListRow
      leadingIcon="van"
      title={title}
      subtitle={subtitle}
      accessibilityLabel={spoken}
      below={
        progress.complete || progress.hasRefill ? (
          <>
            {progress.hasRefill ? <StatusChip tone="brand" icon="cylinder" label={t('receive.refill')} /> : null}
            {progress.complete ? <StatusChip tone="success" icon="ok" label={t('receive.allDone')} /> : null}
          </>
        ) : undefined
      }
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
