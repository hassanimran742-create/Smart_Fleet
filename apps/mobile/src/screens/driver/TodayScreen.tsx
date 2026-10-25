import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverHomeDto, TripSummary } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { useLiveLocation, useLiveLocationStatus, useLocationPaused } from '../../hooks/useLiveLocation';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  ActionLine,
  Button,
  EmptyState,
  Icon,
  ListRow,
  QueryBoundary,
  SkeletonCard,
  SkeletonList,
  StatusChip,
  Text,
  colors,
  layout,
  radius,
  sizes,
  space,
} from '../../ui';
import { DriverScreen, openStepFromToday, useCallOfficeAction, usePullToRefresh } from './components';
import {
  REFILLS_QUERY_KEY,
  fetchDriverRefills,
  openRefillsOf,
  refillSummaryOf,
  useBroughtBackUnfilledIds,
  type DriverRefill,
  type RefillSummary,
} from './refillModel';
import { RefillRow } from './RefillsScreen';
import { fetchDriverHome, fetchTrip, useStartTrip } from './tripApi';
import { customerNames, nextStep, storeNameOf, tripChip, tripCylinderCount, type TripDetail } from './tripModel';
import { VanRow } from './VanRow';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Home'>;

/** The trip to do now (the one in progress, else the oldest planned), then the others. */
function tripsOf(home: DriverHomeDto): { current: TripSummary | null; others: TripSummary[] } {
  if (home.activeTrip) return { current: home.activeTrip, others: home.nextTrips };
  return { current: home.nextTrips[0] ?? null, others: home.nextTrips.slice(1) };
}

/**
 * Today (driver spec D4 and R2; `GET /driver/home`): the duty row, the van, the open trips with the
 * current one first, the open refills, how many trips were done today, and one footer button that does
 * the next thing: "Start trip" (it starts the trip and opens its Load step) or "Continue trip" (the next
 * open step). Each trip row reads its names and cylinders from `GET /driver/home` (TripSummary
 * `customerNames`, `cylinders`); only the current trip is also read (`GET /trips/:id`, the cache the Trip
 * screen and "Continue trip" use), so opening it is instant.
 *
 * Refills the office assigns show here too (review23 ux-02), from the query the Refills list uses
 * (`GET /filling-orders/driver/mine`): "Refill · 1 × 6 kg · Ahmed Gas" with the driver's next job
 * ("Pick up empties"); a row opens the refill, and the footer stays the trip's (rule 1). "Nothing to do."
 * shows only with no trip and no refill. While refills are assigned, one line under the van sums them up
 * ("2 refills · 7 cylinders"), so they are seen at once even when trips push their rows down the screen.
 * Everything polls every 30 seconds while on screen, and pulls to refresh.
 */
export function TodayScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const office = useOfficeContact();
  const callOffice = useCallOfficeAction();
  const [onDuty, setOnDuty] = useState(true);
  useLiveLocation(onDuty);

  // The title ("Today · Fri 23 Oct") is DriverStack's option for this route (useTodayTitle). Setting it
  // here in a layout effect looped right after sign-in: each setOptions re-rendered the stack.
  const interval = useFocusedInterval(POLL_MS.driverHome);
  const home = useQuery<DriverHomeDto, ApiError>({
    queryKey: qk.driver.home,
    queryFn: fetchDriverHome,
    refetchInterval: interval,
  });
  const { current, others } = home.data ? tripsOf(home.data) : { current: null, others: [] };
  // The rows need only the summary; an older server's summary has no names, so its trips are read too.
  const tripIds = [current, ...others]
    .filter((trip): trip is TripSummary => trip !== null)
    .filter((trip) => trip.id === current?.id || !Array.isArray(trip.customerNames))
    .map((trip) => trip.id);
  const details = useQueries({
    queries: tripIds.map((id) => ({
      queryKey: qk.trip(id),
      queryFn: () => fetchTrip(id),
      refetchInterval: interval,
    })),
  });
  const detailOf = (id: string): TripDetail | undefined => (tripIds.includes(id) ? details[tripIds.indexOf(id)]?.data : undefined);
  // The driver's refills (the Refills list's query), on Today's 30-second poll.
  const refills = useQuery<DriverRefill[], ApiError>({
    queryKey: REFILLS_QUERY_KEY,
    queryFn: fetchDriverRefills,
    refetchInterval: interval,
  });
  const unfilled = useBroughtBackUnfilledIds();
  const openRefills = refills.data ? openRefillsOf(refills.data) : [];
  const refillSummary = refills.data ? refillSummaryOf(refills.data) : null;
  // Known once answered (or failed): "Nothing to do." never shows before the refills are known.
  const refillsKnown = refills.data !== undefined || refills.isError;
  const pull = usePullToRefresh(home.refetch, refills.refetch, ...details.map((detail) => detail.refetch));

  const start = useStartTrip((trip) => openStepFromToday(navigation, trip, nextStep(trip)));
  // "Continue trip": the trip's next step, read fresh when the cache doesn't have the trip yet.
  const resume = useMutation<TripDetail, ApiError, string>({
    mutationFn: (tripId) =>
      queryClient.fetchQuery({ queryKey: qk.trip(tripId), queryFn: () => fetchTrip(tripId), staleTime: 10_000 }),
    onSuccess: (trip) => openStepFromToday(navigation, trip, nextStep(trip)),
  });
  const go = (trip: TripSummary) => {
    if (trip.status === 'PLANNED') start.mutate(trip.id);
    else resume.mutate(trip.id);
  };

  return (
    <DriverScreen
      locationStrip={false}
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        current ? (
          <>
            <ActionLine error={start.error ?? resume.error} />
            <Button
              label={current.status === 'IN_PROGRESS' ? t('driver.home.continueTrip') : t('driver.trip.start')}
              loadingLabel={current.status === 'IN_PROGRESS' ? t('driver.steps.sending') : t('driver.trip.starting')}
              loading={start.isPending || resume.isPending}
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

        <QueryBoundary
          query={home}
          skeleton={
            <View style={styles.stack}>
              <SkeletonCard lines={1} />
              <SkeletonList rows={2} />
            </View>
          }
          errorAction={callOffice}
          offlineAction={callOffice}
        >
          {(data) => (
            <View style={styles.stack}>
              <VanRow home={data} onPress={() => navigation.navigate('Van')} />
              {refillSummary ? <RefillSummaryLine summary={refillSummary} /> : null}
              {current || openRefills.length > 0 ? (
                <View style={styles.list}>
                  {current
                    ? [current, ...others].map((trip) => (
                        <TripRow
                          key={trip.id}
                          trip={trip}
                          detail={detailOf(trip.id)}
                          currentId={current.id}
                          onOpen={() => navigation.navigate('Trip', { tripId: trip.id })}
                        />
                      ))
                    : null}
                  {openRefills.map((refill) => (
                    <RefillRow
                      key={refill.id}
                      refill={refill}
                      broughtBackUnfilled={unfilled[refill.id] === true}
                      onToday
                      onPress={() => navigation.navigate('RefillRun', { refillId: refill.id })}
                    />
                  ))}
                </View>
              ) : refillsKnown ? (
                <EmptyState
                  icon="truck"
                  title={t('driver.home.empty.title')}
                  body={t('driver.home.empty.body')}
                  action={
                    office.phone
                      ? { label: t('common.actions.callOffice'), icon: 'call', onPress: office.call }
                      : undefined
                  }
                />
              ) : (
                <SkeletonList rows={1} />
              )}
              {data.doneToday > 0 ? (
                <Text variant="bodyStrong" tabular testID="home.doneToday">
                  {t('driver.home.doneToday', { count: data.doneToday })}
                </Text>
              ) : null}
            </View>
          )}
        </QueryBoundary>
      </View>
    </DriverScreen>
  );
}

/**
 * The one line about the assigned refills (UX_MOBILE §7.2 R2): the cylinder icon and "2 refills · 7
 * cylinders". Not a button: each refill's own row below opens it.
 */
function RefillSummaryLine({ summary }: { summary: RefillSummary }) {
  const { t } = useTranslation();
  const cylinders = t('driver.trip.cylinders', { count: summary.cylinders });
  return (
    <View style={styles.summary} testID="home.refillSummary">
      <Icon name="cylinder" size={24} tone="secondary" />
      <Text variant="bodyStrong" tabular style={styles.fill}>
        {t('driver.home.refillSummary', { count: summary.refills, cylinders })}
      </Text>
    </View>
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

/**
 * One trip: who it delivers to, how many cylinders and where it loads, with its chip under the text, so
 * the customer's name gets the row's width on a 360 dp phone. The current trip has the brand border.
 * The summary's names and count come first; without them (an older server) the trip's own answer is
 * used, and until it has loaded the row says how many customers it has.
 */
function TripRow({
  trip,
  detail,
  currentId,
  onOpen,
}: {
  trip: TripSummary;
  detail: TripDetail | undefined;
  currentId: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const fromSummary = Array.isArray(trip.customerNames);
  const names = fromSummary ? trip.customerNames : detail ? customerNames(detail, t) : [];
  const title =
    names.length === 1
      ? t('driver.home.tripTo', { name: names[0] })
      : t('driver.home.tripCustomers', { count: names.length || trip.customers });
  const store = trip.store.name || (detail ? storeNameOf(detail, t) : '');
  const cylinders = fromSummary ? trip.cylinders : detail ? tripCylinderCount(detail) : null;
  const line = cylinders !== null && store ? t('driver.home.tripDetail', { count: cylinders, store }) : undefined;

  return (
    <ListRow
      title={title}
      subtitle={line}
      leadingIcon="truck"
      below={<StatusChip kind="step" value={tripChip(trip, currentId)} />}
      chevron
      onPress={onOpen}
      style={[styles.row, trip.id === currentId ? styles.rowCurrent : null]}
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
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
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
