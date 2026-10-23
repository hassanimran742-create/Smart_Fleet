import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useVanLoad, vanCounts, vanTotal } from '../../components/VehicleLoad';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { Button, CountBar, EmptyState, QueryBoundary, SkeletonCard } from '../../ui';
import { ScanPanel, type ScanOutcome, type ScanRead } from '../../ui/scan';
import {
  DriverScreen,
  NoticeStrip,
  StepFrame,
  StepSkeleton,
  useCallOfficeAction,
  usePullToRefresh,
} from './components';
import { FinishTripSheet } from './FinishTripSheet';
import { fetchTrip, refreshAfterScan, scanCylinder } from './tripApi';
import { hasOpenDelivery, isTripOpen, stepPosition, storeNameOf, type TripView } from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Unload'>;

/**
 * Unload at the store (driver spec D12; Inc 1's SCAN_IN, the trip's last step). The big number counts
 * down what the server says is on the van (`GET /inventory/my-vehicle`, refetched after each scan and
 * every 10 seconds) to "Nothing on the van.". The van count is the whole van: in Inc 1 it can't tell
 * two trips' cylinders apart (accepted, DECIDED). With no customer left, the footer is "Finish trip",
 * outlined while cylinders remain; otherwise "Back to trip".
 */
export function UnloadScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'Unload'>>();
  const tripId = params?.tripId ?? '';
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();
  const [finishOpen, setFinishOpen] = useState(false);

  const trip = useQuery<TripView, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const van = useVanLoad();
  const pull = usePullToRefresh(trip.refetch, van.refetch);

  const data = trip.data;
  const count = vanTotal(van.data);
  const headerTitle = data ? t('common.step', stepPosition(data, null)) : '';
  useLayoutEffect(() => {
    navigation.setOptions({ title: headerTitle });
  }, [navigation, headerTitle]);

  const onScan = useCallback(
    async (read: ScanRead): Promise<ScanOutcome> => {
      const result = await scanCylinder({
        qrCode: read.code,
        eventType: 'SCAN_IN',
        tripId,
        lat: read.lat,
        lng: read.lng,
      });
      refreshAfterScan(queryClient, tripId);
      return result.alreadyRecorded ? 'already' : 'recorded';
    },
    [queryClient, tripId],
  );

  const backToTrip = () => navigation.navigate('ActiveTrip', { tripId });
  const notFound = data === undefined && trip.isError && toApiError(trip.error).code === 'NOT_FOUND';

  let footer: ReactNode;
  if (notFound) {
    footer = (
      <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="unload.backHome" />
    );
  } else if (data && isTripOpen(data) && !hasOpenDelivery(data)) {
    footer = (
      <Button
        label={t('driver.trip.finish')}
        icon="ok"
        variant={count === 0 ? 'primary' : 'secondary'}
        onPress={() => setFinishOpen(true)}
        testID="unload.finish"
      />
    );
  } else if (data) {
    footer = <Button label={t('driver.steps.backToTrip')} onPress={backToTrip} testID="unload.back" />;
  }

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      {notFound ? (
        <EmptyState icon="truck" title={t('errors.NOT_FOUND')} />
      ) : (
        <QueryBoundary query={trip} skeleton={<StepSkeleton />} errorAction={callOffice} offlineAction={callOffice}>
          {(view) => {
            const title = t('driver.trip.unloadAt', { store: storeNameOf(view, t) });
            if (!isTripOpen(view)) {
              return (
                <StepFrame
                  title={title}
                  count={<NoticeStrip tone="neutral" message={t('driver.steps.closed')} testID="unload.state" />}
                  testID="unload"
                />
              );
            }
            const load = van.data;
            return (
              <StepFrame
                title={title}
                count={
                  load ? (
                    <CountBar
                      mode="countdown"
                      count={count ?? 0}
                      verb={t('driver.van.onVan')}
                      completeLabel={t('driver.van.nothing')}
                      detail={vanCounts(load.totalFull, load.totalEmpty, t) || undefined}
                      testID="unload.count"
                    />
                  ) : van.isError ? null : (
                    <SkeletonCard lines={1} />
                  )
                }
                scan={
                  <ScanPanel
                    step="UNLOAD"
                    onScan={onScan}
                    active={focused && !finishOpen}
                    complete={count === null ? undefined : count === 0}
                    testID="unload.scan"
                  />
                }
                testID="unload"
              />
            );
          }}
        </QueryBoundary>
      )}

      <FinishTripSheet
        visible={finishOpen}
        onClose={() => setFinishOpen(false)}
        tripId={tripId}
        store={storeNameOf(data, t)}
      />
    </DriverScreen>
  );
}
