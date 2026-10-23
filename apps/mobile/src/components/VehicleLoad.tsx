import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import { useOfficeContact } from '../hooks/useAppConfig';
import { useFocusedInterval } from '../hooks/useFocusedInterval';
import { Card, EmptyState, Icon, ListRow, QueryBoundary, SkeletonCard, Text, colors, ltr, radius, space } from '../ui';

/** One size on the van (`GET /inventory/my-vehicle`). */
export interface VanLoadRow {
  cylinderTypeId: string;
  code: string;
  name: string;
  full: number;
  empty: number;
}

/** What is on the driver's van right now, by size. `noVehicle` when the office hasn't given one. */
export interface VanLoad {
  vehicleId: string | null;
  plateNo: string | null;
  totalFull: number;
  totalEmpty: number;
  byType: VanLoadRow[];
  noVehicle?: boolean;
}

/** Shared by Today, My van, the Trip screen and the scans (which refresh it after each move). */
export const VAN_LOAD_QUERY_KEY = ['driver', 'vanLoad'] as const;
/** The counts move while the driver scans, so the van polls while a screen shows it. */
const VAN_LOAD_POLL_MS = 10_000;

export async function fetchVanLoad(): Promise<VanLoad> {
  const { data } = await api.get<VanLoad>('/inventory/my-vehicle');
  return data;
}

/** The van's load, polled while the screen is focused. */
export function useVanLoad(): UseQueryResult<VanLoad, ApiError> {
  return useQuery<VanLoad, ApiError>({
    queryKey: VAN_LOAD_QUERY_KEY,
    queryFn: fetchVanLoad,
    refetchInterval: useFocusedInterval(VAN_LOAD_POLL_MS),
  });
}

function hasVan(load: VanLoad): boolean {
  return !load.noVehicle && Boolean(load.vehicleId);
}

/** The cylinders on the van, or null while unknown. No van counts as an empty one. */
export function vanTotal(load: VanLoad | null | undefined): number | null {
  if (!load) return null;
  return hasVan(load) ? load.totalFull + load.totalEmpty : 0;
}

/**
 * "3 full · 1 empty" with the zeros hidden; "" when both are 0. Each part is a whole phrase, so " · "
 * is the one join the copy rules allow (driver spec §6).
 */
export function vanCounts(full: number, empty: number, t: TFunction): string {
  const parts: string[] = [];
  if (full > 0) parts.push(t('driver.van.fullCount', { count: full }));
  if (empty > 0) parts.push(t('driver.van.emptyCount', { count: empty }));
  return parts.join(' · ');
}

/**
 * Today's van row (driver spec D4): the plate and what is on the van, a tap opens My van. While the
 * van hasn't loaded it is a skeleton; when it can't load it is hidden, because the trips below already
 * say what is wrong (one message, not two).
 */
export function VanRow({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const query = useVanLoad();
  const load = query.data;
  if (!load) return query.isError ? null : <SkeletonCard lines={1} />;

  if (!hasVan(load)) {
    return (
      <ListRow
        title={t('driver.van.none')}
        leadingIcon="van"
        chevron
        onPress={onPress}
        style={styles.row}
        testID="home.van"
      />
    );
  }
  const plate = load.plateNo ? ltr(load.plateNo) : t('common.menu.van');
  const counts = vanCounts(load.totalFull, load.totalEmpty, t) || t('driver.van.noCylinders');
  return (
    <ListRow
      title={plate}
      subtitle={counts}
      leadingIcon="van"
      chevron
      onPress={onPress}
      accessibilityLabel={`${t('driver.van.plate', { plate })}, ${counts}`}
      style={styles.row}
      testID="home.van"
    />
  );
}

/**
 * My van (driver spec D15): the plate, the big total and one row per size with its counts at the end,
 * zeros hidden, in plain text (amber means waiting). Without a van: "No van yet." and Call office.
 * Loading, the saved strip and errors come from QueryBoundary.
 */
export function VehicleLoad() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const query = useVanLoad();

  return (
    <QueryBoundary query={query} skeleton={<SkeletonCard lines={3} />}>
      {(load) => {
        if (!hasVan(load)) {
          return (
            <EmptyState
              icon="van"
              title={t('driver.van.none')}
              action={
                office.phone ? { label: t('common.actions.callOffice'), icon: 'call', onPress: office.call } : undefined
              }
            />
          );
        }

        const total = load.totalFull + load.totalEmpty;
        return (
          <Card testID="vanLoad.full">
            <View style={styles.plateRow}>
              <Icon name="van" size={32} tone="brand" />
              <Text variant="title" style={styles.fill}>
                {load.plateNo ? ltr(load.plateNo) : t('common.menu.van')}
              </Text>
            </View>
            {total === 0 ? (
              <Text variant="bodyStrong" style={styles.nothing}>
                {t('driver.van.nothing')}
              </Text>
            ) : (
              <>
                <View style={styles.total} accessible>
                  <Text variant="display" tabular>
                    {ltr(String(total))}
                  </Text>
                  <Text variant="heading" style={styles.totalWord}>
                    {t('driver.van.total', { count: total })}
                  </Text>
                </View>
                <View accessibilityRole="list">
                  {load.byType.map((row) => (
                    <View key={row.cylinderTypeId} style={styles.sizeRow} accessible>
                      <Text variant="bodyStrong" style={styles.fill}>
                        {row.name}
                      </Text>
                      <Text tabular>{vanCounts(row.full, row.empty, t)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Card>
        );
      }}
    </QueryBoundary>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  fill: { flex: 1 },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nothing: { marginTop: space.md },
  total: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm, marginTop: space.md },
  totalWord: { flexShrink: 1 },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
