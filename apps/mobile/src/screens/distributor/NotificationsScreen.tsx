import { FlatList, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Caption, Heading, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'primary' | 'neutral'> = {
  PENDING: 'warn',
  CONFIRMED: 'primary',
  ASSIGNED: 'primary',
  IN_TRANSIT: 'primary',
  DELIVERED: 'ok',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

/**
 * Lightweight notifications feed. For v1 this is a roll-up of recent order
 * status changes + filling-order updates; a dedicated notifications table
 * can replace this later without changing the UI.
 */
export function NotificationsScreen() {
  const nav = useNavigation<any>();
  const orders = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
    refetchInterval: 20000,
  });
  const filling = useQuery({
    queryKey: ['my-filling-orders'],
    queryFn: async () => (await api.get('/filling-orders/mine')).data,
    refetchInterval: 20000,
  });

  type Item = { id: string; kind: 'order' | 'filling'; title: string; subtitle: string; status: string; at: string; orderId?: string };
  const items: Item[] = [];

  for (const o of orders.data ?? []) {
    items.push({
      id: 'order-' + o.id,
      kind: 'order',
      title: `Order: ${o.client?.name ?? 'customer'}`,
      subtitle: `${(o.lines ?? []).reduce((s: number, l: any) => s + l.fullCount, 0)} cyl · ${o.deliveryAddressLabel}`,
      status: o.status,
      at: o.updatedAt ?? o.createdAt,
      orderId: o.id,
    });
  }
  for (const f of filling.data ?? []) {
    items.push({
      id: 'fill-' + f.id,
      kind: 'filling',
      title: `Refill: ${f.cylinderType?.name ?? ''}`,
      subtitle: `${f.requestedCount} cyl → ${f.serviceType === 'DIY' ? (f.ownStationName ?? 'DIY') : f.fillingStation?.name ?? ''}`,
      status: f.status,
      at: f.updatedAt ?? f.createdAt,
    });
  }
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Screen>
      <Heading size="h2" style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>Notifications</Heading>
      <Caption style={{ paddingHorizontal: space.lg, marginBottom: space.sm }}>
        Recent order and refill updates.
      </Caption>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListEmptyComponent={
          <View style={{ padding: space.lg }}>
            <Body muted>Nothing new yet — place an order to see updates here.</Body>
          </View>
        }
        renderItem={({ item }) => (
          <View
            onTouchEnd={() => item.orderId && nav.navigate('TrackOrder', { orderId: item.orderId })}
            style={{
              padding: space.md, borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5fb', alignItems: 'center', justifyContent: 'center' }}>
              <Body style={{ fontSize: 18 }}>{item.kind === 'order' ? '📦' : '⛽'}</Body>
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
