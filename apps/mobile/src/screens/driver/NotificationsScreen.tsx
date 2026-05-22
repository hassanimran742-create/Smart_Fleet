import { FlatList, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Caption, Heading, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'primary' | 'neutral'> = {
  PLANNED: 'primary',
  IN_PROGRESS: 'warn',
  COMPLETED: 'ok',
  REQUESTED: 'primary',
  IN_TRANSIT: 'warn',
  PENDING: 'warn',
  ASSIGNED: 'primary',
  DELIVERED: 'ok',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

/**
 * Driver's notification feed: rolled-up trip assignments, current order
 * statuses, transfer tasks, and filling-order assignments. Tapping any
 * row navigates to the relevant screen.
 */
export function DriverNotificationsScreen() {
  const nav = useNavigation<any>();
  const trips = useQuery({
    queryKey: ['my-trips'],
    queryFn: async () => (await api.get('/trips/mine')).data,
    refetchInterval: 20000,
  });
  const transfers = useQuery({
    queryKey: ['driver-transfers'],
    queryFn: async () => (await api.get('/transfers/mine')).data,
    refetchInterval: 30000,
  });
  const filling = useQuery({
    queryKey: ['driver-filling-mine'],
    queryFn: async () => (await api.get('/filling-orders/driver/mine')).data,
    refetchInterval: 30000,
  });

  type Item = {
    id: string;
    kind: 'trip' | 'transfer' | 'filling';
    title: string;
    subtitle: string;
    status: string;
    at: string;
    onPress: () => void;
  };

  const items: Item[] = [];
  for (const t of trips.data ?? []) {
    items.push({
      id: 'trip-' + t.id,
      kind: 'trip',
      title: `Trip ${t.id.slice(0, 8)}`,
      subtitle: `${t.stops?.length ?? 0} stops · ${t.orders?.length ?? 0} orders`,
      status: t.status,
      at: t.updatedAt ?? t.plannedAt ?? t.createdAt,
      onPress: () => nav.navigate('ActiveTrip', { tripId: t.id }),
    });
  }
  for (const x of transfers.data ?? []) {
    items.push({
      id: 'transfer-' + x.id,
      kind: 'transfer',
      title: 'Cylinder transfer',
      subtitle: `${x.fromStore?.name} → ${x.toStore?.name} · ${x.lines?.length ?? 0} cyl`,
      status: x.status,
      at: x.updatedAt ?? x.createdAt,
      onPress: () => nav.navigate('TransferDetail', { transferId: x.id }),
    });
  }
  for (const f of filling.data ?? []) {
    items.push({
      id: 'fill-' + f.id,
      kind: 'filling',
      title: `Refill · ${f.cylinderType?.code ?? ''}`,
      subtitle: `${f.requestedCount} cyl → ${f.fillingStation?.name ?? 'DIY'}`,
      status: f.status,
      at: f.updatedAt ?? f.createdAt,
      onPress: () => nav.navigate('FillingRuns'),
    });
  }
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Screen>
      <Heading size="h2" style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>Notifications</Heading>
      <Caption style={{ paddingHorizontal: space.lg, marginBottom: space.sm }}>
        Trip, transfer and refill updates.
      </Caption>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListEmptyComponent={
          <View style={{ padding: space.lg }}>
            <Body muted>Nothing new yet.</Body>
          </View>
        }
        renderItem={({ item }) => (
          <View
            onTouchEnd={item.onPress}
            style={{
              padding: space.md, borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5fb', alignItems: 'center', justifyContent: 'center' }}>
              <Body style={{ fontSize: 18 }}>
                {item.kind === 'trip' ? '🚚' : item.kind === 'transfer' ? '🔄' : '⛽'}
              </Body>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>{item.title}</Body>
              <Caption style={{ marginTop: 2 }} numberOfLines={2}>{item.subtitle}</Caption>
              <Caption style={{ marginTop: 4, color: colors.textMuted }}>
                {new Date(item.at).toLocaleString()}
              </Caption>
            </View>
            <Pill label={item.status} tone={STATUS_TONE[item.status] ?? 'neutral'} />
          </View>
        )}
      />
    </Screen>
  );
}
