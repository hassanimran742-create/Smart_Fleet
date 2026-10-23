import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import { useFocusedInterval } from '../hooks/useFocusedInterval';
import { Card, Icon, QueryBoundary, SkeletonCard, Text, colors, space, ltr } from '../ui';

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

/** Shared by Home, My van and the scans (which refresh it after each move). */
export const VAN_LOAD_QUERY_KEY = ['driver', 'vanLoad'] as const;
/** The counts move while the driver scans, so the card polls while it is on screen. */
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

/**
 * The cylinders on the driver's van, full and empty, by size. `compact` is the one-line card on Home;
 * the full card (My van) lists each size. Loading, error-with-retry and stale states come from
 * QueryBoundary; without a van it says "No van is assigned to you. Call the office."
 */
export function VehicleLoad({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const query = useVanLoad();

  return (
    <QueryBoundary query={query} skeleton={<SkeletonCard lines={compact ? 1 : 3} />}>
      {(load) => {
        if (load.noVehicle || !load.vehicleId) {
          return (
            <Card testID="vanLoad.none">
              <View style={styles.row}>
                <Icon name="van" size={32} tone="secondary" />
                <Text style={styles.fill}>{t('driver.van.none')}</Text>
              </View>
            </Card>
          );
        }

        const plate = load.plateNo ? t('driver.van.plate', { plate: ltr(load.plateNo) }) : t('driver.van.title');
        const counts = t('driver.van.counts', { full: load.totalFull, empty: load.totalEmpty });

        if (compact) {
          return (
            <Card testID="vanLoad.compact" accessibilityLabel={`${plate}, ${counts}`}>
              <View style={styles.row}>
                <Icon name="van" size={32} tone="brand" />
                <View style={styles.fill}>
                  <Text variant="bodyStrong">{plate}</Text>
                  <Text tone="secondary" tabular>
                    {counts}
                  </Text>
                </View>
              </View>
            </Card>
          );
        }

        const total = load.totalFull + load.totalEmpty;
        return (
          <Card testID="vanLoad.full">
            <View style={styles.header}>
              <Text variant="title">{plate}</Text>
              <Text tone="secondary" tabular>
                {t('driver.van.total', { count: total })}
              </Text>
            </View>
            {load.byType.length === 0 ? (
              <Text tone="secondary">{t('driver.van.nothing')}</Text>
            ) : (
              <View accessibilityRole="list">
                <View style={[styles.tableRow, styles.tableHead]}>
                  <Text variant="label" tone="secondary" style={styles.sizeCell}>
                    {t('driver.van.size')}
                  </Text>
                  <Text variant="label" tone="secondary" style={styles.countCell} align="right">
                    {t('driver.van.full')}
                  </Text>
                  <Text variant="label" tone="secondary" style={styles.countCell} align="right">
                    {t('driver.van.empty')}
                  </Text>
                </View>
                {load.byType.map((row) => (
                  <View
                    key={row.cylinderTypeId}
                    style={styles.tableRow}
                    accessible
                    accessibilityLabel={`${row.name}, ${t('driver.van.counts', { full: row.full, empty: row.empty })}`}
                  >
                    <Text style={styles.sizeCell}>{row.name}</Text>
                    <Text variant="bodyStrong" tone="success" tabular style={styles.countCell} align="right">
                      {row.full}
                    </Text>
                    <Text variant="bodyStrong" tone="warning" tabular style={styles.countCell} align="right">
                      {row.empty}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        );
      }}
    </QueryBoundary>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  fill: { flex: 1 },
  header: { gap: space.xs, marginBottom: space.md },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHead: { paddingTop: 0 },
  sizeCell: { flex: 2 },
  countCell: { flex: 1 },
});
