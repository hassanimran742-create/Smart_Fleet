import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ApiError } from '../../api/errors';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { Card, EmptyState, Icon, QueryBoundary, SkeletonCard, Text, colors, ltr, space } from '../../ui';
import { DriverScreen, usePullToRefresh } from './components';
import { sizeLabelOfType, useCylinderTypes } from './sizes';
import { VAN_QUERY_KEY } from './tripApi';

/** One size on the van (`GET /inventory/my-vehicle`, counted from the cylinders; API_CONTRACT Appendix A). */
interface VanSizeRow {
  cylinderTypeId: string;
  code: string;
  name: string;
  full: number;
  empty: number;
  partFilled: number;
}

/**
 * What is on the driver's van now. `noVehicle` when the office hasn't given one. `cylinders` (each one's
 * number, size and state) is read once the server sends it (requested for R9's numbers line); without
 * it each size shows its count only.
 */
interface MyVan {
  vehicleId: string | null;
  plateNo: string | null;
  totalFull: number;
  totalEmpty: number;
  totalPartFilled?: number;
  byType: VanSizeRow[];
  noVehicle?: boolean;
  cylinders?: { shortCode: string; cylinderTypeId: string; state: string }[];
}

/** The counts move while the driver scans, so the van polls while My van is open. */
const VAN_POLL_MS = 10_000;

async function fetchMyVan(): Promise<MyVan> {
  const { data } = await api.get<MyVan>('/inventory/my-vehicle');
  return data;
}

/** My van's groups, in this order (R9); a group with nothing in it is hidden. */
const GROUPS = [
  { state: 'FULL', count: (row: VanSizeRow) => row.full },
  { state: 'EMPTY', count: (row: VanSizeRow) => row.empty },
  { state: 'PART_FILLED', count: (row: VanSizeRow) => row.partFilled ?? 0 },
] as const;

/**
 * My van (driver spec D15 and R9): the plate, the big total ("3" + "cylinders"), then the cylinders by
 * state (Full, Empty, Part-filled), one row per size ("11.8 kg · 2") with the cylinder numbers on one
 * grey line under it once the server sends them ("AG-C0001, AG-C0002"). No capacity bar, no percentage,
 * no money. Without a van: "No van yet." and Call office. It polls every 10 seconds while on screen.
 */
export function VanScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const types = useCylinderTypes();
  const van = useQuery<MyVan, ApiError>({
    queryKey: VAN_QUERY_KEY,
    queryFn: fetchMyVan,
    refetchInterval: useFocusedInterval(VAN_POLL_MS),
  });
  const pull = usePullToRefresh(van.refetch);

  const sizeOf = (row: VanSizeRow): string => {
    const type = types.find((candidate) => candidate.id === row.cylinderTypeId);
    return type ? sizeLabelOfType(type, t) : row.name;
  };

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <QueryBoundary query={van} skeleton={<SkeletonCard lines={3} />}>
        {(load) => {
          if (load.noVehicle || !load.vehicleId) {
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
          const total = load.totalFull + load.totalEmpty + (load.totalPartFilled ?? 0);
          return (
            <Card testID="van.card">
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
                  {GROUPS.map((group) => {
                    const rows = load.byType.filter((row) => group.count(row) > 0);
                    if (rows.length === 0) return null;
                    return (
                      <View key={group.state} style={styles.group} accessibilityRole="list" testID={`van.group.${group.state}`}>
                        <Text variant="heading">{t(`driver.van.group.${group.state}`)}</Text>
                        {rows.map((row) => {
                          const numbers = (load.cylinders ?? [])
                            .filter((cylinder) => cylinder.cylinderTypeId === row.cylinderTypeId && cylinder.state === group.state)
                            .map((cylinder) => ltr(cylinder.shortCode))
                            .join(', ');
                          return (
                            <View key={row.cylinderTypeId} style={styles.sizeRow} accessible>
                              <Text variant="bodyStrong" tabular>
                                {t('driver.van.sizeCount', { size: sizeOf(row), n: ltr(String(group.count(row))) })}
                              </Text>
                              {numbers ? (
                                <Text tone="secondary" tabular>
                                  {numbers}
                                </Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </>
              )}
            </Card>
          );
        }}
      </QueryBoundary>
    </DriverScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nothing: { marginTop: space.md },
  total: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm, marginTop: space.md },
  totalWord: { flexShrink: 1 },
  group: { gap: space.xs, marginTop: space.lg },
  sizeRow: {
    gap: space.xs,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
