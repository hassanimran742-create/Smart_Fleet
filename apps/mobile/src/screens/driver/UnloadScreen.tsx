import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { VanLeftoverCylinder } from '@smartfleet/shared-types';
import { create } from 'zustand';
import { toApiError, type ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { ActionLine, Button, CountBar, EmptyState, Icon, QueryBoundary, Text, colors, ltr, radius, sizes, space } from '../../ui';
import {
  DriverScreen,
  NoticeStrip,
  StepFrame,
  StepSkeleton,
  useCallOfficeAction,
  usePullToRefresh,
} from './components';
import { useTripFinish } from './FinishTripSheet';
import { fetchTrip } from './tripApi';
import {
  UNLOAD_GROUPS,
  hasOpenStop,
  isTripOpen,
  stepPosition,
  storeNameOf,
  tripVanLeftOf,
  unloadGroupCounts,
  type TripDetail,
  type UnloadGroup,
} from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Unload'>;

/** A cylinder's group: loaded and not given (or a spare) is Not delivered; a take-back goes by its state. */
function groupOf(cylinder: VanLeftoverCylinder): UnloadGroup {
  if (cylinder.came !== 'TAKEN_BACK') return 'NOT_DELIVERED';
  if (cylinder.state === 'FULL') return 'FULL';
  if (cylinder.state === 'PART_FILLED') return 'PART_FILLED';
  return 'EMPTY';
}

/**
 * What this phone has seen on the van during the unload, per trip, in memory only: the shop receives
 * a cylinder by scanning it off the van, so a cylinder seen before and gone now has been unloaded
 * ("2 of 5 unloaded", its row ticked). With only the counts, the most seen on the van is the total.
 */
const useUnloadMemory = create<{
  byTrip: Readonly<Record<string, { most: number; seen: Readonly<Record<string, VanLeftoverCylinder>> }>>;
}>(() => ({ byTrip: {} }));

function remember(tripId: string, total: number, cylinders: readonly VanLeftoverCylinder[] | undefined): void {
  useUnloadMemory.setState((state) => {
    const old = state.byTrip[tripId] ?? { most: 0, seen: {} };
    const seen = { ...old.seen };
    let changed = total > old.most;
    for (const cylinder of cylinders ?? []) {
      if (!seen[cylinder.shortCode]) {
        seen[cylinder.shortCode] = cylinder;
        changed = true;
      }
    }
    if (!changed) return state;
    return { byTrip: { ...state.byTrip, [tripId]: { most: Math.max(old.most, total), seen } } };
  });
}

interface UnloadRow extends VanLeftoverCylinder {
  received: boolean;
}

/**
 * The unload's count and rows: what is still on the van, and what the shop has already received. The
 * phone remembers only once every visit is closed: before that, cylinders also leave the van at the
 * customers.
 */
function useUnloadProgress(trip: TripDetail | undefined): { done: number; total: number; rows: UnloadRow[] | null } {
  const tripId = trip?.id ?? '';
  const onVan = trip ? tripVanLeftOf(trip) : 0;
  const cylinders = trip?.van?.cylinders;
  const unloading = Boolean(trip && isTripOpen(trip) && !hasOpenStop(trip));
  useEffect(() => {
    if (tripId && unloading) remember(tripId, onVan, cylinders);
  }, [tripId, unloading, onVan, cylinders]);
  const memory = useUnloadMemory((state) => state.byTrip[tripId]);

  if (!cylinders) {
    const total = unloading ? Math.max(memory?.most ?? 0, onVan) : onVan;
    return { done: total - onVan, total, rows: null };
  }
  const now = new Set(cylinders.map((cylinder) => cylinder.shortCode));
  const seen = { ...(unloading ? (memory?.seen ?? {}) : {}) };
  for (const cylinder of cylinders) seen[cylinder.shortCode] = cylinder;
  const rows = Object.values(seen).map((cylinder) => ({ ...cylinder, received: !now.has(cylinder.shortCode) }));
  return { done: rows.filter((row) => row.received).length, total: rows.length, rows };
}

/**
 * Unload at the store (driver spec R7; UX_MOBILE §7.2): the shop scans each cylinder in (its Receive),
 * so this screen only watches. "Give each cylinder to the shop to scan.", the count "0 of 5 unloaded"
 * moving by itself (every 5 seconds), and the cylinders by group (Not delivered · Empty · Part-filled ·
 * Full; a received row gets a tick and moves to the end). "Finish trip" is always on: outlined while
 * cylinders are left, when a tap gets the server's answer ("The store must scan in 2 more from your
 * van.", or the leftovers sheet when the office allows it); the filled main button at "All 5 unloaded".
 * Unlabelled returns have no holder, so they aren't listed and never block.
 */
export function UnloadScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'Unload'>>();
  const tripId = params?.tripId ?? '';
  const callOffice = useCallOfficeAction();
  const finish = useTripFinish(tripId);

  const trip = useQuery<TripDetail, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
    refetchInterval: useFocusedInterval(POLL_MS.tripUnload),
  });
  const pull = usePullToRefresh(trip.refetch);
  const data = trip.data;
  const progress = useUnloadProgress(data);

  const headerTitle = data ? t('common.step', stepPosition(data, null)) : '';
  useLayoutEffect(() => {
    navigation.setOptions({ title: headerTitle });
  }, [navigation, headerTitle]);

  const backToTrip = () => navigation.navigate('Trip', { tripId });
  const notFound = data === undefined && trip.isError && toApiError(trip.error).code === 'NOT_FOUND';
  // What the trip still has to unload (its van list, the one "Finish trip" refuses on): a refill cylinder
  // or another run's delivery on the same van never keeps "Finish trip" outlined (holder-scans-04).
  const left = data ? tripVanLeftOf(data) : 0;
  // "The store must scan in 5 more…" is old once the shop has scanned one in.
  const clearFinishError = finish.clearError;
  useEffect(() => {
    clearFinishError();
  }, [left, clearFinishError]);

  let footer: ReactNode;
  if (notFound) {
    footer = <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="unload.backHome" />;
  } else if (data && isTripOpen(data) && !hasOpenStop(data)) {
    footer = (
      <>
        <ActionLine error={finish.error} />
        <Button
          label={t('driver.trip.finish')}
          loadingLabel={t('driver.trip.finishing')}
          loading={finish.pending}
          icon="ok"
          variant={left === 0 ? 'primary' : 'secondary'}
          onPress={left === 0 ? finish.ask : finish.now}
          testID="unload.finish"
        />
      </>
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
                  count={
                    view.status === 'COMPLETED' ? (
                      <NoticeStrip tone="success" icon="ok" message={t('driver.trip.finished')} testID="unload.state" />
                    ) : (
                      <NoticeStrip tone="neutral" message={t('driver.steps.closed')} testID="unload.state" />
                    )
                  }
                  testID="unload"
                />
              );
            }
            return (
              <StepFrame
                title={title}
                control={<Text testID="unload.hint">{t('driver.unload.hint')}</Text>}
                count={
                  progress.total > 0 ? (
                    <CountBar
                      count={progress.done}
                      total={progress.total}
                      verb={t('scan.verb.UNLOAD')}
                      testID="unload.count"
                    />
                  ) : (
                    <NoticeStrip tone="success" icon="ok" message={t('driver.van.nothing')} testID="unload.count" />
                  )
                }
                details={progress.rows ? <UnloadGroups rows={progress.rows} /> : <UnloadGroupCounts trip={view} />}
                testID="unload"
              />
            );
          }}
        </QueryBoundary>
      )}
      {finish.sheets}
    </DriverScreen>
  );
}

/** The cylinders by group, each headed "Empty · 1"; received rows tick, turn grey and move to the end. */
function UnloadGroups({ rows }: { rows: readonly UnloadRow[] }) {
  const { t } = useTranslation();
  const groups = UNLOAD_GROUPS.map((group) => ({
    group,
    rows: rows
      .filter((row) => groupOf(row) === group)
      .sort((a, b) => Number(a.received) - Number(b.received) || a.shortCode.localeCompare(b.shortCode)),
  })).filter((entry) => entry.rows.length > 0);

  return (
    <View style={styles.groups} testID="unload.groups">
      {groups.map((entry) => (
        <View key={entry.group} style={styles.group} accessibilityRole="list">
          <Text variant="heading" tabular>
            {t('driver.groupCount', { group: t(`driver.unload.group.${entry.group}`), n: ltr(String(entry.rows.length)) })}
          </Text>
          {entry.rows.map((row) => (
            <View key={row.shortCode} style={styles.row} accessible testID={`unload.row.${row.shortCode}`}>
              <Icon name={row.received ? 'ok' : 'cylinder'} size={24} tone={row.received ? 'success' : 'brand'} />
              <Text variant={row.received ? 'body' : 'bodyStrong'} tone={row.received ? 'secondary' : 'default'} tabular style={styles.fill}>
                {t('driver.visit.item', { shortCode: ltr(row.shortCode), size: row.sizeLabel })}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * The groups from the counts alone, while the trip doesn't list each cylinder: one line per group with
 * what is still on the van ("Not delivered · 3"), going down as the shop scans them in.
 */
function UnloadGroupCounts({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const counts = unloadGroupCounts(trip);
  if (!counts) return null;
  const groups = UNLOAD_GROUPS.filter((group) => counts[group] > 0);
  if (groups.length === 0) return null;
  return (
    <View style={styles.group} testID="unload.groups">
      {groups.map((group) => (
        <View key={group} style={styles.row} accessible testID={`unload.group.${group}`}>
          <Icon name="cylinder" size={24} tone="brand" />
          <Text variant="bodyStrong" tabular style={styles.fill}>
            {t('driver.groupCount', { group: t(`driver.unload.group.${group}`), n: ltr(String(counts[group])) })}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  groups: { gap: space.lg },
  group: { gap: space.sm },
  row: {
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
  fill: { flex: 1 },
});
