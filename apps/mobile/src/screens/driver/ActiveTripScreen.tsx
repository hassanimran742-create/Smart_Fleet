import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useVanLoad, vanTotal } from '../../components/VehicleLoad';
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
import { FinishTripSheet } from './FinishTripSheet';
import { fetchTrip, useStartTrip } from './tripApi';
import {
  STEP_ICON,
  cylindersToGive,
  cylindersToTakeBack,
  customerNameOf,
  isTripOpen,
  nextStep,
  orderOf,
  ordersOfTheLoad,
  stopStepState,
  storeNameOf,
  tripSteps,
  unloadStepState,
  type TripStop,
  type TripView,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'ActiveTrip'>;

/**
 * The trip (driver spec D6): its steps in order (Load at the store, Deliver to each customer, Unload
 * at the store), each with its chip, and one footer button chosen by progress: Start trip, Load at
 * store, Deliver to {{name}}, Unload at store, Finish trip, or Back to home once it has closed. Any
 * row opens its step, before Start too: the first load scan or arrive starts the trip on the server.
 */
export function ActiveTripScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'ActiveTrip'>>();
  const tripId = params?.tripId ?? '';
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

  const count = vanTotal(van.data);
  // While the van's load is unknown, unloading stays offered as the next step.
  const vanHasCylinders = count === null || count > 0;

  // "Start trip" starts, then opens the Load step over this screen.
  const start = useStartTrip((fresh) => {
    const next = nextStep(fresh, vanHasCylinders);
    if (next.kind === 'LOAD' || next.kind === 'DELIVER')
      navigation.navigate('DeliverySteps', { tripId, stopId: next.stop.id });
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
    footer = (
      <NextStepButton trip={data} vanHasCylinders={vanHasCylinders} from="trip" onFinish={() => setFinishOpen(true)} />
    );
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
              vanCount={count}
              vanHasCylinders={vanHasCylinders}
              onOpenStop={(stop) => navigation.navigate('DeliverySteps', { tripId, stopId: stop.id })}
              onOpenUnload={() => navigation.navigate('Unload', { tripId })}
            />
          )}
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

/**
 * The step rows (72 dp, the chip under the text so the customer's name keeps the row's width), then
 * the trip's state card once it has closed.
 */
function TripSteps({
  trip,
  vanCount,
  vanHasCylinders,
  onOpenStop,
  onOpenUnload,
}: {
  trip: TripView;
  vanCount: number | null;
  vanHasCylinders: boolean;
  onOpenStop: (stop: TripStop) => void;
  onOpenUnload: () => void;
}) {
  const { t } = useTranslation();
  const store = storeNameOf(trip, t);

  return (
    <View style={styles.stack}>
      <View style={styles.list}>
        {tripSteps(trip).map((step) => {
          if (step.kind === 'UNLOAD') {
            return (
              <ListRow
                key="unload"
                title={t('driver.trip.unloadAt', { store })}
                subtitle={vanCount ? t('driver.trip.onVan', { count: vanCount }) : undefined}
                leadingIcon={STEP_ICON.UNLOAD}
                below={
                  <StatusChip kind="step" value={unloadStepState(trip, vanHasCylinders)} stepIcon={STEP_ICON.UNLOAD} />
                }
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
            const give = cylindersToGive(order);
            const back = cylindersToTakeBack(order);
            return (
              <ListRow
                key={stop.id}
                title={t('driver.trip.deliverTo', { name: customerNameOf(order, t) })}
                subtitle={order?.deliveryAddressLabel ?? undefined}
                meta={
                  back > 0
                    ? t('driver.trip.cylindersBack', { count: give, back })
                    : t('driver.trip.cylinders', { count: give })
                }
                leadingIcon={STEP_ICON.DELIVER}
                below={
                  <StatusChip
                    kind="step"
                    value={stopStepState(trip, stop, vanHasCylinders)}
                    stepIcon={STEP_ICON.DELIVER}
                  />
                }
                chevron
                onPress={() => onOpenStop(stop)}
                style={styles.row}
                testID={`trip.stop.${stop.id}`}
              />
            );
          }
          return (
            <ListRow
              key={stop.id}
              title={t('driver.trip.loadAt', { store })}
              subtitle={t('driver.trip.cylinders', {
                count: ordersOfTheLoad(trip).reduce((sum, order) => sum + cylindersToGive(order), 0),
              })}
              leadingIcon={STEP_ICON.LOAD}
              below={
                <StatusChip kind="step" value={stopStepState(trip, stop, vanHasCylinders)} stepIcon={STEP_ICON.LOAD} />
              }
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
