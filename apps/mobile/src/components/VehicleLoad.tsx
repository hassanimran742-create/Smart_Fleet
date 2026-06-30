import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Body, Caption, Card, Heading, Pill } from './ui';
import { colors, space } from '../theme';

interface TypeRow {
  cylinderTypeId: string;
  code: string;
  name: string;
  full: number;
  empty: number;
}
interface Summary {
  vehicleId: string | null;
  plateNo: string | null;
  totalFull: number;
  totalEmpty: number;
  byType: TypeRow[];
  noVehicle?: boolean;
}

/**
 * Live snapshot of what's loaded on the driver's vehicle right now —
 * full vs empty, broken down by cylinder type. Auto-refreshes so the
 * counts move as the driver scans cylinders on / off the vehicle.
 *
 * `compact` renders a one-line summary card (for the Home screen);
 * the full version renders a per-type table (for Vehicle Info).
 */
export function VehicleLoad({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ['my-vehicle-load'],
    queryFn: async () => (await api.get('/inventory/my-vehicle')).data,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <Card>
        <Caption>Loading vehicle load…</Caption>
      </Card>
    );
  }

  if (!data || data.noVehicle || !data.vehicleId) {
    return (
      <Card>
        <Heading size="h3">Vehicle load</Heading>
        <Caption style={{ marginTop: space.sm }}>
          No vehicle assigned. Ask admin to assign one before loading cylinders.
        </Caption>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Caption>ON VEHICLE {data.plateNo ? `· ${data.plateNo}` : ''}</Caption>
            <Body style={{ fontWeight: '700', marginTop: 2 }}>
              {data.totalFull} full · {data.totalEmpty} empty
            </Body>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill label={`${data.totalFull} full`} tone="ok" />
            <Pill label={`${data.totalEmpty} empty`} tone="warn" />
          </View>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading size="h3">Vehicle load</Heading>
        <Caption>{data.plateNo}</Caption>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: space.sm }}>
        <Pill label={`${data.totalFull} full`} tone="ok" />
        <Pill label={`${data.totalEmpty} empty`} tone="warn" />
        <Pill label={`${data.totalFull + data.totalEmpty} total`} tone="neutral" />
      </View>

      {data.byType.length === 0 ? (
        <Caption style={{ marginTop: space.md }}>
          Nothing loaded yet. Scan cylinders with “Load on vehicle” to add them here.
        </Caption>
      ) : (
        <View style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Caption style={{ flex: 2 }}>TYPE</Caption>
            <Caption style={{ flex: 1, textAlign: 'right' }}>FULL</Caption>
            <Caption style={{ flex: 1, textAlign: 'right' }}>EMPTY</Caption>
          </View>
          {data.byType.map((r) => (
            <View key={r.cylinderTypeId} style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f2f5' }}>
              <Body style={{ flex: 2 }}>{r.name}</Body>
              <Body style={{ flex: 1, textAlign: 'right', fontWeight: '700', color: colors.ok }}>{r.full}</Body>
              <Body style={{ flex: 1, textAlign: 'right', fontWeight: '700', color: colors.warn }}>{r.empty}</Body>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
