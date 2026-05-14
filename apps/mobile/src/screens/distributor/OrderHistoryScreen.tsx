import { FlatList, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Caption, Heading, Pill } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'primary' | 'neutral'> = {
  PENDING: 'warn',
  CONFIRMED: 'primary',
  ASSIGNED: 'primary',
  IN_TRANSIT: 'primary',
  DELIVERED: 'ok',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

export function OrderHistoryScreen() {
  const nav = useNavigation<any>();
  const { data } = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
    refetchInterval: 20000,
  });

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={data ?? []}
      keyExtractor={(o: any) => o.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      renderItem={({ item }) => {
        const items = (item.lines ?? []).reduce((s: number, l: any) => s + (l.fullCount ?? 0), 0);
        return (
          <Pressable
            onPress={() => nav.navigate('TrackOrder', { orderId: item.id })}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: space.lg,
              ...shadow.card,
            })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, marginRight: space.sm }}>
                <Heading size="h3">{item.deliveryAddressLabel}</Heading>
                <Caption style={{ marginTop: 2 }}>
                  {items} cylinder{items === 1 ? '' : 's'} · {new Date(item.createdAt).toLocaleString()}
                </Caption>
              </View>
              <Pill label={item.status} tone={STATUS_TONE[item.status] ?? 'neutral'} />
            </View>
            {item.paymentStatus !== 'UNPAID' && (
              <Pill label={item.paymentStatus} tone={item.paymentStatus === 'PAID_VIA_LEDGER' ? 'ok' : 'primary'} style={{ marginTop: space.sm }} />
            )}
            <Caption style={{ marginTop: space.sm, color: colors.primary }}>Tap to track →</Caption>
          </Pressable>
        );
      }}
    />
  );
}
