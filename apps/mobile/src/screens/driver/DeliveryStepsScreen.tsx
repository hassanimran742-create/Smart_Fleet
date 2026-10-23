import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DELIVERY_FAILURE_REASONS, type DeliveryFailureReason } from '@smartfleet/shared-types';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ErrorBanner,
  Icon,
  QueryBoundary,
  SkeletonCard,
  StatusChip,
  Text,
  layout,
  space,
  type ConfirmInput,
  type ConfirmReason,
} from '../../ui';
import { DriverScreen, NoticeStrip, useCallOfficeAction, usePullToRefresh } from './components';
import {
  arriveAtStop,
  departStop,
  fetchTrip,
  lastKnownPosition,
  markDelivered,
  markNotDelivered,
  refreshTrip,
  withOrder,
  withStop,
  type LegacyScanEvent,
} from './tripApi';
import {
  cylindersToTakeBack,
  isOrderOpen,
  isTripOpen,
  nextOpenStop,
  orderOf,
  sizeLabelOf,
  stepTitle,
  stopStatusOf,
  stopStepState,
  stopsOf,
  type TripOrder,
  type TripStop,
  type TripView,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'DeliverySteps'>;

/**
 * Where a stop is (UX_MOBILE §5). The store stop: LOAD until "Done loading", then LOADED. A customer:
 * DRIVE until "I've arrived", VISIT (hand over, then take back) until "Finish visit", then
 * VISIT_DONE; SKIPPED when the order failed or was cancelled. CLOSED: the trip ended first.
 */
type Phase = 'LOAD' | 'LOADED' | 'DRIVE' | 'VISIT' | 'VISIT_DONE' | 'SKIPPED' | 'CLOSED';

function phaseOf(trip: TripView, stop: TripStop): Phase {
  const order = orderOf(trip, stop);
  const status = stopStatusOf(stop, order);
  if (status === 'FAILED' || status === 'CANCELLED') return 'SKIPPED';
  if (stop.stopType !== 'DELIVERY') {
    if (status === 'DONE') return 'LOADED';
    return isTripOpen(trip) ? 'LOAD' : 'CLOSED';
  }
  if (order?.status === 'FAILED' || order?.status === 'CANCELLED') return 'SKIPPED';
  if (status === 'DONE') return 'VISIT_DONE';
  if (!isTripOpen(trip)) return 'CLOSED';
  if (status === 'ARRIVED' || order?.status === 'DELIVERED') return 'VISIT';
  return 'DRIVE';
}

/** "2 × 11.8 kg" for each size, added up over the given orders. */
function sizeLines(orders: readonly (TripOrder | null)[], t: TFunction): { key: string; text: string }[] {
  const bySize = new Map<string, { size: string; count: number }>();
  for (const order of orders) {
    for (const line of order?.lines ?? []) {
      if (!line.fullCount) continue;
      const key = line.cylinderTypeId;
      const size = sizeLabelOf(line, (kg) => t('driver.size', { kg }));
      const entry = bySize.get(key) ?? { size, count: 0 };
      entry.count += line.fullCount;
      bySize.set(key, entry);
    }
  }
  return [...bySize.entries()].map(([key, entry]) => ({
    key,
    text: t('driver.steps.line', { count: entry.count, size: entry.size }),
  }));
}

type DeliveredNotice = 'marked' | 'already' | null;

/**
 * One step of a trip at a time (UX_MOBILE §5): load at the store, drive to the customer, hand over and
 * take back, then finish the visit. Scans open only from here, already set for the step. Each action
 * button shows that it is sending and can't be pressed twice; a refusal or a lost connection shows
 * inline with "Try again", never in a pop-up. "All delivered" asks first, and "Could not deliver"
 * takes a reason.
 */
export function DeliveryStepsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'DeliverySteps'>>();
  const tripId = params?.tripId ?? '';
  const stopId = params?.stopId ?? '';
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [failError, setFailError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<DeliveredNotice>(null);

  const trip = useQuery<TripView, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const pull = usePullToRefresh(trip.refetch);

  const data = trip.data;
  const stop = data ? stopsOf(data).find((candidate) => candidate.id === stopId) ?? null : null;
  const order = data && stop ? orderOf(data, stop) : null;
  const phase = data && stop ? phaseOf(data, stop) : null;

  const setTrip = (update: (old: TripView | undefined) => TripView | undefined) =>
    queryClient.setQueryData<TripView>(qk.trip(tripId), update);

  const arrive = useMutation<unknown, ApiError, void>({
    mutationFn: async () => {
      const result = await arriveAtStop(stopId);
      setTrip((old) => withStop(old, result.data));
      await refreshTrip(queryClient, tripId);
    },
  });
  const depart = useMutation<unknown, ApiError, void>({
    mutationFn: async () => {
      const result = await departStop(stopId);
      setTrip((old) => withStop(old, result.data));
      await refreshTrip(queryClient, tripId);
    },
  });
  /** "All delivered" sent again after it was marked: the server confirms, nothing changes. */
  const recheck = useMutation<boolean, ApiError, void>({
    mutationFn: async () => {
      if (!order) return false;
      const result = await markDelivered(order.id);
      return result.alreadyApplied;
    },
    onSuccess: (alreadyApplied) => setDelivered(alreadyApplied ? 'already' : 'marked'),
  });

  // A new step starts clean: the last step's error and result line belong to that step.
  const resetArrive = arrive.reset;
  const resetDepart = depart.reset;
  const resetRecheck = recheck.reset;
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    resetArrive();
    resetDepart();
    resetRecheck();
    if (phase !== 'VISIT') setDelivered(null);
  }, [phase, resetArrive, resetDepart, resetRecheck]);

  const confirmDelivered = async () => {
    if (!order) return;
    const result = await markDelivered(order.id);
    setTrip((old) => withOrder(old, { id: order.id, status: 'DELIVERED' }));
    setDelivered(result.alreadyApplied ? 'already' : 'marked');
    void refreshTrip(queryClient, tripId);
  };

  const confirmNotDelivered = async (input: ConfirmInput) => {
    if (!order) return;
    const reasonCode = DELIVERY_FAILURE_REASONS.find((code) => code === input.reasonCode);
    if (!reasonCode) return;
    setFailError(null);
    const position = await lastKnownPosition();
    try {
      await markNotDelivered(order.id, { reasonCode, note: input.note, ...(position ?? {}) });
    } catch (thrown) {
      const error = toApiError(thrown);
      setFailError(error.code);
      // The driver's words for this refusal (UX_MOBILE §5): the shop cancels an order that hasn't started.
      if (error.code === 'ORDER_NOT_STARTED_USE_CANCEL') throw t('driver.fail.notStarted');
      throw error;
    }
    // The step turns to "Marked could not deliver." at once; the refetch brings the stop's own status.
    setTrip((old) => withOrder(old, { id: order.id, status: 'FAILED' }));
    void refreshTrip(queryClient, tripId);
  };

  const scan = (eventType: LegacyScanEvent) =>
    navigation.navigate('Scan', { eventType, tripId, orderId: eventType === 'SCAN_OUT' ? undefined : order?.id });
  const backToTrip = () => navigation.navigate('ActiveTrip', { tripId });

  const next = data ? nextOpenStop(data) : null;
  const moveOn =
    data && next && next.id !== stopId ? (
      <Button
        label={t('driver.steps.next', { step: stepTitle(data, next, t) })}
        onPress={() => navigation.replace('DeliverySteps', { tripId, stopId: next.id })}
        testID="steps.next"
      />
    ) : (
      <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="steps.back" />
    );

  let footer: ReactNode;
  switch (phase) {
    case 'LOAD':
      footer = (
        <>
          {depart.error ? <ErrorBanner error={depart.error} onRetry={() => depart.mutate()} /> : null}
          <Button
            label={t('driver.steps.load.done')}
            loadingLabel={t('driver.steps.sending')}
            loading={depart.isPending}
            onPress={() => depart.mutate()}
            testID="steps.doneLoading"
          />
        </>
      );
      break;
    case 'DRIVE':
      footer = (
        <>
          {arrive.error ? <ErrorBanner error={arrive.error} onRetry={() => arrive.mutate()} /> : null}
          <Button
            label={t('driver.steps.drive.arrive')}
            loadingLabel={t('driver.steps.sending')}
            loading={arrive.isPending}
            icon="map"
            onPress={() => arrive.mutate()}
            testID="steps.arrive"
          />
        </>
      );
      break;
    case 'VISIT':
      footer = isOrderOpen(order) ? (
        <Button
          label={t('driver.steps.deliver.all')}
          icon="ok"
          onPress={() => setDeliverOpen(true)}
          testID="steps.allDelivered"
        />
      ) : (
        <>
          {depart.error ? <ErrorBanner error={depart.error} onRetry={() => depart.mutate()} /> : null}
          <Button
            label={t('driver.steps.finishVisit')}
            loadingLabel={t('driver.steps.sending')}
            loading={depart.isPending}
            onPress={() => depart.mutate()}
            testID="steps.finishVisit"
          />
        </>
      );
      break;
    case 'LOADED':
    case 'VISIT_DONE':
    case 'SKIPPED':
      footer = moveOn;
      break;
    case 'CLOSED':
      footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="steps.back" />;
      break;
    default:
      footer = data && !stop ? <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} /> : undefined;
  }

  const customerName = order?.client?.name ?? t('scan.theCustomer');
  const failReasons: ConfirmReason[] = DELIVERY_FAILURE_REASONS.map((code: DeliveryFailureReason) => ({
    code,
    label: t(`driver.fail.reason.${code}`),
  }));

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      <QueryBoundary query={trip} skeleton={<SkeletonCard lines={3} />}>
        {(view) => {
          const current = stopsOf(view).find((candidate) => candidate.id === stopId);
          if (!current) {
            return (
              <EmptyState icon="truck" title={t('driver.steps.missing.title')} body={t('driver.steps.missing.body')} />
            );
          }
          return (
            <View style={styles.stack}>
              {delivered ? (
                <NoticeStrip
                  tone="success"
                  icon="ok"
                  message={delivered === 'already' ? t('driver.steps.deliver.already') : t('driver.steps.deliver.marked')}
                  testID="steps.deliveredNotice"
                />
              ) : null}
              <StopBody
                trip={view}
                stop={current}
                phase={phaseOf(view, current)}
                onScan={scan}
                onNotDelivered={() => {
                  setFailError(null);
                  setFailOpen(true);
                }}
                recheck={{
                  run: () => recheck.mutate(),
                  pending: recheck.isPending,
                  error: recheck.error,
                }}
              />
            </View>
          );
        }}
      </QueryBoundary>

      <ConfirmSheet
        visible={deliverOpen}
        title={t('driver.steps.deliver.sheet.title')}
        body={t('driver.steps.deliver.sheet.body')}
        confirmLabel={t('driver.steps.deliver.sheet.confirm')}
        confirmLoadingLabel={t('driver.steps.sending')}
        cancelLabel={t('driver.steps.deliver.sheet.cancel')}
        onConfirm={confirmDelivered}
        onClose={() => setDeliverOpen(false)}
        testID="steps.deliverSheet"
      />

      <ConfirmSheet
        visible={failOpen}
        title={t('driver.fail.title', { name: customerName })}
        body={t('driver.fail.body')}
        reasons={failReasons}
        requireReason
        noteForOther
        noteLabel={t('driver.fail.note')}
        confirmLabel={t('driver.fail.confirm')}
        confirmLoadingLabel={t('driver.steps.sending')}
        confirmTone="danger"
        cancelLabel={t('driver.fail.cancel')}
        errorAction={failError === 'ORDER_NOT_STARTED_USE_CANCEL' ? callOffice : undefined}
        onConfirm={confirmNotDelivered}
        onClose={() => setFailOpen(false)}
        testID="steps.failSheet"
      />
    </DriverScreen>
  );
}

interface RecheckState {
  run: () => void;
  pending: boolean;
  error: ApiError | null;
}

function StopBody({
  trip,
  stop,
  phase,
  onScan,
  onNotDelivered,
  recheck,
}: {
  trip: TripView;
  stop: TripStop;
  phase: Phase;
  onScan: (eventType: LegacyScanEvent) => void;
  onNotDelivered: () => void;
  recheck: RecheckState;
}) {
  const { t } = useTranslation();
  const order = orderOf(trip, stop);
  const title = stepTitle(trip, stop, t);
  const chip = <StatusChip kind="step" value={stopStepState(trip, stop)} />;

  if (stop.stopType !== 'DELIVERY') {
    const openOrders = (trip.orders ?? []).filter((candidate) => isOrderOpen(candidate));
    const lines = sizeLines(openOrders, t);
    return (
      <View style={styles.stack}>
        <Card>
          <View style={styles.cardBody}>
            {chip}
            <Text variant="title">{title}</Text>
            {trip.originStore?.address ? <Text tone="secondary">{trip.originStore.address}</Text> : null}
            {lines.map((line) => (
              <View key={line.key} style={styles.line}>
                <Icon name="cylinder" size={24} tone="brand" />
                <Text variant="bodyStrong" tabular>
                  {line.text}
                </Text>
              </View>
            ))}
          </View>
        </Card>
        {phase === 'LOAD' ? (
          <Card>
            <View style={styles.cardBody}>
              <Text>{t('driver.steps.load.body')}</Text>
              <Button
                label={t('driver.steps.load.scan')}
                icon="scan"
                variant="secondary"
                onPress={() => onScan('SCAN_OUT')}
                testID="steps.scanLoad"
              />
            </View>
          </Card>
        ) : null}
        {phase === 'LOADED' ? <NoticeStrip tone="success" icon="ok" message={t('driver.steps.load.finished')} /> : null}
        {phase === 'SKIPPED' || phase === 'CLOSED' ? (
          <NoticeStrip tone="neutral" icon="info" message={t('driver.steps.closed')} />
        ) : null}
      </View>
    );
  }

  const location = stop.location;
  const giveLines = sizeLines([order], t);
  const takeBack = cylindersToTakeBack(order);
  const handedOver = order?.status === 'DELIVERED';

  return (
    <View style={styles.stack}>
      <Card>
        <View style={styles.cardBody}>
          {chip}
          <Text variant="title">{title}</Text>
          {order?.deliveryAddressLabel ? <Text tone="secondary">{order.deliveryAddressLabel}</Text> : null}
          {phase === 'DRIVE' ? (
            <>
              <Text>{t('driver.steps.drive.body')}</Text>
              {location ? (
                <Button
                  label={t('driver.steps.drive.map')}
                  icon="navigate"
                  variant="secondary"
                  onPress={() =>
                    void Linking.openURL(
                      `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`,
                    ).catch(() => undefined)
                  }
                  testID="steps.map"
                />
              ) : null}
            </>
          ) : null}
        </View>
      </Card>

      {phase === 'VISIT' || phase === 'DRIVE' ? (
        <Card>
          <View style={styles.cardBody}>
            <View style={styles.cardHeader}>
              <Text variant="heading" style={styles.fill}>
                {t('driver.steps.deliver.title')}
              </Text>
              {handedOver ? <StatusChip tone="success" icon="ok" label={t('driver.steps.deliver.done')} /> : null}
            </View>
            {giveLines.map((line) => (
              <View key={line.key} style={styles.line}>
                <Icon name="cylinder" size={24} tone={handedOver ? 'success' : 'brand'} />
                <Text variant="bodyStrong" tabular>
                  {line.text}
                </Text>
              </View>
            ))}
            {phase === 'VISIT' && !handedOver ? (
              <>
                <Text>{t('driver.steps.deliver.body')}</Text>
                <Button
                  label={t('driver.steps.deliver.scan')}
                  icon="scan"
                  variant="secondary"
                  onPress={() => onScan('DELIVERED')}
                  testID="steps.scanDeliver"
                />
              </>
            ) : null}
            {handedOver ? (
              <>
                {recheck.error ? <ErrorBanner error={recheck.error} onRetry={recheck.run} /> : null}
                <Button
                  label={t('driver.steps.deliver.all')}
                  icon="check"
                  variant="secondary"
                  loading={recheck.pending}
                  loadingLabel={t('driver.steps.sending')}
                  onPress={recheck.run}
                  testID="steps.allDeliveredAgain"
                />
              </>
            ) : null}
            {isOrderOpen(order) ? (
              <Button
                label={t('driver.fail.open')}
                icon="error"
                variant="ghost"
                onPress={onNotDelivered}
                testID="steps.notDelivered"
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {phase === 'VISIT' ? (
        <Card>
          <View style={styles.cardBody}>
            <Text variant="heading">{t('driver.steps.takeBack.title')}</Text>
            <Text variant="bodyStrong" tabular>
              {takeBack > 0
                ? t('driver.steps.takeBack.expected', { count: takeBack })
                : t('driver.steps.takeBack.none')}
            </Text>
            {handedOver ? (
              <>
                <Text>{t('driver.steps.takeBack.body')}</Text>
                <Button
                  label={t('driver.steps.takeBack.scan')}
                  icon="scan"
                  variant="secondary"
                  onPress={() => onScan('PICKED_UP_EMPTY')}
                  testID="steps.scanTakeBack"
                />
              </>
            ) : (
              <Text tone="secondary">{t('driver.steps.takeBack.afterHandover')}</Text>
            )}
          </View>
        </Card>
      ) : null}

      {phase === 'VISIT_DONE' ? <NoticeStrip tone="success" icon="ok" message={t('driver.steps.visitDone')} /> : null}
      {phase === 'SKIPPED' ? (
        <NoticeStrip
          tone="neutral"
          icon="info"
          message={order?.status === 'CANCELLED' ? t('driver.steps.cancelled') : t('driver.fail.done')}
        />
      ) : null}
      {phase === 'CLOSED' ? <NoticeStrip tone="neutral" icon="info" message={t('driver.steps.closed')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.cardGap },
  cardBody: { gap: space.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fill: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
