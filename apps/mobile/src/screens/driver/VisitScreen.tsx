import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DELIVERY_FAILURE_REASONS,
  TAKE_BACK_SHORT_REASONS,
  type DeliveryFailureReason,
  type ReturnState,
  type TakeBackShortReason,
} from '@smartfleet/shared-types';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { telUrl, useAppConfig } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  ActionLine,
  Button,
  Card,
  ConfirmSheet,
  CountBar,
  EmptyState,
  Icon,
  QueryBoundary,
  SegmentedControl,
  Text,
  colors,
  ltr,
  radius,
  sizes,
  space,
  type ConfirmInput,
  type ConfirmReason,
  type SegmentOption,
} from '../../ui';
import {
  ScanPanel,
  SizeLines,
  answerFromResult,
  playScanFeedback,
  type ScanRead,
  type ScanReply,
  type SizeLine,
} from '../../ui/scan';
import {
  DriverScreen,
  FooterReason,
  NextStepButton,
  NoticeStrip,
  StepFrame,
  StepSkeleton,
  useCallOfficeAction,
  usePullToRefresh,
} from './components';
import { useTripFinish } from './FinishTripSheet';
import { NoLabelSheet } from './NoLabelSheet';
import { sizeOptions, useCylinderTypes } from './sizes';
import {
  applyStopProgress,
  arriveAtStop,
  fetchTrip,
  finishStop,
  lastKnownPosition,
  markNotDelivered,
  postTripScan,
  putUnlabelledReturns,
  refreshTrip,
  refusalProgress,
  type TakeBackShort,
  type TripScanAction,
  type UnlabelledItem,
} from './tripApi';
import {
  RETURN_STATES,
  customerNameOf,
  deliveryOf,
  findStop,
  isTripOpen,
  needLines,
  orderOf,
  progressLines,
  shortCodeOf,
  stepPosition,
  type DeliveryProgress,
  type TripDetail,
  type TripOrder,
  type TripStop,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Visit'>;

/**
 * Where a visit is (driver spec R5): on the way until "I've arrived"; deliver until the server says
 * every cylinder is given; take back until "Finish visit"; then done. NOT_DELIVERED or CANCELLED when the
 * order failed or was cancelled; CLOSED when the trip ended before this visit did.
 */
type Phase = 'DRIVE' | 'DELIVER' | 'TAKE_BACK' | 'DONE' | 'NOT_DELIVERED' | 'CANCELLED' | 'CLOSED';

function phaseOf(trip: TripDetail, stop: TripStop): Phase {
  const order = orderOf(trip, stop);
  if (stop.status === 'DONE') return 'DONE';
  // The office stopped the trip before anything happened on it: nothing to bring back.
  if (trip.status === 'ABORTED') return 'CLOSED';
  if (stop.status === 'FAILED' || order?.status === 'FAILED') return 'NOT_DELIVERED';
  if (stop.status === 'CANCELLED' || order?.status === 'CANCELLED') return 'CANCELLED';
  if (!isTripOpen(trip)) return 'CLOSED';
  if (stop.status === 'PENDING') return 'DRIVE';
  return deliveryOf(stop)?.give.complete ? 'TAKE_BACK' : 'DELIVER';
}

/** The sheets of this screen; one at a time. */
type Sheet = 'notDelivered' | 'short' | 'noLabel';

/** Refusals that mean the visit or the trip changed under the driver: the screen reads it again. */
const STALE_CODES: ReadonlySet<string> = new Set(['SCAN_STOP_CLOSED', 'SCAN_TRIP_CLOSED', 'ORDER_INVALID_TRANSITION']);

/**
 * One visit to a customer (driver spec R5 and R6; UX_MOBILE §7.2), four phases on one screen, the header
 * "Step 2 of 3" throughout:
 * 0. On the way: the address, Maps and "Call {{name}}", what to deliver and take back, "Could not
 *    deliver", and "I've arrived". The camera doesn't run while driving.
 * 1. Deliver: "0 of 3" + "delivered", the camera, one line per size; "Could not deliver" until a
 *    cylinder is given; "Finish visit" stays off with "2 more to deliver" above it. When the server says
 *    every cylinder is given, the visit moves on to Take back by itself, with the long buzz.
 * 2. Take back: "All 3 delivered", the state tap (Empty | Part-filled | Full, sticky), right under it the
 *    result strip naming the state ("AG-C0031 · Full"), "0 taken back · 3 expected", a shorter camera,
 *    three lists by state and "No label" for returns without a label. "Finish visit" asks why when fewer
 *    came back than expected (rule 7).
 * 3. Done: "Visit done", "Gave 3 · Took back 3" and the states, and the next step's button.
 * No money, no confirmation link: the driver never sees either.
 */
export function VisitScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'Visit'>>();
  const tripId = params?.tripId ?? '';
  const stopId = params?.stopId ?? '';
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();
  const { config } = useAppConfig();
  const finish = useTripFinish(tripId);
  const cylinderTypes = useCylinderTypes();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [failCode, setFailCode] = useState<string | null>(null);
  // The take-back tap: Empty by default, and it stays until changed (rule 10).
  const [returnState, setReturnState] = useState<ReturnState>('EMPTY');
  const [shortCounts, setShortCounts] = useState<{ taken: number; expected: number }>({ taken: 0, expected: 0 });
  const [noLabelStart, setNoLabelStart] = useState<{ cylinderTypeId: string; state: ReturnState } | null>(null);

  const trip = useQuery<TripDetail, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const pull = usePullToRefresh(trip.refetch);

  const data = trip.data;
  const stop = data ? findStop(data, stopId) : null;
  const order = data && stop ? orderOf(data, stop) : null;
  const phase = data && stop ? phaseOf(data, stop) : null;
  const visit = deliveryOf(stop);
  const name = customerNameOf(stop, order, t);

  // "Step 2 of 3": where this visit is in the trip.
  const headerTitle = data && stop ? t('common.step', stepPosition(data, stop.id)) : '';
  useLayoutEffect(() => {
    navigation.setOptions({ title: headerTitle });
  }, [navigation, headerTitle]);

  // Every cylinder given: the visit moves on to Take back by itself, with the long buzz (DECIDED).
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === 'DELIVER' && phase === 'TAKE_BACK') playScanFeedback('complete');
    lastPhase.current = phase;
  }, [phase]);

  const scanWith = useCallback(
    (action: TripScanAction) =>
      async (read: ScanRead): Promise<ScanReply> => {
        try {
          const result = await postTripScan(tripId, stopId, action, read);
          applyStopProgress(queryClient, tripId, stopId, result.stop?.progress ?? null, result.result === 'RECORDED');
          return answerFromResult(result);
        } catch (thrown) {
          applyStopProgress(queryClient, tripId, stopId, refusalProgress(thrown), false);
          if (STALE_CODES.has(String(toApiError(thrown).code))) void refreshTrip(queryClient, tripId);
          throw thrown;
        }
      },
    [queryClient, tripId, stopId],
  );
  const onGive = useCallback((read: ScanRead) => scanWith('HANDOVER')(read), [scanWith]);
  const onTakeBack = useCallback((read: ScanRead) => scanWith('TAKE_BACK')(read), [scanWith]);

  const arrive = useMutation<unknown, ApiError, void>({
    mutationFn: async () => {
      await arriveAtStop(stopId);
      await refreshTrip(queryClient, tripId);
    },
  });

  const finishVisit = async (short?: TakeBackShort) => {
    await finishStop(tripId, stopId, short);
    await refreshTrip(queryClient, tripId);
  };
  const visitDone = useMutation<unknown, ApiError, void>({
    mutationFn: () => finishVisit(),
    onError: (error) => {
      // The server counted fewer taken back than the screen did: ask why, with its numbers.
      if (error.code === 'TAKE_BACK_SHORT') {
        setShortCounts({ taken: Number(error.details.taken) || 0, expected: Number(error.details.expected) || 0 });
        setSheet('short');
      }
    },
  });

  // A new phase starts clean: the last phase's error line belongs to that phase.
  const resetArrive = arrive.reset;
  const resetDone = visitDone.reset;
  useEffect(() => {
    resetArrive();
    resetDone();
  }, [phase, resetArrive, resetDone]);

  const pressFinishVisit = () => {
    if (!visit) return;
    if (visit.takeBack.count < visit.takeBack.expected) {
      setShortCounts({ taken: visit.takeBack.count, expected: visit.takeBack.expected });
      setSheet('short');
      return;
    }
    visitDone.mutate();
  };

  const confirmShort = async (input: ConfirmInput) => {
    const reasonCode = TAKE_BACK_SHORT_REASONS.find((code) => code === input.reasonCode);
    if (!reasonCode) return;
    await finishVisit({ reasonCode, note: input.note });
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
      setFailCode(String(error.code));
      // The driver's words for this refusal: the shop cancels an order that hasn't started.
      if (error.code === 'ORDER_NOT_STARTED_USE_CANCEL') throw t('driver.fail.notStarted');
      throw error;
    }
    await refreshTrip(queryClient, tripId);
  };

  const saveNoLabel = async (items: UnlabelledItem[]) => {
    const progress = await putUnlabelledReturns(tripId, stopId, items);
    applyStopProgress(queryClient, tripId, stopId, progress, true);
  };

  const openNoLabel = (start: { cylinderTypeId: string; state: ReturnState } | null) => {
    setNoLabelStart(start);
    setSheet('noLabel');
  };

  const backToTrip = () => navigation.navigate('Trip', { tripId });
  const notFound = data === undefined && trip.isError && toApiError(trip.error).code === 'NOT_FOUND';

  let footer: ReactNode;
  if (notFound) {
    footer = <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="visit.backHome" />;
  } else if (data && !stop) {
    footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="visit.back" />;
  } else if (data && stop) {
    switch (phase) {
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
              testID="visit.arrive"
            />
          </>
        );
        break;
      case 'DELIVER': {
        const left = visit ? Math.max(0, visit.give.neededCount - visit.give.doneCount) : 0;
        footer = (
          <>
            {left > 0 ? <FooterReason text={t('driver.visit.left', { count: left })} testID="visit.left" /> : null}
            <Button label={t('driver.steps.finishVisit')} disabled onPress={() => undefined} testID="visit.finish" />
          </>
        );
        break;
      }
      case 'TAKE_BACK':
        footer = (
          <>
            <ActionLine error={visitDone.error?.code === 'TAKE_BACK_SHORT' ? null : visitDone.error} />
            <Button
              label={t('driver.steps.finishVisit')}
              loadingLabel={t('driver.steps.sending')}
              loading={visitDone.isPending}
              onPress={pressFinishVisit}
              testID="visit.finish"
            />
          </>
        );
        break;
      case 'CLOSED':
        footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="visit.back" />;
        break;
      default:
        footer = <NextStepButton trip={data} from="step" onFinish={finish.ask} />;
    }
  }

  const failReasons: ConfirmReason[] = DELIVERY_FAILURE_REASONS.map((code: DeliveryFailureReason) => ({
    code,
    label: t(`driver.fail.reason.${code}`),
  }));
  const shortReasons: ConfirmReason[] = TAKE_BACK_SHORT_REASONS.map((code: TakeBackShortReason) => ({
    code,
    label: t(`driver.visit.short.reason.${code}`),
  }));
  const unlabelledRows: UnlabelledItem[] = (visit?.takeBack.unlabelled ?? []).map((row) => ({
    cylinderTypeId: row.cylinderTypeId,
    state: row.state,
    count: row.count,
  }));
  const giveSizes = (visit?.give.lines ?? []).map((line) => ({ cylinderTypeId: line.cylinderTypeId, sizeLabel: line.sizeLabel }));

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
                <VisitBody
                  trip={view}
                  stop={current}
                  phase={phaseOf(view, current)}
                  returnState={returnState}
                  onReturnState={setReturnState}
                  allowTyped={config.features.typedCylinderNumber}
                  cameraActive={focused && sheet === null}
                  onGive={onGive}
                  onTakeBack={onTakeBack}
                  onNotDelivered={() => {
                    setFailCode(null);
                    setSheet('notDelivered');
                  }}
                  onNoLabel={openNoLabel}
                />
              );
            }}
          </QueryBoundary>
        )}
      </DriverScreen>

      <ConfirmSheet
        visible={sheet === 'notDelivered'}
        title={t('driver.fail.title', { name })}
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
        testID="visit.failSheet"
      />

      <ConfirmSheet
        visible={sheet === 'short'}
        title={t('driver.visit.short.title', { taken: ltr(String(shortCounts.taken)), expected: ltr(String(shortCounts.expected)) })}
        reasons={shortReasons}
        requireReason
        noteForOther
        noteLabel={t('driver.visit.short.note')}
        confirmLabel={t('driver.visit.short.confirm')}
        confirmLoadingLabel={t('driver.steps.sending')}
        cancelLabel={t('driver.visit.short.cancel')}
        onConfirm={confirmShort}
        onClose={() => setSheet(null)}
        testID="visit.shortSheet"
      />

      <NoLabelSheet
        visible={sheet === 'noLabel'}
        sizes={sizeOptions(giveSizes, cylinderTypes, t)}
        rows={unlabelledRows}
        start={noLabelStart}
        onSave={saveNoLabel}
        onClose={() => setSheet(null)}
      />

      {finish.sheets}
    </>
  );
}

interface VisitBodyProps {
  trip: TripDetail;
  stop: TripStop;
  phase: Phase;
  returnState: ReturnState;
  onReturnState: (state: ReturnState) => void;
  allowTyped: boolean;
  /** False while a sheet is open or the screen is hidden: the camera stops. */
  cameraActive: boolean;
  onGive: (read: ScanRead) => Promise<ScanReply>;
  onTakeBack: (read: ScanRead) => Promise<ScanReply>;
  onNotDelivered: () => void;
  onNoLabel: (start: { cylinderTypeId: string; state: ReturnState } | null) => void;
}

/** The visit's content in StepFrame's fixed order, by phase. */
function VisitBody({
  trip,
  stop,
  phase,
  returnState,
  onReturnState,
  allowTyped,
  cameraActive,
  onGive,
  onTakeBack,
  onNotDelivered,
  onNoLabel,
}: VisitBodyProps) {
  const { t } = useTranslation();
  const order = orderOf(trip, stop);
  const name = customerNameOf(stop, order, t);
  const deliverTitle = t('driver.trip.deliverTo', { name });
  const visit = deliveryOf(stop);
  const giveLines = visit?.give.lines ?? [];

  switch (phase) {
    case 'DRIVE': {
      const back = visit?.takeBack.expected ?? 0;
      const lines: SizeLine[] = needLines(giveLines, t);
      if (back > 0) lines.push({ key: 'takeBack', text: t('driver.steps.takeBack.count', { count: back }), secondary: true });
      return (
        <StepFrame
          title={deliverTitle}
          subtitle={stop.address ?? order?.deliveryAddressLabel ?? undefined}
          details={
            <>
              <OnTheWayButtons stop={stop} order={order} name={name} />
              {lines.length > 0 ? (
                <Card>
                  <SizeLines lines={lines} testID="visit.sizes" />
                </Card>
              ) : null}
            </>
          }
          rare={<NotDeliveredButton onPress={onNotDelivered} />}
          testID="visit.drive"
        />
      );
    }
    case 'DELIVER': {
      const given = visit?.give.doneCount ?? 0;
      return (
        <StepFrame
          title={deliverTitle}
          count={
            visit ? (
              <CountBar
                count={visit.give.doneCount}
                total={visit.give.neededCount}
                verb={t('scan.verb.HANDOVER')}
                testID="visit.count"
              />
            ) : null
          }
          scan={
            <ScanPanel key="HANDOVER" step="HANDOVER" onScan={onGive} active={cameraActive} allowTyped={allowTyped} testID="visit.scan">
              {giveLines.filter((line) => line.needed > 0).length > 1 ? (
                <SizeLines lines={progressLines(giveLines, t)} testID="visit.sizes" />
              ) : null}
            </ScanPanel>
          }
          rare={
            <>
              <CallCustomerButton order={order} name={name} />
              <NotDeliveredButton onPress={onNotDelivered} locked={given > 0} />
            </>
          }
          testID="visit.deliver"
        />
      );
    }
    case 'TAKE_BACK':
      return (
        <StepFrame
          notice={
            <NoticeStrip
              tone="success"
              icon="ok"
              message={t('driver.visit.allDelivered', { count: visit?.give.neededCount ?? 0 })}
              testID="visit.delivered"
            />
          }
          title={t('driver.steps.takeBack.title', { name })}
          control={<StateTap value={returnState} onChange={onReturnState} />}
          // The strip "AG-C0031 · Full" sits right under the state tap, then the count and a shorter
          // camera, so a wrong tap is caught at once on a 360×640 phone too (review23 ux-03).
          scan={
            <ScanPanel
              key="TAKE_BACK"
              step="TAKE_BACK"
              onScan={onTakeBack}
              returnState={returnState}
              active={cameraActive}
              allowTyped={allowTyped}
              resultFirst
              beforeCamera={
                visit ? (
                  <CountBar
                    mode="soft"
                    count={visit.takeBack.count}
                    total={visit.takeBack.expected}
                    verb={t('scan.verb.TAKE_BACK')}
                    testID="visit.count"
                  />
                ) : null
              }
              testID="visit.scan"
            >
              {visit ? <TakeBackLists visit={visit} order={order} onEditRow={onNoLabel} /> : null}
              <Button
                label={t('driver.visit.noLabel.open')}
                icon="cylinder"
                variant="ghost"
                fullWidth={false}
                onPress={() => onNoLabel(null)}
                testID="visit.noLabel"
              />
            </ScanPanel>
          }
          rare={<CallCustomerButton order={order} name={name} />}
          testID="visit.takeBack"
        />
      );
    case 'DONE': {
      // "1 empty · 2 part-filled · 0 full" says what came back: with nothing taken back it would be all zeros.
      const lines = visit
        ? [
            t('driver.visit.done.gave', { given: ltr(String(visit.give.doneCount)), taken: ltr(String(visit.takeBack.count)) }),
            ...(visit.takeBack.count > 0
              ? [
                  t('driver.visit.done.states', {
                    empty: ltr(String(visit.takeBack.byState.EMPTY)),
                    part: ltr(String(visit.takeBack.byState.PART_FILLED)),
                    full: ltr(String(visit.takeBack.byState.FULL)),
                  }),
                ]
              : []),
          ]
        : undefined;
      return (
        <StepFrame
          title={deliverTitle}
          count={<NoticeStrip tone="success" icon="ok" message={t('driver.steps.visitDone')} lines={lines} testID="visit.state" />}
          testID="visit.done"
        />
      );
    }
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
              testID="visit.state"
            />
          }
          details={<SizeLines lines={needLines(giveLines, t)} testID="visit.sizes" />}
          testID="visit.notDelivered"
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
              testID="visit.state"
            />
          }
          details={<SizeLines lines={needLines(giveLines, t)} testID="visit.sizes" />}
          testID="visit.cancelled"
        />
      );
    default:
      return (
        <StepFrame
          title={deliverTitle}
          count={<NoticeStrip tone="neutral" message={t('driver.steps.closed')} testID="visit.state" />}
          testID="visit.closed"
        />
      );
  }
}

/** "This cylinder is:" Empty | Part-filled | Full (56 dp), read before the count; the choice is sticky. */
function StateTap({ value, onChange }: { value: ReturnState; onChange: (state: ReturnState) => void }) {
  const { t } = useTranslation();
  const options: SegmentOption<ReturnState>[] = RETURN_STATES.map((state) => ({
    value: state,
    label: t(`scan.state.${state}`),
    icon: state === 'EMPTY' ? 'empty' : state === 'PART_FILLED' ? 'partFilled' : 'full',
  }));
  return (
    <View style={styles.stateTap}>
      <Text variant="label">{t('scan.state.label')}</Text>
      <SegmentedControl options={options} value={value} onChange={onChange} accessibilityLabel={t('scan.state.label')} />
    </View>
  );
}

/**
 * The taken-back cylinders in three lists, Empty · Part-filled · Full (empty lists hidden): each headed
 * by its state and count ("Part-filled · 2"), with rows "AG-C0012 · 11.8 kg" and, for returns with no
 * label, "No label · 2 × 11.8 kg", which a tap opens to change.
 */
function TakeBackLists({
  visit,
  order,
  onEditRow,
}: {
  visit: DeliveryProgress;
  order: TripOrder | null;
  onEditRow: (start: { cylinderTypeId: string; state: ReturnState }) => void;
}) {
  const { t } = useTranslation();
  const code = order?.distributor?.code ?? null;
  const groups = RETURN_STATES.map((state) => ({
    state,
    items: visit.takeBack.items.filter((item) => item.state === state),
    unlabelled: visit.takeBack.unlabelled.filter((row) => row.state === state && row.count > 0),
  })).filter((group) => group.items.length > 0 || group.unlabelled.length > 0);
  if (groups.length === 0) return null;

  return (
    <View style={styles.lists} testID="visit.lists">
      {groups.map((group) => {
        const count = group.items.length + group.unlabelled.reduce((sum, row) => sum + row.count, 0);
        return (
          <View key={group.state} style={styles.list} accessibilityRole="list">
            <Text variant="heading" tabular>
              {t('driver.groupCount', { group: t(`scan.state.${group.state}`), n: ltr(String(count)) })}
            </Text>
            {group.items.map((item) => (
              <View key={item.code} style={styles.itemRow} accessible>
                <Icon name="cylinder" size={24} tone="brand" />
                <Text variant="bodyStrong" tabular style={styles.fill}>
                  {t('driver.visit.item', { shortCode: ltr(shortCodeOf(item.code, item.shortNo, code)), size: item.sizeLabel })}
                </Text>
              </View>
            ))}
            {group.unlabelled.map((row) => (
              <Button
                key={`${row.cylinderTypeId}:${row.state}`}
                label={t('driver.visit.noLabel.row', { count: row.count, size: row.sizeLabel })}
                icon="cylinder"
                variant="secondary"
                onPress={() => onEditRow({ cylinderTypeId: row.cylinderTypeId, state: row.state })}
                testID={`visit.unlabelled.${row.cylinderTypeId}.${row.state}`}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

/**
 * "Could not deliver" (R6): secondary, last, 24 dp below the rest (never beside "Finish visit"). Once a
 * cylinder is given it is off, with "You already gave some. Call office." under it.
 */
function NotDeliveredButton({ onPress, locked = false }: { onPress: () => void; locked?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.notDelivered}>
      <Button
        label={t('driver.fail.open')}
        icon="error"
        variant="secondary"
        disabled={locked}
        onPress={onPress}
        testID="visit.notDelivered"
      />
      {locked ? (
        <Text align="center" testID="visit.locked">
          {t('driver.visit.locked')}
        </Text>
      ) : null}
    </View>
  );
}

/** On the way (D8): "Maps" when the stop has a pin, "Call {{name}}" when the trip has the phone. */
function OnTheWayButtons({ stop, order, name }: { stop: TripStop; order: TripOrder | null; name: string }) {
  const { t } = useTranslation();
  const location = stop.location;
  const phone = order?.client?.phone ?? null;
  const mapsLabel = t('driver.steps.drive.map');
  const callLabel = t('driver.steps.callCustomer', { name });
  if (!location && !phone) return null;
  // Side by side only when both labels have 12 characters or fewer (rulebook §7.2); else stacked.
  const sideBySide = mapsLabel.length <= 12 && callLabel.length <= 12;
  return (
    <View style={sideBySide ? styles.pair : styles.stacked} testID="visit.onTheWay">
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
          testID="visit.map"
        />
      ) : null}
      {phone ? (
        <Button
          label={callLabel}
          icon="call"
          variant="secondary"
          onPress={() => void Linking.openURL(telUrl(phone)).catch(() => undefined)}
          style={sideBySide ? styles.half : undefined}
          testID="visit.callCustomer"
        />
      ) : null}
    </View>
  );
}

/** "Call {{name}}" at the customer (DECIDED), when the trip has the customer's phone. */
function CallCustomerButton({ order, name }: { order: TripOrder | null; name: string }) {
  const { t } = useTranslation();
  const phone = order?.client?.phone ?? null;
  if (!phone) return null;
  return (
    <Button
      label={t('driver.steps.callCustomer', { name })}
      icon="call"
      variant="secondary"
      onPress={() => void Linking.openURL(telUrl(phone)).catch(() => undefined)}
      testID="visit.callCustomer"
    />
  );
}

// Two different actions stay 16 dp apart (rulebook §9.1).
const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: space.lg },
  stacked: { gap: space.lg },
  half: { flex: 1 },
  fill: { flex: 1 },
  stateTap: { gap: space.sm },
  lists: { gap: space.lg },
  list: { gap: space.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: sizes.touch,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notDelivered: { gap: space.sm },
});
