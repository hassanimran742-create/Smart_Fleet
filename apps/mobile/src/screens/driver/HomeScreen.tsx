import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { VehicleLoad, useVanLoad } from '../../components/VehicleLoad';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { useLiveLocation, useLiveLocationStatus, useLocationPaused } from '../../hooks/useLiveLocation';
import { formatWhenText } from '../../i18n';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
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
} from '../../ui';
import { DriverScreen, usePullToRefresh } from './components';
import { fetchMyTrips } from './tripApi';
import {
  currentTrip,
  deliveryStops,
  finishedAt,
  isTripOpen,
  orderOf,
  tripCylinderCount,
  tripStepState,
  type TripView,
} from './tripModel';

/** How many finished trips Home keeps under "Finished". */
const FINISHED_SHOWN = 5;

type Nav = NativeStackNavigationProp<DriverStackParams, 'Home'>;

/**
 * Driver Home (UX_MOBILE §5 stop-gaps): the duty switch, the van, and the trips the office assigned.
 * No free scans, no "Nearby orders" and no "Transfer tasks": every scan opens from a trip step. The
 * list polls every 30 seconds while on screen, and pulls to refresh.
 */
export function DriverHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [onDuty, setOnDuty] = useState(true);
  useLiveLocation(onDuty);

  const trips = useQuery<TripView[], ApiError>({
    queryKey: qk.driver.trips,
    queryFn: fetchMyTrips,
    refetchInterval: useFocusedInterval(POLL_MS.driverHome),
  });
  const van = useVanLoad();
  const pull = usePullToRefresh(trips.refetch, van.refetch);

  const all = trips.data ?? [];
  const current = currentTrip(all);
  const openTrip = (trip: TripView) => navigation.navigate('ActiveTrip', { tripId: trip.id });

  return (
    <DriverScreen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        current ? (
          <Button
            label={current.status === 'IN_PROGRESS' ? t('driver.home.continueTrip') : t('driver.home.openTrip')}
            icon="truck"
            onPress={() => openTrip(current)}
            testID="home.openTrip"
          />
        ) : undefined
      }
    >
      <View style={styles.stack}>
        <DutyCard onDuty={onDuty} onChange={setOnDuty} />
        <VehicleLoad compact />

        <QueryBoundary
          query={trips}
          skeleton={<SkeletonList rows={2} />}
          isEmpty={(list) => list.length === 0}
          empty={
            <EmptyState icon="truck" title={t('driver.home.empty.title')} body={t('driver.home.empty.body')} />
          }
        >
          {(list) => <TripLists trips={list} current={current} onOpen={openTrip} />}
        </QueryBoundary>
      </View>
    </DriverScreen>
  );
}

/** On duty / off duty, which turns live location on and off. The whole row is the 56 dp target. */
function DutyCard({ onDuty, onChange }: { onDuty: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTranslation();
  const status = useLiveLocationStatus();
  const paused = useLocationPaused();
  const blocked = onDuty && (status.permission === 'denied' || status.permission === 'unavailable');
  let helper: string;
  if (!onDuty) helper = t('driver.location.notSharing');
  else if (status.permission === 'denied') helper = t('driver.location.noPermission');
  else if (status.permission === 'unavailable') helper = t('driver.location.unavailable');
  else if (paused) helper = t('driver.location.paused');
  else if (status.permission === 'granted' && status.connected) helper = t('driver.location.sharing');
  else helper = t('driver.location.starting');
  const warn = blocked || (onDuty && paused);

  return (
    <View style={[styles.duty, onDuty ? styles.dutyOn : null]}>
      <Pressable
        onPress={() => onChange(!onDuty)}
        accessibilityRole="switch"
        accessibilityLabel={t('driver.location.onDuty')}
        accessibilityHint={helper}
        accessibilityState={{ checked: onDuty }}
        android_ripple={{ color: colors.ripple }}
        style={styles.dutyRow}
        testID="home.duty"
      >
        <View style={styles.fill}>
          <Text variant="heading">{onDuty ? t('driver.location.onDuty') : t('driver.location.offDuty')}</Text>
          <Text tone={warn ? 'warning' : 'secondary'}>{helper}</Text>
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

function TripLists({
  trips,
  current,
  onOpen,
}: {
  trips: readonly TripView[];
  current: TripView | null;
  onOpen: (trip: TripView) => void;
}) {
  const { t } = useTranslation();
  const open = trips
    .filter(isTripOpen)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'IN_PROGRESS' ? -1 : 1;
      return (a.plannedAt ?? '').localeCompare(b.plannedAt ?? '');
    });
  const finished = trips
    .filter((trip) => !isTripOpen(trip))
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)))
    .slice(0, FINISHED_SHOWN);

  return (
    <View style={styles.stack}>
      {open.length > 0 ? (
        <View style={styles.section}>
          <Text variant="heading">{t('driver.home.openTrips')}</Text>
          <View style={styles.list}>
            {open.map((trip) => (
              <TripRow key={trip.id} trip={trip} current={current} onOpen={onOpen} />
            ))}
          </View>
        </View>
      ) : (
        <EmptyState icon="truck" title={t('driver.home.empty.title')} body={t('driver.home.empty.body')} />
      )}
      {finished.length > 0 ? (
        <View style={styles.section}>
          <Text variant="heading">{t('driver.home.finishedTrips')}</Text>
          <View style={styles.list}>
            {finished.map((trip) => (
              <TripRow key={trip.id} trip={trip} current={current} onOpen={onOpen} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One trip: who it delivers to, how many cylinders, where it loads, and its step chip in words. The
 * chip sits under the text, so the customer's name gets the row's width on a 360 dp phone.
 */
function TripRow({ trip, current, onOpen }: { trip: TripView; current: TripView | null; onOpen: (trip: TripView) => void }) {
  const { t } = useTranslation();
  const customers = deliveryStops(trip)
    .map((stop) => orderOf(trip, stop)?.client?.name)
    .filter((name): name is string => Boolean(name));
  const title =
    customers.length === 1
      ? t('driver.home.tripTo', { name: customers[0] })
      : t('driver.home.tripCustomers', { count: Math.max(customers.length, trip.orders?.length ?? 0) });
  const store = trip.originStore?.name ?? t('scan.theStore');
  const subtitle = t('driver.home.tripDetail', { count: tripCylinderCount(trip), store });
  const assignedAt = trip.plannedAt ? t('driver.home.assigned', { when: formatWhenText(trip.plannedAt) }) : undefined;

  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      meta={assignedAt}
      leadingIcon="truck"
      below={<StatusChip kind="step" value={tripStepState(trip, current)} />}
      chevron
      onPress={() => onOpen(trip)}
      style={styles.row}
      testID={`home.trip.${trip.id}`}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.sectionGap },
  section: { gap: space.md },
  list: { gap: space.sm },
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
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
