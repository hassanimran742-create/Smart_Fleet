import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FillingOrderDto } from '@smartfleet/shared-types';
import { isApiError, toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { telUrl } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { formatWhenText } from '../../i18n';
import {
  Button,
  Card,
  ConfirmSheet,
  CountBar,
  EmptyState,
  Icon,
  QueryBoundary,
  Screen,
  SkeletonCard,
  space,
  StatusChip,
  Text,
  Timeline,
  useToast,
  type TimelineItem,
} from '../../ui';
import { detailCount, refillSteps, stageOf, type RefillStep } from './refill/refillModel';
import { cancelRefill, fetchRefill } from './shared/api';
import { shopKeys } from './shared/keys';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { usePullRefresh, useRefetchOnReturn } from './shared/refresh';

/** The refill is finished: nothing moves any more, so it isn't polled. */
const FINISHED = new Set(['DONE', 'CANCELLED']);

/**
 * [Inc 3] S18 Refill detail (UX_MOBILE §8.1; Inc 2/3 spec §4.3): follow one refill, and cancel it
 * before pickup. The stage chip, "2 × 11.8 kg" and the station; one big count for the step that
 * matters now; the timeline without counts in its labels (a finished step's count is its detail); the
 * driver with "Call" once assigned; and "Cancel refill" as a red outline in the content while the server
 * allows it. No footer and no money (ADR-16).
 */
export function RefillDetailScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'RefillDetail'>();
  const refillId = params.refillId;
  const poll = useFocusedInterval(POLL_MS.ordersList);
  const refill = useQuery<FillingOrderDto, ApiError>({
    queryKey: shopKeys.refill(refillId),
    queryFn: () => fetchRefill(refillId),
    refetchInterval: (query) => (query.state.data && FINISHED.has(stageOf(query.state.data)) ? false : poll),
  });
  const pull = usePullRefresh(refill.refetch);
  useRefetchOnReturn(refill.refetch);
  const [cancelOpen, setCancelOpen] = useState(false);

  const shortCode = refill.data?.shortCode ?? null;
  useEffect(() => {
    navigation.setOptions({
      title: shortCode ? t('refill.detail.title', { refillNo: shortCode }) : t('refill.detail.titleLoading'),
    });
  }, [navigation, shortCode, t]);

  const notFound = !refill.data && isApiError(refill.error) && refill.error.status === 404;

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      {notFound ? (
        <EmptyState icon="cylinder" title={t('refill.detail.notFound')} />
      ) : (
        <QueryBoundary query={refill} skeleton={<SkeletonCard lines={4} />}>
          {(data) => <RefillBody refill={data} onCancel={() => setCancelOpen(true)} />}
        </QueryBoundary>
      )}
      {refill.data ? (
        <CancelRefillSheet
          refill={refill.data}
          visible={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onRefetch={() => void refill.refetch()}
        />
      ) : null}
    </Screen>
  );
}

function RefillBody({ refill, onCancel }: { refill: FillingOrderDto; onCancel: () => void }) {
  const { t } = useTranslation();
  const stage = stageOf(refill);
  const count = detailCount(stage, refill.counts);
  const driver = refill.assignedDriver;
  const canCancel = refill.allowedActions?.includes('CANCEL') ?? false;

  return (
    <View style={styles.stack}>
      <View style={styles.status}>
        <StatusChip kind="refill" value={stage} />
        <Text variant="title">{t('refill.list.row', { count: refill.requestedCount, size: refill.sizeLabel })}</Text>
        {refill.fillingStation ? <Text tone="secondary">{refill.fillingStation.name}</Text> : null}
      </View>

      {count && count.total > 0 ? (
        <CountBar
          count={count.done}
          total={count.total}
          verb={t(`refill.detail.count.${count.verb}`)}
          // A step done reads "2 of 2 picked up" (REF-027), in the green complete card.
          completeLabel={t('common.count.progressA11y', {
            done: count.done,
            total: count.total,
            verb: t(`refill.detail.count.${count.verb}`),
          })}
          testID="refill.count"
        />
      ) : null}

      <Card>
        <Timeline items={refillSteps(refill).map((step) => timelineItem(step, t))} />
      </Card>

      {driver ? (
        <Card>
          <View style={styles.driver}>
            <Icon name="truck" size={24} tone="brand" />
            <Text style={styles.flex}>
              {refill.assignedVehicle
                ? t('refill.detail.driverLine', { name: driver.name, plate: refill.assignedVehicle.plateNo })
                : driver.name}
            </Text>
            {driver.phone ? (
              <Button
                label={t('refill.detail.call')}
                accessibilityLabel={t('refill.detail.callA11y', { name: driver.name })}
                icon="call"
                variant="secondary"
                fullWidth={false}
                onPress={() => void Linking.openURL(telUrl(driver.phone)).catch(() => undefined)}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {canCancel ? (
        <Button label={t('refill.detail.cancel')} onPress={onCancel} variant="dangerOutline" style={styles.cancel} />
      ) : null}
    </View>
  );
}

const STEP_LABELS = {
  requested: 'refill.detail.requested',
  assigned: 'refill.detail.assigned',
  pickedUp: 'refill.detail.pickedUp',
  filled: 'refill.detail.filledStep',
  back: 'refill.detail.backAtStore',
  done: 'refill.detail.done',
  cancelled: 'stages.refill.CANCELLED',
} as const;

function timelineItem(step: RefillStep, t: TFunction): TimelineItem {
  const label = step.doneShort
    ? t('refill.detail.doneShort', { filled: step.doneShort.filled, picked: step.doneShort.picked })
    : t(STEP_LABELS[step.key]);
  const detail = step.doneShort
    ? t('refill.detail.doneShortNote')
    : step.count
      ? t('refill.detail.stepCount', { done: step.count.done, total: step.count.total })
      : undefined;
  return {
    key: step.key,
    label,
    time: step.at ? formatWhenText(step.at) : undefined,
    detail,
    state: step.state,
  };
}

/**
 * "Cancel this refill?" (rule 7; shop spec §Y): danger confirm "Cancel refill", the outlined "Keep
 * refill". `REFILL_NOT_CANCELLABLE` (picked up meanwhile) shows its words in the sheet, and the refill
 * refreshes. The fixed `reasonSent` is the cancel's reason.
 */
function CancelRefillSheet({
  refill,
  visible,
  onClose,
  onRefetch,
}: {
  refill: FillingOrderDto;
  visible: boolean;
  onClose: () => void;
  onRefetch: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  return (
    <ConfirmSheet
      visible={visible}
      title={t('refill.cancel.title')}
      body={t('refill.cancel.body')}
      confirmLabel={t('refill.cancel.confirm')}
      confirmTone="danger"
      confirmLoadingLabel={t('refill.cancel.cancelling')}
      cancelLabel={t('refill.cancel.keep')}
      onClose={onClose}
      onConfirm={async () => {
        try {
          const result = await cancelRefill(refill.id, t('refill.cancel.reasonSent'));
          queryClient.setQueryData(shopKeys.refill(refill.id), result);
          void queryClient.invalidateQueries({ queryKey: qk.refills.mine });
          toast.show({ message: t('refill.cancel.done'), tone: 'success' });
        } catch (thrown) {
          if (toApiError(thrown).code === 'REFILL_NOT_CANCELLABLE') onRefetch();
          throw thrown;
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  status: { gap: space.xs, alignItems: 'flex-start' },
  driver: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // 24 dp below the last card (the stack's 16 plus 8), as on Order detail.
  cancel: { marginTop: space.sm },
});
