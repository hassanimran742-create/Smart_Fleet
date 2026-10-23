import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FillingOrderDto, RefillStage } from '@smartfleet/shared-types';
import { deriveRefillStage } from '@smartfleet/shared-utils';
import { useIdempotencyKey } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { formatWhenText } from '../../i18n';
import {
  Button,
  Card,
  colors,
  ConfirmSheet,
  EmptyState,
  ErrorBanner,
  Icon,
  layout,
  radius,
  Screen,
  SkeletonList,
  sizes,
  space,
  StatusChip,
  Stepper,
  Text,
  useToast,
} from '../../ui';
import {
  cancelRefill,
  fetchCylinderTypes,
  fetchMyRefills,
  fetchStations,
  requestRefill,
  type CylinderTypeRow,
  type FillingStationRow,
  type NewRefillBody,
} from './shared/api';
import { FilterChips } from './shared/FilterChips';
import { sizeLabelFromWeight, weightSortKey } from './shared/format';
import { CYLINDER_TYPES_STALE_MS, shopKeys } from './shared/keys';
import { Notice } from './shared/Notice';
import { usePullRefresh } from './shared/refresh';
import { StaleNotice } from './shared/StaleNotice';

/** The owner may cancel only before pickup: while it waits for a driver or has one (UX_MOBILE S12b). */
const CANCELLABLE_STAGES: ReadonlySet<RefillStage> = new Set(['NEEDS_DRIVER', 'DRIVER_ASSIGNED']);

function stageOf(refill: FillingOrderDto): RefillStage {
  return refill.stage ?? deriveRefillStage({ status: refill.status, counts: refill.counts });
}

/**
 * S12b Refill request, the minimal Inc 1 change: one size per request with the count capped at
 * `refill.maxCylinders`, a station, and the request list with each refill's stage. No do-it-yourself
 * mode, no price and no balance: refills carry no money (ADR-16). The owner can cancel while the refill
 * waits for a driver or has one, after a "Cancel this refill?" sheet.
 */
export function RequestFillingScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { config } = useAppConfig();
  const max = Math.max(1, config.refill.maxCylinders);

  const types = useQuery<CylinderTypeRow[], ApiError>({
    queryKey: shopKeys.cylinderTypes,
    queryFn: fetchCylinderTypes,
    staleTime: CYLINDER_TYPES_STALE_MS,
  });
  const stations = useQuery<FillingStationRow[], ApiError>({ queryKey: qk.stations, queryFn: fetchStations });
  const poll = useFocusedInterval(POLL_MS.ordersList);
  const refills = useQuery<FillingOrderDto[], ApiError>({
    queryKey: qk.refills.mine,
    queryFn: fetchMyRefills,
    refetchInterval: poll,
  });
  const pull = usePullRefresh(() => Promise.all([refills.refetch(), stations.refetch()]));

  const [sizeId, setSizeId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [stationId, setStationId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<FillingOrderDto | null>(null);

  const sizes = useMemo(
    () =>
      [...(types.data ?? [])]
        .sort((a, b) => weightSortKey(a.weightKg) - weightSortKey(b.weightKg))
        .map((type) => ({ value: type.id, label: sizeLabelFromWeight(type.weightKg, t) })),
    [types.data, t],
  );
  const stationList = useMemo(() => stations.data ?? [], [stations.data]);
  // With one station there is nothing to choose; a station that went away is unselected.
  useEffect(() => {
    if (stationList.length === 1) setStationId(stationList[0].id);
    else if (stationId && !stationList.some((s) => s.id === stationId)) setStationId(null);
  }, [stationList, stationId]);
  // The cap can come down in the settings while the screen is open.
  useEffect(() => {
    if (count > max) setCount(max);
  }, [count, max]);

  const idem = useIdempotencyKey([sizeId, count, stationId]);
  const request = useMutation<FillingOrderDto, ApiError, NewRefillBody>({
    mutationFn: (body) => requestRefill(body, idem.key),
    onSuccess: () => {
      toast.show({ message: t('refill.request.requested'), tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.refills.mine });
      setCount(1);
      idem.renew();
    },
  });

  const canRequest = !!sizeId && !!stationId && count >= 1 && count <= max && !request.isPending;
  const submit = () => {
    if (!canRequest || !sizeId || !stationId) return;
    request.mutate({ fillingStationId: stationId, cylinderTypeId: sizeId, requestedCount: count });
  };

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        <Button
          label={t('refill.request.submit')}
          onPress={submit}
          size="lg"
          loading={request.isPending}
          loadingLabel={t('refill.request.sending')}
          disabled={!canRequest}
        />
      }
    >
      <View style={styles.stack}>
        <Card>
          <Text variant="heading">{t('refill.request.title')}</Text>

          <Text variant="label" style={styles.label}>
            {t('refill.request.size')}
          </Text>
          {!types.data ? (
            types.isError ? (
              <ErrorBanner error={types.error} onRetry={() => void types.refetch()} />
            ) : (
              <SkeletonList rows={1} />
            )
          ) : sizes.length === 0 ? (
            <Notice tone="warning" text={t('refill.request.noSizes')} />
          ) : (
            <FilterChips<string>
              accessibilityLabel={t('refill.request.size')}
              options={sizes}
              value={sizeId ?? ''}
              onChange={setSizeId}
            />
          )}
          <Text variant="caption" tone="secondary" style={styles.helper}>
            {t('refill.request.sizeHelp')}
          </Text>

          <Stepper
            label={t('refill.request.count')}
            helper={t('refill.request.countHelp', { max })}
            value={count}
            min={1}
            max={max}
            onChange={setCount}
            style={styles.stepper}
          />

          <Text variant="label" style={styles.label}>
            {t('refill.request.station')}
          </Text>
          {!stations.data ? (
            stations.isError ? (
              <ErrorBanner error={stations.error} onRetry={() => void stations.refetch()} />
            ) : (
              <SkeletonList rows={1} />
            )
          ) : stationList.length === 0 ? (
            <Notice tone="warning" text={t('refill.request.noStation')} />
          ) : stationList.length === 1 ? (
            <Text>{stationList[0].name}</Text>
          ) : (
            <View accessibilityRole="radiogroup" style={styles.stations}>
              {stationList.map((station) => (
                <StationOption
                  key={station.id}
                  station={station}
                  selected={station.id === stationId}
                  onPress={() => setStationId(station.id)}
                />
              ))}
            </View>
          )}
        </Card>

        {request.error ? <ErrorBanner error={request.error} /> : null}

        <View style={styles.listHead}>
          <Text variant="heading">{t('refill.list.title')}</Text>
        </View>
        {refills.isError && refills.data ? (
          <StaleNotice updatedAt={refills.dataUpdatedAt} onRetry={() => void refills.refetch()} />
        ) : null}
        {!refills.data ? (
          refills.isError ? (
            <ErrorBanner error={refills.error} onRetry={() => void refills.refetch()} />
          ) : (
            <SkeletonList rows={2} />
          )
        ) : refills.data.length === 0 ? (
          <EmptyState icon="cylinder" title={t('refill.list.empty')} />
        ) : (
          <Card padding={0}>
            {refills.data.map((refill, index) => (
              <RefillRow
                key={refill.id}
                refill={refill}
                first={index === 0}
                onCancel={CANCELLABLE_STAGES.has(stageOf(refill)) ? () => setCancelling(refill) : undefined}
              />
            ))}
          </Card>
        )}
      </View>

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

/** One station to choose (radio row, 56 dp). */
function StationOption({ station, selected, onPress }: { station: FillingStationRow; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={station.name}
      android_ripple={{ color: colors.ripple }}
      style={[styles.station, selected ? styles.stationSelected : null]}
    >
      <Icon name={selected ? 'radioOn' : 'radioOff'} size={24} tone={selected ? 'brand' : 'secondary'} />
      <View style={styles.flex}>
        <Text>{station.name}</Text>
        {station.address ? (
          <Text variant="caption" tone="secondary">
            {station.address}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A refill: "2 × 11.8 kg · Lahore Filling Station", when it was asked for, its stage and maybe Cancel. */
function RefillRow({ refill, first, onCancel }: { refill: FillingOrderDto; first: boolean; onCancel?: () => void }) {
  const { t } = useTranslation();
  const title = refill.fillingStation?.name
    ? t('refill.list.row', { count: refill.requestedCount, size: refill.sizeLabel, station: refill.fillingStation.name })
    : t('refill.list.rowNoStation', { count: refill.requestedCount, size: refill.sizeLabel });
  return (
    <View style={[styles.refill, first ? null : styles.refillDivider]}>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="secondary">
          {t('refill.list.requestedAt', { when: formatWhenText(refill.createdAt) })}
        </Text>
        <View style={styles.chip}>
          <StatusChip kind="refill" value={stageOf(refill)} />
        </View>
      </View>
      {onCancel ? (
        <Button
          label={t('refill.list.cancel')}
          onPress={onCancel}
          variant="ghost"
          fullWidth={false}
          accessibilityHint={t('refill.list.cancelA11y')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  label: { marginTop: space.lg, marginBottom: space.xs },
  helper: { marginTop: space.xs },
  stepper: { marginTop: space.lg },
  stations: { gap: space.xs },
  station: {
    minHeight: sizes.menuRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  stationSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  listHead: { marginTop: space.sm },
  refill: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  refillDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  chip: { marginTop: space.xs },
});
