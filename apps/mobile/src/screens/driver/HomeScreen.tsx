import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { VanRow, useVanLoad, vanTotal } from '../../components/VehicleLoad';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { useLiveLocation, useLiveLocationStatus, useLocationPaused } from '../../hooks/useLiveLocation';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  ActionLine,
  Button,
  EmptyState,
  ListRow,
  QueryBoundary,
  SkeletonList,
  StatusChip,
  Text,
  colors,
  layout,
  radius,
  sizes,
  space,
  useNoConnection,
} from '../../ui';
import { DriverScreen, openStepFromToday, useCallOfficeAction, usePullToRefresh } from './components';
import { fetchMyTrips, useStartTrip } from './tripApi';
import {
  businessDayOf,
  currentTrip,
  customerNameOf,
  deliveryStops,
  isTripOpen,
  nextStep,
  orderOf,
  storeNameOf,
  tripCylinderCount,
  tripStepState,
  type TripOrder,
  type TripView,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Home'>;

/**
 * Today (driver spec D4): the duty row, the van, the open trips with the current one first, how many
 * were done today, and one footer button that does the next thing: "Start trip" (it starts the trip
 * and opens its Load step) or "Continue trip" (the next open step). Finished and stopped trips are
 * no longer listed. The list polls every 30 seconds while on screen, and pulls to refresh.
 */
export function DriverHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { config } = useAppConfig();
  const office = useOfficeContact();
  const callOffice = useCallOfficeAction();
  const [onDuty, setOnDuty] = useState(true);
  useLiveLocation(onDuty);

  // The title ("Today · Fri 23 Oct") is DriverStack's option for this route. Setting it again here in a
  // layout effect looped right after sign-in, while the new stack's state was still being set up: each
  // setOptions re-rendered the stack with fresh route keys, which remounted Today, which set it again.

  const trips = useQuery<TripView[], ApiError>({
    queryKey: qk.driver.trips,
    queryFn: fetchMyTrips,
    refetchInterval: useFocusedInterval(POLL_MS.driverHome),
  });
  const van = useVanLoad();
  const pull = usePullToRefresh(trips.refetch, van.refetch);

  const all = trips.data ?? [];
  const current = currentTrip(all);
  const count = vanTotal(van.data);
  // While the van's load is unknown, unloading stays offered as the next step.
  const vanHasCylinders = count === null || count > 0;
  const today = businessDayOf(Date.now(), config.day);
  const doneToday = all.filter(
    (trip) => trip.status === 'COMPLETED' && trip.completedAt && businessDayOf(trip.completedAt, config.day) === today,
  ).length;

  const start = useStartTrip((trip) => openStepFromToday(navigation, trip, nextStep(trip, vanHasCylinders)));
  const go = (trip: TripView) => {
    if (trip.status === 'PLANNED') start.mutate(trip.id);
    else openStepFromToday(navigation, trip, nextStep(trip, vanHasCylinders));
  };

  // No answer and nothing saved: one calm block under the banner, so the van row hides too. With the
  // banner up it shows at once (QueryBoundary), not after the retries.
  const noConnection = useNoConnection();
  const tripsUnavailable = trips.data === undefined && (trips.isError || noConnection);

  return (
    <DriverScreen
      locationStrip={false}
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        current ? (
          <>
            <ActionLine error={start.error} />
            <Button
              label={current.status === 'IN_PROGRESS' ? t('driver.home.continueTrip') : t('driver.trip.start')}
              loadingLabel={t('driver.trip.starting')}
              loading={start.isPending}
              icon="truck"
              onPress={() => go(current)}
              testID="home.go"
            />
          </>
        ) : undefined
      }
    >
      <View style={styles.stack}>
        <DutyRow onDuty={onDuty} onChange={setOnDuty} />
        {tripsUnavailable ? null : <VanRow onPress={() => navigation.navigate('VehicleInfo')} />}

        <QueryBoundary
          query={trips}
          skeleton={<SkeletonList rows={2} />}
          isEmpty={(list) => !list.some(isTripOpen)}
          empty={
            <EmptyState
              icon="truck"
              title={t('driver.home.empty.title')}
              body={t('driver.home.empty.body')}
              action={
                office.phone ? { label: t('common.actions.callOffice'), icon: 'call', onPress: office.call } : undefined
              }
            />
          }
          errorAction={callOffice}
          offlineAction={callOffice}
        >
          {(list) => (
            <TripRows
              trips={list}
              current={current}
              onOpen={(trip) => navigation.navigate('ActiveTrip', { tripId: trip.id })}
            />
          )}
        </QueryBoundary>

        {doneToday > 0 ? (
          <Text variant="bodyStrong" tabular testID="home.doneToday">
            {t('driver.home.doneToday', { count: doneToday })}
          </Text>
        ) : null}
      </View>
    </DriverScreen>
  );
}

/**
 * On duty / off duty, which turns live location on and off. The whole 72 dp row is the switch's
 * target. A second line shows only when something is wrong: the permission, the phone's location,
 * or "Location paused" (the "No connection" banner above has Try again).
 */
function DutyRow({ onDuty, onChange }: { onDuty: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTranslation();
  const status = useLiveLocationStatus();
  const paused = useLocationPaused();
  let problem: string | null = null;
  if (onDuty && status.permission === 'denied') problem = t('driver.location.noPermission');
  else if (onDuty && status.permission === 'unavailable') problem = t('driver.location.unavailable');
  else if (onDuty && paused) problem = t('driver.location.paused');
  const blocked = onDuty && (status.permission === 'denied' || status.permission === 'unavailable');
  const label = onDuty ? t('driver.location.onDuty') : t('driver.location.offDuty');

  return (
    <View style={[styles.duty, onDuty ? styles.dutyOn : null]}>
      <Pressable
        onPress={() => onChange(!onDuty)}
        accessibilityRole="switch"
        accessibilityLabel={t('driver.location.onDuty')}
        accessibilityHint={problem ?? undefined}
        accessibilityState={{ checked: onDuty }}
        android_ripple={{ color: colors.ripple }}
        style={styles.dutyRow}
        testID="home.duty"
      >
        <View style={styles.fill}>
          <Text variant="heading">{label}</Text>
          {problem ? <Text tone="warning">{problem}</Text> : null}
        </View>
        {/* The row takes the tap; the switch only shows the state. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Switch
            value={onDuty}
            trackColor={{ false: colors.borderStrong, true: colors.brand }}
            thumbColor={colors.surface}
          />
        </View>
      </Pressable>
      {blocked ? (
        <View style={styles.dutyAction}>
          <Button
            label={t('driver.location.openSettings')}
            onPress={() => void Linking.openSettings().catch(() => undefined)}
            variant="secondary"
            fullWidth={false}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The open trips, the current one first (with the brand border), then the others by plan time. */
function TripRows({
  trips,
  current,
  onOpen,
}: {
  trips: readonly TripView[];
  current: TripView | null;
  onOpen: (trip: TripView) => void;
}) {
  const open = trips.filter(isTripOpen).sort((a, b) => {
    if (a.id === current?.id) return -1;
    if (b.id === current?.id) return 1;
    return (a.plannedAt ?? '').localeCompare(b.plannedAt ?? '');
  });
  return (
    <View style={styles.list}>
      {open.map((trip) => (
        <TripRow key={trip.id} trip={trip} current={current} onOpen={onOpen} />
      ))}
    </View>
  );
}

/**
 * One trip: who it delivers to, how many cylinders and where it loads, and its step chip under the
 * text, so the customer's name gets the row's width on a 360 dp phone.
 */
function TripRow({
  trip,
  current,
  onOpen,
}: {
  trip: TripView;
  current: TripView | null;
  onOpen: (trip: TripView) => void;
}) {
  const { t } = useTranslation();
  const names = deliveryStops(trip)
    .map((stop) => orderOf(trip, stop))
    .filter((order): order is TripOrder => order !== null)
    .map((order) => customerNameOf(order, t));
  const customers = Math.max(names.length, trip.orders?.length ?? 0);
  const title =
    names.length === 1
      ? t('driver.home.tripTo', { name: names[0] })
      : t('driver.home.tripCustomers', { count: customers });
  const detail = t('driver.home.tripDetail', { count: tripCylinderCount(trip), store: storeNameOf(trip, t) });

  return (
    <ListRow
      title={title}
      subtitle={detail}
      leadingIcon="truck"
      below={<StatusChip kind="step" value={tripStepState(trip, current)} />}
      chevron
      onPress={() => onOpen(trip)}
      style={[styles.row, trip.id === current?.id ? styles.rowCurrent : null]}
      testID={`home.trip.${trip.id}`}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.cardGap },
  list: { gap: space.sm },
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  rowCurrent: { borderWidth: 2, borderColor: colors.brand },
  fill: { flex: 1, gap: space.xs },
  duty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  dutyOn: { borderColor: colors.brand },
  dutyRow: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
  },
  dutyAction: { paddingHorizontal: layout.cardPadding, paddingBottom: space.md },
});
