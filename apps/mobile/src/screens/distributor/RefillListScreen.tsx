import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FillingOrderDto, RefillStage } from '@smartfleet/shared-types';
import { deriveRefillStage } from '@smartfleet/shared-utils';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { whenTranslate } from '../../i18n';
import {
  Button,
  colors,
  ConfirmSheet,
  EmptyState,
  FirstLoadState,
  Fab,
  FAB_CLEARANCE,
  Icon,
  layout,
  resolveStatus,
  Screen,
  SkeletonList,
  sizes,
  space,
  StatusChip,
  Text,
  useToast,
} from '../../ui';
import { cancelRefill, fetchMyRefills } from './shared/api';
import { rowTime } from './shared/format';
import { useShopNavigation } from './shared/navigation';
import { usePullRefresh } from './shared/refresh';
import { StaleNotice } from './shared/StaleNotice';

/** The owner may cancel only before pickup: while it waits for a driver or has one (UX_MOBILE S12b). */
const CANCELLABLE_STAGES: ReadonlySet<RefillStage> = new Set(['NEEDS_DRIVER', 'DRIVER_ASSIGNED']);

function stageOf(refill: FillingOrderDto): RefillStage {
  return refill.stage ?? deriveRefillStage({ status: refill.status, counts: refill.counts });
}

/**
 * S16 Refills (shop spec §X1; the Inc 3 spec's §4.1, built now): the shop's refills newest first, in
 * WhatsApp-like rows ("3 × 6 kg", the refill number, the time on the right, the stage chip), with
 * "+ New refill" floating. Inc 1 has no refill detail, so a refill that can still be cancelled has a
 * red-outline "Cancel" after its chip, which asks first. No money anywhere (ADR-16).
 */
export function RefillListScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const poll = useFocusedInterval(POLL_MS.ordersList);
  const refills = useQuery<FillingOrderDto[], ApiError>({
    queryKey: qk.refills.mine,
    queryFn: fetchMyRefills,
    refetchInterval: poll,
  });
  const pull = usePullRefresh(refills.refetch);
  const [cancelling, setCancelling] = useState<FillingOrderDto | null>(null);

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
          <RefillRow
            refill={item}
            onCancel={CANCELLABLE_STAGES.has(stageOf(item)) ? () => setCancelling(item) : undefined}
          />
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

      <ConfirmSheet
        visible={cancelling !== null}
        title={t('refill.cancel.title')}
        body={t('refill.cancel.body')}
        confirmLabel={t('refill.cancel.confirm')}
        confirmTone="danger"
        confirmLoadingLabel={t('refill.cancel.cancelling')}
        cancelLabel={t('refill.cancel.keep')}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancelRefill(cancelling.id, t('refill.cancel.reasonSent'));
            toast.show({ message: t('refill.cancel.done'), tone: 'success' });
            void queryClient.invalidateQueries({ queryKey: qk.refills.mine });
          } catch (thrown) {
            // Picked up meanwhile: the list shows the new stage, and the sheet says why.
            if (toApiError(thrown).code === 'REFILL_NOT_CANCELLABLE') void refills.refetch();
            throw thrown;
          }
        }}
      />
    </Screen>
  );
}

/**
 * A refill (the shop's one row, shop spec §3.4): the cylinder icon, "3 × 6 kg", the refill number (from
 * Inc 3), the time on the right, the stage chip under the grey line and, while it can still be
 * cancelled, a red-outline "Cancel" after the chip. Built like ListRow, but the row itself isn't one
 * focusable item, so screen readers can reach "Cancel".
 */
function RefillRow({ refill, onCancel }: { refill: FillingOrderDto; onCancel?: () => void }) {
  const { t } = useTranslation();
  const stage = stageOf(refill);
  const title = t('refill.list.row', { count: refill.requestedCount, size: refill.sizeLabel });
  const time = rowTime(refill.createdAt, whenTranslate);
  const spoken = [title, refill.shortCode, time, resolveStatus('refill', stage, t)?.label].filter(Boolean).join(', ');
  return (
    <View style={styles.row}>
      <View style={styles.leading}>
        <Icon name="cylinder" size={24} tone="secondary" />
      </View>
      <View style={styles.texts}>
        <View accessible accessibilityLabel={spoken} style={styles.textLines}>
          <View style={styles.titleLine}>
            <Text variant="bodyStrong" numberOfLines={2} style={styles.flex}>
              {title}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {time}
            </Text>
          </View>
          {refill.shortCode ? (
            <Text variant="caption" tone="secondary">
              {refill.shortCode}
            </Text>
          ) : null}
        </View>
        <View style={styles.below}>
          <StatusChip kind="refill" value={stage} style={styles.centred} />
          {onCancel ? (
            <Button
              label={t('refill.list.cancel')}
              onPress={onCancel}
              variant="dangerOutline"
              fullWidth={false}
              accessibilityHint={t('refill.list.cancelA11y')}
              style={styles.centred}
            />
          ) : null}
        </View>
      </View>
    </View>
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
  flex: { flex: 1 },
  row: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
  },
  leading: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  texts: { flex: 1, gap: space.xs },
  textLines: { gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  below: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  // The chip and a hugging Button each align themselves to the top: level them in the row.
  centred: { alignSelf: 'center' },
});
