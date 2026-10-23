import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DELIVERY_FAILURE_REASONS, type DeliveryFailureReason } from '@smartfleet/shared-types';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useVanLoad, vanTotal } from '../../components/VehicleLoad';
import { telUrl } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  ActionLine,
  Button,
  Card,
  ConfirmSheet,
  CountBar,
  EmptyState,
  QueryBoundary,
  space,
  type ConfirmInput,
  type ConfirmReason,
} from '../../ui';
import { ScanPanel, SizeLines, type ScanOutcome, type ScanRead, type ScanStep, type SizeLine } from '../../ui/scan';
import {
  DriverScreen,
  NextStepButton,
  NoticeStrip,
  StepFrame,
  StepSkeleton,
  useCallOfficeAction,
  usePullToRefresh,
} from './components';
import { FinishTripSheet } from './FinishTripSheet';
import { addToTally, tallyKey, useScanTally, type TallyStep } from './scanTally';
import {
  arriveAtStop,
  departStop,
  fetchTrip,
  lastKnownPosition,
  markDelivered,
  markNotDelivered,
  refreshAfterScan,
  refreshTrip,
  scanCylinder,
  withOrder,
  withStop,
  type LegacyScanEvent,
} from './tripApi';
import {
  customerNameOf,
  cylindersToGive,
  cylindersToTakeBack,
  findStop,
  isTripOpen,
  orderOf,
  ordersOfTheLoad,
  ordersToLoad,
  sizeLinesOf,
  stepPosition,
  stopStatusOf,
  storeNameOf,
  type TripOrder,
  type TripStop,
  type TripView,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'DeliverySteps'>;

/**
 * Where a step is (driver spec D7–D9). The store: LOAD until "Done loading", then LOADED. A customer:
 * DRIVE until "I've arrived", DELIVER (scan what you give) until "All delivered", TAKE_BACK (scan what
 * comes back) until "Finish visit", then VISIT_DONE; NOT_DELIVERED or CANCELLED when the order failed
 * or was cancelled. CLOSED: the trip ended before this step did.
 */
type Phase =
  | 'LOAD'
  | 'LOADED'
  | 'DRIVE'
  | 'DELIVER'
  | 'TAKE_BACK'
  | 'VISIT_DONE'
  | 'NOT_DELIVERED'
  | 'CANCELLED'
  | 'CLOSED';

function phaseOf(trip: TripView, stop: TripStop): Phase {
  const order = orderOf(trip, stop);
  const status = stopStatusOf(stop, order);
  if (stop.stopType !== 'DELIVERY') {
    if (status === 'DONE') return 'LOADED';
    return isTripOpen(trip) && (status === 'PENDING' || status === 'ARRIVED') ? 'LOAD' : 'CLOSED';
  }
  if (status === 'DONE') return 'VISIT_DONE';
  // The office stopped the trip before anything happened on it: nothing to bring back.
  if (trip.status === 'ABORTED') return 'CLOSED';
  if (order?.status === 'FAILED' || status === 'FAILED') return 'NOT_DELIVERED';
  if (order?.status === 'CANCELLED' || status === 'CANCELLED') return 'CANCELLED';
  if (!isTripOpen(trip)) return 'CLOSED';
  if (order?.status === 'DELIVERED') return 'TAKE_BACK';
  if (status === 'ARRIVED') return 'DELIVER';
  return 'DRIVE';
}

/** The camera of each scanning phase: the panel's step, the tally's step and the legacy event. */
const SCAN_OF: Partial<Record<Phase, { step: ScanStep & TallyStep; event: LegacyScanEvent }>> = {
  LOAD: { step: 'LOAD', event: 'SCAN_OUT' },
  DELIVER: { step: 'HANDOVER', event: 'DELIVERED' },
  TAKE_BACK: { step: 'TAKE_BACK', event: 'PICKED_UP_EMPTY' },
};

/** The sheets of this screen; one at a time. */
type Sheet = 'early' | 'delivered' | 'notDelivered' | 'finish';

/**
 * One step of the trip (driver spec §1.2, D7–D11), with its camera on the screen: no separate scan
 * screen. Load at the store; on the way to a customer (Maps, Call, "I've arrived"); at the customer,
 * deliver then take back; then the step's state card and the next step's button. "Done loading" and
 * "All delivered" stay pressable: outlined until the screen's count is reached, and an early press asks
 * "Only 1 of 3 scanned. Continue?" (DECIDED; the Inc 1 server allows it). "All delivered" and "Could
 * not deliver" ask first (rule 7). Every footer failure is one line above its button.
 */
export function DeliveryStepsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'DeliverySteps'>>();
  const tripId = params?.tripId ?? '';
  const stopId = params?.stopId ?? '';
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // The count an early sheet was opened with: its words stay put while it closes on the next phase.
  const [asked, setAsked] = useState<{ done: number; total: number; reached: boolean }>({
    done: 0,
    total: 0,
    reached: true,
  });
  const [failCode, setFailCode] = useState<string | null>(null);

  const trip = useQuery<TripView, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const van = useVanLoad();
  const pull = usePullToRefresh(trip.refetch, van.refetch);

  const data = trip.data;
  const stop = data ? findStop(data, stopId) : null;
  const order = data && stop ? orderOf(data, stop) : null;
  const phase = data && stop ? phaseOf(data, stop) : null;
  const scan = phase ? (SCAN_OF[phase] ?? null) : null;
  const tally = useScanTally(scan ? tallyKey(tripId, stopId, scan.step) : null);
  const count = vanTotal(van.data);
  // While the van's load is unknown, unloading stays offered as the next step.
  const vanHasCylinders = count === null || count > 0;

  // "Step 2 of 3": where this step is in the trip.
  const position = data && stop ? stepPosition(data, stop.id) : null;
  const headerTitle = position ? t('common.step', position) : '';
  useLayoutEffect(() => {
    navigation.setOptions({ title: headerTitle });
  }, [navigation, headerTitle]);

  const setTrip = (update: (old: TripView | undefined) => TripView | undefined) =>
    queryClient.setQueryData<TripView>(qk.trip(tripId), update);

  const arrive = useMutation<unknown, ApiError, void>({
    mutationFn: async () => {
      const result = await arriveAtStop(stopId);
      setTrip((old) => withStop(old, result.data));
      await refreshTrip(queryClient, tripId);
    },
  });
  /** "Done loading" at the store, "Finish visit" at a customer. */
  const leaveStop = async () => {
    const result = await departStop(stopId);
    setTrip((old) => withStop(old, result.data));
    await refreshTrip(queryClient, tripId);
  };
  const depart = useMutation<unknown, ApiError, void>({ mutationFn: leaveStop });

  // A new phase starts clean: the last phase's error line belongs to that phase.
  const resetArrive = arrive.reset;
  const resetDepart = depart.reset;
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    resetArrive();
    resetDepart();
  }, [phase, resetArrive, resetDepart]);

  /** The cylinders this phase scans: what to load, what to give, what is expected back. */
  let total = 0;
  if (data && phase === 'LOAD') total = ordersToLoad(data).reduce((sum, item) => sum + cylindersToGive(item), 0);
  else if (phase === 'DELIVER') total = cylindersToGive(order);
  else if (phase === 'TAKE_BACK') total = cylindersToTakeBack(order);
  const reached = tally >= total;

  const orderId = order?.id;
  const onScan = useCallback(
    async (read: ScanRead): Promise<ScanOutcome> => {
      if (!scan) throw new Error('This step has no scan');
      const result = await scanCylinder({
        qrCode: read.code,
        eventType: scan.event,
        tripId,
        orderId: scan.event === 'SCAN_OUT' ? undefined : orderId,
        lat: read.lat,
        lng: read.lng,
      });
      addToTally(tallyKey(tripId, stopId, scan.step), read.code);
      refreshAfterScan(queryClient, tripId);
      return result.alreadyRecorded ? 'already' : 'recorded';
    },
    [scan, tripId, stopId, orderId, queryClient],
  );

  const confirmDelivered = async () => {
    if (!order) return;
    // A repeat (`X-Already-Applied`) does the same: the take-back phase shows, with no extra notice.
    await markDelivered(order.id);
    setTrip((old) => withOrder(old, { id: order.id, status: 'DELIVERED' }));
    void refreshTrip(queryClient, tripId);
  };

  const confirmNotDelivered = async (input: ConfirmInput) => {
    if (!order) return;
    const reasonCode = DELIVERY_FAILURE_REASONS.find((code) => code === input.reasonCode);
    if (!reasonCode) return;
    setFailCode(null);
    const position = await lastKnownPosition();
    try {
      await markNotDelivered(order.id, { reasonCode, note: input.note, ...(position ?? {}) });
    } catch (thrown) {
      const error = toApiError(thrown);
      setFailCode(error.code);
      // The driver's words for this refusal: the shop cancels an order that hasn't started.
      if (error.code === 'ORDER_NOT_STARTED_USE_CANCEL') throw t('driver.fail.notStarted');
      throw error;
    }
    // The step turns to "Not delivered" at once; the refetch brings the stop's own status.
    setTrip((old) => withOrder(old, { id: order.id, status: 'FAILED' }));
    void refreshTrip(queryClient, tripId);
  };

  const backToTrip = () => navigation.navigate('ActiveTrip', { tripId });
  const notFound = data === undefined && trip.isError && toApiError(trip.error).code === 'NOT_FOUND';

  let footer: ReactNode;
  if (notFound) {
    footer = (
      <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="steps.backHome" />
    );
  } else if (data && !stop) {
    footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="steps.back" />;
  } else if (data) {
    switch (phase) {
      case 'LOAD':
        footer = (
          <>
            <ActionLine error={depart.error} />
            <Button
              label={t('driver.steps.load.done')}
              loadingLabel={t('driver.steps.sending')}
              loading={depart.isPending}
              variant={reached ? 'primary' : 'secondary'}
              onPress={() => {
                if (reached) {
                  depart.mutate();
                  return;
                }
                setAsked({ done: tally, total, reached });
                setSheet('early');
              }}
              testID="steps.doneLoading"
            />
          </>
        );
        break;
      case 'DRIVE':
        footer = (
          <>
            <ActionLine error={arrive.error} />
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
      case 'DELIVER':
        footer = (
          <Button
            label={t('driver.steps.deliver.all')}
            icon="ok"
            variant={reached ? 'primary' : 'secondary'}
            onPress={() => {
              setAsked({ done: tally, total, reached });
              setSheet('delivered');
            }}
            testID="steps.allDelivered"
          />
        );
        break;
      case 'TAKE_BACK':
        footer = (
          <>
            <ActionLine error={depart.error} />
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
      case 'CLOSED':
        footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="steps.back" />;
        break;
      default:
        footer = (
          <NextStepButton
            trip={data}
            vanHasCylinders={vanHasCylinders}
            from="step"
            onFinish={() => setSheet('finish')}
          />
        );
    }
  }

  const customerName = customerNameOf(order, t);
  const failReasons: ConfirmReason[] = DELIVERY_FAILURE_REASONS.map((code: DeliveryFailureReason) => ({
    code,
    label: t(`driver.fail.reason.${code}`),
  }));

  return (
    <>
      {/* Keyed by phase: a new phase starts at the top, with its strip and title in view. */}
      <DriverScreen key={phase ?? 'none'} refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
        {notFound ? (
          <EmptyState icon="truck" title={t('errors.NOT_FOUND')} />
        ) : (
          <QueryBoundary query={trip} skeleton={<StepSkeleton />} errorAction={callOffice} offlineAction={callOffice}>
            {(view) => {
              const current = findStop(view, stopId);
              if (!current) return <EmptyState icon="truck" title={t('driver.steps.missing.title')} />;
              return (
                <StepBody
                  trip={view}
                  stop={current}
                  phase={phaseOf(view, current)}
                  tally={tally}
                  total={total}
                  onScan={onScan}
                  cameraActive={focused && sheet === null}
                  onNotDelivered={() => {
                    setFailCode(null);
                    setSheet('notDelivered');
                  }}
                />
              );
            }}
          </QueryBoundary>
        )}
      </DriverScreen>

      <ConfirmSheet
        visible={sheet === 'early'}
        title={t('driver.steps.early.title', { done: asked.done, total: asked.total })}
        confirmLabel={t('driver.steps.load.done')}
        confirmLoadingLabel={t('driver.steps.sending')}
        cancelLabel={t('driver.steps.early.keep')}
        onConfirm={leaveStop}
        onClose={() => setSheet(null)}
        testID="steps.earlySheet"
      />

      <ConfirmSheet
        visible={sheet === 'delivered'}
        title={
          asked.reached
            ? t('driver.steps.deliver.sheet.title')
            : t('driver.steps.early.title', { done: asked.done, total: asked.total })
        }
        body={t('driver.steps.deliver.sheet.body')}
        confirmLabel={t('driver.steps.deliver.sheet.confirm')}
        confirmLoadingLabel={t('driver.steps.sending')}
        cancelLabel={asked.reached ? t('driver.steps.deliver.sheet.cancel') : t('driver.steps.early.keep')}
        onConfirm={confirmDelivered}
        onClose={() => setSheet(null)}
        testID="steps.deliverSheet"
      />

      <ConfirmSheet
        visible={sheet === 'notDelivered'}
        title={t('driver.fail.title', { name: customerName })}
        body={t('driver.steps.bringBack')}
        reasons={failReasons}
        requireReason
        noteForOther
        noteLabel={t('driver.fail.note')}
        confirmLabel={t('driver.fail.confirm')}
        confirmLoadingLabel={t('driver.steps.sending')}
        confirmTone="danger"
        cancelLabel={t('driver.fail.cancel')}
        errorAction={failCode === 'ORDER_NOT_STARTED_USE_CANCEL' ? callOffice : undefined}
        onConfirm={confirmNotDelivered}
        onClose={() => setSheet(null)}
        testID="steps.failSheet"
      />

      <FinishTripSheet
        visible={sheet === 'finish'}
        onClose={() => setSheet(null)}
        tripId={tripId}
        store={storeNameOf(data, t)}
      />
    </>
  );
}

interface StepBodyProps {
  trip: TripView;
  stop: TripStop;
  phase: Phase;
  /** The Inc 1 tally of this phase's scans (driver spec §1.5). */
  tally: number;
  /** What this phase scans: to load, to give, or expected back. */
  total: number;
  onScan: (read: ScanRead) => Promise<ScanOutcome>;
  /** False while a sheet is open or the screen is hidden: the camera stops. */
  cameraActive: boolean;
  onNotDelivered: () => void;
}

/** The step's content in StepFrame's fixed order, by phase. */
function StepBody({ trip, stop, phase, tally, total, onScan, cameraActive, onNotDelivered }: StepBodyProps) {
  const { t } = useTranslation();
  const scan = SCAN_OF[phase];
  const camera = scan ? (
    <ScanPanel
      key={scan.step}
      step={scan.step}
      onScan={onScan}
      active={cameraActive}
      complete={total > 0 ? tally >= total : undefined}
      testID="steps.scan"
    />
  ) : null;

  if (stop.stopType !== 'DELIVERY') {
    const title = t('driver.trip.loadAt', { store: storeNameOf(trip, t) });
    // While loading: what is still to load; once loaded: what was loaded.
    const loaded = phase === 'LOAD' ? ordersToLoad(trip) : ordersOfTheLoad(trip);
    const lines = <SizeLines lines={sizeLinesOf(loaded, t)} testID="steps.sizes" />;
    if (phase === 'LOAD') {
      return (
        <StepFrame
          title={title}
          count={<CountBar count={tally} total={total} verb={t('scan.verb.SCANNED')} testID="steps.count" />}
          scan={camera}
          details={lines}
          testID="steps.load"
        />
      );
    }
    return (
      <StepFrame
        title={title}
        count={
          phase === 'LOADED' ? (
            <NoticeStrip tone="success" icon="ok" message={t('driver.steps.load.finished')} testID="steps.state" />
          ) : (
            <NoticeStrip tone="neutral" message={t('driver.steps.closed')} testID="steps.state" />
          )
        }
        details={lines}
        testID="steps.load"
      />
    );
  }

  return (
    <CustomerStep
      trip={trip}
      stop={stop}
      phase={phase}
      tally={tally}
      total={total}
      camera={camera}
      onNotDelivered={onNotDelivered}
    />
  );
}

function CustomerStep({
  trip,
  stop,
  phase,
  tally,
  total,
  camera,
  onNotDelivered,
}: Omit<StepBodyProps, 'onScan' | 'cameraActive'> & { camera: ReactNode }) {
  const { t } = useTranslation();
  const order = orderOf(trip, stop);
  const name = customerNameOf(order, t);
  const deliverTitle = t('driver.trip.deliverTo', { name });
  const giveLines: SizeLine[] = sizeLinesOf([order], t);
  const takeBack = cylindersToTakeBack(order);
  const notDelivered = (
    <Button
      label={t('driver.fail.open')}
      icon="error"
      variant="secondary"
      onPress={onNotDelivered}
      testID="steps.notDelivered"
    />
  );

  switch (phase) {
    case 'DRIVE': {
      const takeBackLine: SizeLine = {
        key: 'takeBack',
        text: t('driver.steps.takeBack.count', { count: takeBack }),
        secondary: true,
      };
      const lines = takeBack > 0 ? [...giveLines, takeBackLine] : giveLines;
      return (
        <StepFrame
          title={deliverTitle}
          subtitle={order?.deliveryAddressLabel ?? undefined}
          details={
            <>
              <OnTheWayButtons stop={stop} order={order} />
              {lines.length > 0 ? (
                <Card>
                  <SizeLines lines={lines} testID="steps.sizes" />
                </Card>
              ) : null}
            </>
          }
          rare={notDelivered}
          testID="steps.drive"
        />
      );
    }
    case 'DELIVER':
      return (
        <StepFrame
          title={deliverTitle}
          count={<CountBar count={tally} total={total} verb={t('scan.verb.SCANNED')} testID="steps.count" />}
          scan={camera}
          details={<SizeLines lines={giveLines} testID="steps.sizes" />}
          rare={
            <>
              <CallCustomerButton order={order} />
              {notDelivered}
            </>
          }
          testID="steps.deliver"
        />
      );
    case 'TAKE_BACK':
      return (
        <StepFrame
          notice={
            <NoticeStrip tone="success" icon="ok" message={t('driver.steps.deliver.marked')} testID="steps.delivered" />
          }
          title={t('driver.steps.takeBack.title', { name })}
          count={
            <CountBar mode="soft" count={tally} total={total} verb={t('scan.verb.TAKE_BACK')} testID="steps.count" />
          }
          scan={camera}
          rare={<CallCustomerButton order={order} />}
          testID="steps.takeBack"
        />
      );
    case 'VISIT_DONE':
      return (
        <StepFrame
          title={deliverTitle}
          count={<NoticeStrip tone="success" icon="ok" message={t('driver.steps.visitDone')} testID="steps.state" />}
          details={<SizeLines lines={giveLines} testID="steps.sizes" />}
          testID="steps.visitDone"
        />
      );
    case 'NOT_DELIVERED':
      return (
        <StepFrame
          title={deliverTitle}
          count={
            <NoticeStrip
              tone="danger"
              icon="error"
              message={t('stages.step.NOT_DELIVERED')}
              detail={t('driver.steps.bringBack')}
              testID="steps.state"
            />
          }
          details={<SizeLines lines={giveLines} testID="steps.sizes" />}
          testID="steps.notDeliveredState"
        />
      );
    case 'CANCELLED':
      return (
        <StepFrame
          title={deliverTitle}
          count={
            <NoticeStrip
              tone="neutral"
              message={t('stages.step.CANCELLED')}
              detail={t('driver.steps.bringBack')}
              testID="steps.state"
            />
          }
          details={<SizeLines lines={giveLines} testID="steps.sizes" />}
          testID="steps.cancelled"
        />
      );
    default:
      return (
        <StepFrame
          title={deliverTitle}
          count={<NoticeStrip tone="neutral" message={t('driver.steps.closed')} testID="steps.state" />}
          testID="steps.closed"
        />
      );
  }
}

/** On the way (D8): "Maps" when the stop has a pin, "Call {{name}}" when the trip has the phone. */
function OnTheWayButtons({ stop, order }: { stop: TripStop; order: TripOrder | null }) {
  const { t } = useTranslation();
  const location = stop.location;
  const name = customerNameOf(order, t);
  const phone = order?.client?.phone ?? null;
  const mapsLabel = t('driver.steps.drive.map');
  const callLabel = t('driver.steps.callCustomer', { name });
  if (!location && !phone) return null;
  // Side by side only when both labels have 12 characters or fewer (rulebook §7.2); else stacked.
  const sideBySide = mapsLabel.length <= 12 && callLabel.length <= 12;
  return (
    <View style={sideBySide ? styles.pair : styles.stacked} testID="steps.onTheWay">
      {location ? (
        <Button
          label={mapsLabel}
          accessibilityLabel={t('driver.steps.drive.mapA11y')}
          icon="navigate"
          variant="secondary"
          onPress={() =>
            void Linking.openURL(
              `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`,
            ).catch(() => undefined)
          }
          style={sideBySide ? styles.half : undefined}
          testID="steps.map"
        />
      ) : null}
      {phone ? (
        <Button
          label={callLabel}
          icon="call"
          variant="secondary"
          onPress={() => void Linking.openURL(telUrl(phone)).catch(() => undefined)}
          style={sideBySide ? styles.half : undefined}
          testID="steps.callCustomer"
        />
      ) : null}
    </View>
  );
}

/** "Call {{name}}" at the customer (DECIDED), when the trip has the customer's phone. */
function CallCustomerButton({ order }: { order: TripOrder | null }) {
  const { t } = useTranslation();
  const phone = order?.client?.phone ?? null;
  if (!phone) return null;
  return (
    <Button
      label={t('driver.steps.callCustomer', { name: customerNameOf(order, t) })}
      icon="call"
      variant="secondary"
      onPress={() => void Linking.openURL(telUrl(phone)).catch(() => undefined)}
      testID="steps.callCustomer"
    />
  );
}

// Two different actions stay 16 dp apart (rulebook §9.1).
const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: space.lg },
  stacked: { gap: space.lg },
  half: { flex: 1 },
});
