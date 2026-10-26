import { useCallback, useLayoutEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { ActionLine, Button, CountBar, EmptyState, QueryBoundary } from '../../ui';
import { ScanPanel, SizeLines, answerFromResult, type ScanRead, type ScanReply } from '../../ui/scan';
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
import { applyStopProgress, fetchTrip, finishStop, postTripScan, refreshTrip, refusalProgress } from './tripApi';
import {
  findStop,
  isStopOpen,
  isTripOpen,
  needLines,
  pickupOf,
  progressLines,
  stepPosition,
  storeNameOf,
  type TripDetail,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Load'>;

/**
 * Load at the store (driver spec D7 and R4): the big "0 of 3" + "loaded" from the server's count, the
 * camera, the strip naming each cylinder ("AG-C0001 · 11.8 kg loaded"), one line per size with two or
 * more sizes ("11.8 kg · 0 of 2"), "Type number", and "Missing some? Call office" last. "Done loading"
 * is off until everything is loaded, with "3 more to load" above it (the server refuses an early one
 * with LOAD_INCOMPLETE). Once loaded: "Loading done", and the footer names the next step.
 */
export function LoadScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'Load'>>();
  const tripId = params?.tripId ?? '';
  const stopId = params?.stopId ?? '';
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const finish = useTripFinish(tripId);

  const trip = useQuery<TripDetail, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const pull = usePullToRefresh(trip.refetch);

  const data = trip.data;
  const stop = data ? findStop(data, stopId) : null;
  const loads = pickupOf(stop);
  const loading = Boolean(data && stop && isTripOpen(data) && isStopOpen(stop));

  // "Step 1 of 3": where this step is in the trip.
  const headerTitle = data && stop ? t('common.step', stepPosition(data, stop.id)) : '';
  useLayoutEffect(() => {
    navigation.setOptions({ title: headerTitle });
  }, [navigation, headerTitle]);

  const onScan = useCallback(
    async (read: ScanRead): Promise<ScanReply> => {
      try {
        const result = await postTripScan(tripId, stopId, 'LOAD', read);
        applyStopProgress(queryClient, tripId, stopId, result.stop?.progress ?? null, result.result === 'RECORDED');
        return answerFromResult(result);
      } catch (thrown) {
        // A refusal still carries the count, so "3 of 5" stays right.
        applyStopProgress(queryClient, tripId, stopId, refusalProgress(thrown), false);
        throw thrown;
      }
    },
    [queryClient, tripId, stopId],
  );

  const done = useMutation<unknown, ApiError, void>({
    mutationFn: async () => {
      await finishStop(tripId, stopId);
      await refreshTrip(queryClient, tripId);
    },
  });

  const backToTrip = () => navigation.navigate('Trip', { tripId });
  const notFound = data === undefined && trip.isError && toApiError(trip.error).code === 'NOT_FOUND';

  let footer: ReactNode;
  if (notFound) {
    footer = <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="load.backHome" />;
  } else if (data && !stop) {
    footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="load.back" />;
  } else if (data && stop && loading) {
    const left = loads ? Math.max(0, loads.neededCount - loads.doneCount) : 0;
    const complete = loads?.complete === true;
    footer = (
      <>
        {done.error ? (
          <ActionLine error={done.error} />
        ) : !complete && left > 0 ? (
          <FooterReason text={t('driver.load.left', { count: left })} testID="load.left" />
        ) : null}
        <Button
          label={t('driver.steps.load.done')}
          loadingLabel={t('driver.steps.sending')}
          loading={done.isPending}
          disabled={!complete}
          onPress={() => done.mutate()}
          testID="load.done"
        />
      </>
    );
  } else if (data && stop?.status === 'DONE') {
    footer = <NextStepButton trip={data} from="step" onFinish={finish.ask} />;
  } else if (data) {
    footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="load.back" />;
  }

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      {notFound ? (
        <EmptyState icon="truck" title={t('errors.NOT_FOUND')} />
      ) : (
        <QueryBoundary query={trip} skeleton={<StepSkeleton />} errorAction={callOffice} offlineAction={callOffice}>
          {(view) => {
            const current = findStop(view, stopId);
            if (!current) return <EmptyState icon="truck" title={t('driver.steps.missing.title')} />;
            const progress = pickupOf(current);
            const title = t('driver.trip.loadAt', { store: storeNameOf(view, t) });
            const lines = progress?.lines ?? [];

            if (isTripOpen(view) && isStopOpen(current)) {
              const complete = progress ? progress.complete : undefined;
              return (
                <StepFrame
                  title={title}
                  count={
                    progress ? (
                      <CountBar
                        count={progress.doneCount}
                        total={progress.neededCount}
                        verb={t('scan.verb.LOAD')}
                        testID="load.count"
                      />
                    ) : null
                  }
                  scan={
                    <ScanPanel
                      key="LOAD"
                      step="LOAD"
                      onScan={onScan}
                      active={focused}
                      complete={complete}
                      allowTyped={config.features.typedCylinderNumber}
                      testID="load.scan"
                    >
                      {lines.filter((line) => line.needed > 0).length > 1 ? (
                        <SizeLines lines={progressLines(lines, t)} testID="load.sizes" />
                      ) : null}
                    </ScanPanel>
                  }
                  rare={
                    office.phone ? (
                      <Button
                        label={t('driver.load.missing')}
                        icon="call"
                        variant="ghost"
                        onPress={office.call}
                        testID="load.missing"
                      />
                    ) : null
                  }
                  testID="load"
                />
              );
            }
            return (
              <StepFrame
                title={title}
                count={
                  current.status === 'DONE' ? (
                    <NoticeStrip tone="success" icon="ok" message={t('driver.steps.load.finished')} testID="load.state" />
                  ) : (
                    <NoticeStrip tone="neutral" message={t('driver.steps.closed')} testID="load.state" />
                  )
                }
                details={<SizeLines lines={needLines(lines, t)} testID="load.sizes" />}
                testID="load"
              />
            );
          }}
        </QueryBoundary>
      )}
      {finish.sheets}
    </DriverScreen>
  );
}
