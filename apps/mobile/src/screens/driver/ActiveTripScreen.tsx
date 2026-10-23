import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useVanLoad } from '../../components/VehicleLoad';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  Button,
  Card,
  ConfirmSheet,
  ErrorBanner,
  ListRow,
  QueryBoundary,
  SkeletonList,
  StatusChip,
  Text,
  colors,
  layout,
  ltr,
  radius,
  space,
  type DriverStepState,
} from '../../ui';
import { DriverScreen, NoticeStrip, usePullToRefresh } from './components';
import { fetchTrip, refreshTrip, setTripStatus } from './tripApi';
import {
  cylindersToGive,
  cylindersToTakeBack,
  deliveryStops,
  isStopOpen,
  isTripOpen,
  nextOpenStop,
  orderOf,
  stepTitle,
  stopStepState,
  stopsOf,
  tripStepState,
  type TripStop,
  type TripView,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'ActiveTrip'>;

/**
 * The trip (UX_MOBILE §5 stop-gaps): the store, each customer and the hand-back, each with its step
 * chip in words. The footer holds the one next action: Start trip, then the next step, then Finish
 * trip. A refusal or a lost connection shows inline with "Try again"; nothing is a pop-up.
 */
export function ActiveTripScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'ActiveTrip'>>();
  const tripId = params?.tripId ?? '';
  const queryClient = useQueryClient();
  const [finishOpen, setFinishOpen] = useState(false);

  const trip = useQuery<TripView, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.trip),
  });
  const van = useVanLoad();
  const pull = usePullToRefresh(trip.refetch, van.refetch);

  const openStop = (stop: TripStop) => navigation.navigate('DeliverySteps', { tripId, stopId: stop.id });

  const start = useMutation<unknown, ApiError, void>({
    mutationFn: async () => {
      await setTripStatus(tripId, 'IN_PROGRESS');
      await refreshTrip(queryClient, tripId);
    },
    onSuccess: () => {
      // Starting goes straight to the first step (loading at the store).
      const data = queryClient.getQueryData<TripView>(qk.trip(tripId));
      const next = data ? nextOpenStop(data) : null;
      if (next) openStop(next);
    },
  });

  const finish = async () => {
    await setTripStatus(tripId, 'COMPLETED');
    await refreshTrip(queryClient, tripId);
  };

  const data = trip.data;
  const open = data ? isTripOpen(data) : false;
  const next = data ? nextOpenStop(data) : null;
  // While the van's load is unknown, the hand-back step stays offered as the next one.
  const vanHasCylinders = van.data ? van.data.totalFull + van.data.totalEmpty > 0 : true;
  const storeName = data?.originStore?.name ?? t('scan.theStore');

  let footer: ReactNode;
  if (data && open) {
    if (data.status === 'PLANNED') {
      footer = (
        <>
          {start.error ? <ErrorBanner error={start.error} onRetry={() => start.mutate()} /> : null}
          <Button
            label={t('driver.trip.start')}
            loadingLabel={t('driver.trip.starting')}
            loading={start.isPending}
            icon="truck"
            onPress={() => start.mutate()}
            testID="trip.start"
          />
        </>
      );
    } else if (next) {
      footer = (
        <Button
          label={t('driver.trip.next', { step: stepTitle(data, next, t) })}
          onPress={() => openStop(next)}
          testID="trip.next"
        />
      );
    } else {
      footer = (
        <Button label={t('driver.trip.finish')} icon="ok" onPress={() => setFinishOpen(true)} testID="trip.finish" />
      );
    }
  }

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      <QueryBoundary query={trip} skeleton={<SkeletonList rows={3} />}>
        {(view) => (
          <TripBody
            trip={view}
            vanHasCylinders={vanHasCylinders}
            onOpenStop={openStop}
            onHandBack={() => navigation.navigate('Scan', { eventType: 'SCAN_IN', tripId })}
          />
        )}
      </QueryBoundary>

      <ConfirmSheet
        visible={finishOpen}
        title={t('driver.trip.finishSheet.title')}
        body={t('driver.trip.finishSheet.body', { store: storeName })}
        confirmLabel={t('driver.trip.finishSheet.confirm')}
        confirmLoadingLabel={t('driver.trip.finishing')}
        cancelLabel={t('driver.trip.finishSheet.cancel')}
        onConfirm={finish}
        onClose={() => setFinishOpen(false)}
        testID="trip.finishSheet"
      />
    </DriverScreen>
  );
}

function TripBody({
  trip,
  vanHasCylinders,
  onOpenStop,
  onHandBack,
}: {
  trip: TripView;
  vanHasCylinders: boolean;
  onOpenStop: (stop: TripStop) => void;
  onHandBack: () => void;
}) {
  const { t } = useTranslation();
  const open = isTripOpen(trip);
  const stops = stopsOf(trip);
  const store = trip.originStore?.name ?? t('scan.theStore');
  const deliveriesClosed = deliveryStops(trip).every((stop) => !isStopOpen(trip, stop));
  const handBackState: DriverStepState = !open
    ? 'SKIPPED'
    : !deliveriesClosed
      ? 'TO_DO'
      : vanHasCylinders
        ? 'NEXT'
        : 'DONE';

  return (
    <View style={styles.stack}>
      <Card>
        <View style={styles.summary}>
          <StatusChip kind="step" value={tripStepState(trip, trip)} />
          <Text variant="title">{t('driver.trip.from', { store })}</Text>
          {trip.originStore?.address ? <Text tone="secondary">{trip.originStore.address}</Text> : null}
          {trip.vehicle?.plateNo ? (
            <Text variant="bodyStrong">{t('driver.van.plate', { plate: ltr(trip.vehicle.plateNo) })}</Text>
          ) : null}
        </View>
      </Card>

      {trip.status === 'COMPLETED' ? (
        <NoticeStrip tone="success" icon="ok" message={t('driver.trip.finished')} />
      ) : trip.status === 'ABORTED' ? (
        <NoticeStrip tone="neutral" icon="info" message={t('driver.trip.aborted')} />
      ) : null}

      {stops.length === 0 ? (
        <Text tone="secondary">{t('driver.trip.noSteps')}</Text>
      ) : (
        <View style={styles.list}>
          {stops.map((stop) => (
            <StopRow key={stop.id} trip={trip} stop={stop} onPress={() => onOpenStop(stop)} />
          ))}
          {open ? (
            <ListRow
              title={t('driver.trip.handBackAt', { store })}
              subtitle={t('driver.trip.handBackHelp')}
              leadingIcon="store"
              below={<StatusChip kind="step" value={handBackState} />}
              chevron
              onPress={onHandBack}
              style={styles.row}
              testID="trip.handBack"
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * One step of the trip with its step chip in words. The chip sits under the text, so "Deliver to
 * {{name}}" gets the row's width and the customer's name, which tells the stops apart, isn't cut.
 */
function StopRow({ trip, stop, onPress }: { trip: TripView; stop: TripStop; onPress: () => void }) {
  const { t } = useTranslation();
  const state = stopStepState(trip, stop);
  if (stop.stopType === 'DELIVERY') {
    const order = orderOf(trip, stop);
    return (
      <ListRow
        title={stepTitle(trip, stop, t)}
        subtitle={order?.deliveryAddressLabel ?? undefined}
        meta={t('driver.trip.give', { count: cylindersToGive(order), back: cylindersToTakeBack(order) })}
        leadingIcon="customer"
        below={<StatusChip kind="step" value={state} />}
        chevron
        onPress={onPress}
        style={styles.row}
        testID={`trip.stop.${stop.id}`}
      />
    );
  }
  return (
    <ListRow
      title={stepTitle(trip, stop, t)}
      subtitle={t('driver.trip.loadHelp')}
      leadingIcon="store"
      below={<StatusChip kind="step" value={state} />}
      chevron
      onPress={onPress}
      style={styles.row}
      testID={`trip.stop.${stop.id}`}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.sectionGap },
  summary: { gap: space.xs },
  list: { gap: space.sm },
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
});
