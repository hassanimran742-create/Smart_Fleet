import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  ActionLine,
  Button,
  EmptyState,
  ListRow,
  QueryBoundary,
  SkeletonList,
  StatusChip,
  colors,
  layout,
  radius,
  space,
} from '../../ui';
import { DriverScreen, NextStepButton, NoticeStrip, useCallOfficeAction, usePullToRefresh } from './components';
import { useTripFinish } from './FinishTripSheet';
import { fetchTrip, useStartTrip } from './tripApi';
import {
  STEP_ICON,
  cylindersToGive,
  cylindersToTakeBack,
  customerNameOf,
  deliveryOf,
  isTripOpen,
  nextStep,
  orderOf,
  pickupOf,
  stopStepState,
  storeNameOf,
  tripSteps,
  tripVanLeftOf,
  unloadStepState,
  type TripDetail,
  type TripStop,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Trip'>;

/**
 * The trip (driver spec D6 and R3; `GET /trips/:id`, every 15 seconds): its steps in order (Load at the
 * store, Deliver to each customer, Unload at the store), each with its chip and, once begun, its count
 * ("2 of 3 loaded"), and one footer button chosen by progress: Start trip, Load at store, Deliver to
 * {{name}}, Unload at store, Finish trip, or Back to home once it has closed. Any visit still to do can
 * be opened from its row.
 */
export function TripScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'Trip'>>();
  const tripId = params?.tripId ?? '';
  const callOffice = useCallOfficeAction();
  const finish = useTripFinish(tripId);

  const trip = useQuery<TripDetail, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const pull = usePullToRefresh(trip.refetch);

  // "Start trip" starts, then opens the Load step over this screen.
  const start = useStartTrip((fresh) => {
    const next = nextStep(fresh);
    if (next.kind === 'LOAD') navigation.navigate('Load', { tripId, stopId: next.stop.id });
    else if (next.kind === 'DELIVER') navigation.navigate('Visit', { tripId, stopId: next.stop.id });
  });

  const data = trip.data;
  const notFound = data === undefined && trip.isError && toApiError(trip.error).code === 'NOT_FOUND';
  const backHome = (
    <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="trip.backHome" />
  );

  let footer: ReactNode;
  if (notFound) footer = backHome;
  else if (data && !isTripOpen(data)) footer = backHome;
  else if (data?.status === 'PLANNED') {
    footer = (
      <>
        <ActionLine error={start.error} />
        <Button
          label={t('driver.trip.start')}
          loadingLabel={t('driver.trip.starting')}
          loading={start.isPending}
          icon="truck"
          onPress={() => start.mutate(tripId)}
          testID="trip.start"
        />
      </>
    );
  } else if (data) {
    footer = <NextStepButton trip={data} from="trip" onFinish={finish.ask} />;
  }

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      {notFound ? (
        <EmptyState icon="truck" title={t('errors.NOT_FOUND')} />
      ) : (
        <QueryBoundary
          query={trip}
          skeleton={<SkeletonList rows={3} />}
          errorAction={callOffice}
          offlineAction={callOffice}
        >
          {(view) => (
            <TripSteps
              trip={view}
              onOpenStop={(stop) =>
                stop.type === 'STORE_PICKUP'
                  ? navigation.navigate('Load', { tripId, stopId: stop.id })
                  : navigation.navigate('Visit', { tripId, stopId: stop.id })
              }
              onOpenUnload={() => navigation.navigate('Unload', { tripId })}
            />
          )}
        </QueryBoundary>
      )}
      {finish.sheets}
    </DriverScreen>
  );
}

/**
 * The step rows (72 dp, the chip under the text so the customer's name keeps the row's width), then
 * the trip's state card once it has closed.
 */
function TripSteps({
  trip,
  onOpenStop,
  onOpenUnload,
}: {
  trip: TripDetail;
  onOpenStop: (stop: TripStop) => void;
  onOpenUnload: () => void;
}) {
  const { t } = useTranslation();
  const store = storeNameOf(trip, t);
  // The Unload row counts what this trip has to unload, like its chip (holder-scans-02).
  const onVan = tripVanLeftOf(trip);

  return (
    <View style={styles.stack}>
      <View style={styles.list}>
        {tripSteps(trip).map((step) => {
          if (step.kind === 'UNLOAD') {
            return (
              <ListRow
                key="unload"
                title={t('driver.trip.unloadAt', { store })}
                subtitle={onVan > 0 && isTripOpen(trip) ? t('driver.trip.onVan', { count: onVan }) : undefined}
                leadingIcon={STEP_ICON.UNLOAD}
                below={<StatusChip kind="step" value={unloadStepState(trip)} stepIcon={STEP_ICON.UNLOAD} />}
                chevron
                onPress={onOpenUnload}
                style={styles.row}
                testID="trip.unload"
              />
            );
          }
          const stop = step.stop as TripStop;
          if (step.kind === 'DELIVER') {
            const order = orderOf(trip, stop);
            const give = deliveryOf(stop)?.give;
            const back = cylindersToTakeBack(order);
            const count = give?.neededCount ?? cylindersToGive(order);
            let line: string;
            if (give && give.doneCount > 0) line = t('driver.trip.deliveredOf', { done: give.doneCount, total: give.neededCount });
            else if (back > 0) line = t('driver.trip.cylindersBack', { count, back });
            else line = t('driver.trip.cylinders', { count });
            return (
              <ListRow
                key={stop.id}
                title={t('driver.trip.deliverTo', { name: customerNameOf(stop, order, t) })}
                subtitle={stop.address ?? order?.deliveryAddressLabel ?? undefined}
                meta={line}
                leadingIcon={STEP_ICON.DELIVER}
                below={<StatusChip kind="step" value={stopStepState(trip, stop)} stepIcon={STEP_ICON.DELIVER} />}
                chevron
                onPress={() => onOpenStop(stop)}
                style={styles.row}
                testID={`trip.stop.${stop.id}`}
              />
            );
          }
          const loads = pickupOf(stop);
          const line =
            loads && loads.doneCount > 0
              ? t('driver.trip.loadedOf', { done: loads.doneCount, total: loads.neededCount })
              : t('driver.trip.cylinders', { count: loads?.neededCount ?? 0 });
          return (
            <ListRow
              key={stop.id}
              title={t('driver.trip.loadAt', { store })}
              subtitle={line}
              leadingIcon={STEP_ICON.LOAD}
              below={<StatusChip kind="step" value={stopStepState(trip, stop)} stepIcon={STEP_ICON.LOAD} />}
              chevron
              onPress={() => onOpenStop(stop)}
              style={styles.row}
              testID={`trip.stop.${stop.id}`}
            />
          );
        })}
      </View>

      {trip.status === 'COMPLETED' ? (
        <NoticeStrip tone="success" icon="ok" message={t('driver.trip.finished')} testID="trip.done" />
      ) : trip.status === 'ABORTED' ? (
        <NoticeStrip tone="neutral" message={t('driver.trip.aborted')} testID="trip.stopped" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.sectionGap },
  list: { gap: space.sm },
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
});
