import { useMemo, useState } from 'react';
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

const CURRENT_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT'];

export function OrderHistoryScreen() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const { data } = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
    refetchInterval: 20000,
  });

  const filtered = useMemo(() => {
    const all = data ?? [];
    return tab === 'current'
      ? all.filter((o: any) => CURRENT_STATUSES.includes(o.status))
      : all.filter((o: any) => !CURRENT_STATUSES.includes(o.status));
  }, [data, tab]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', padding: space.md, gap: 6 }}>
        <TabBtn label={`Current (${(data ?? []).filter((o: any) => CURRENT_STATUSES.includes(o.status)).length})`} active={tab === 'current'} onPress={() => setTab('current')} />
        <TabBtn label="History" active={tab === 'history'} onPress={() => setTab('history')} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(o: any) => o.id}
        contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.sm }}
        ListEmptyComponent={
          <View style={{ padding: space.lg, alignItems: 'center' }}>
            <Body muted>{tab === 'current' ? 'No active orders.' : 'No past orders.'}</Body>
          </View>
        }
        renderItem={({ item }) => {
          const items = (item.lines ?? []).reduce((s: number, l: any) => s + (l.fullCount ?? 0), 0);
          const returns = (item.lines ?? []).reduce((s: number, l: any) => s + (l.expectedReturnCount ?? 0), 0);
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
                  <Heading size="h3">{item.client?.name ?? item.deliveryAddressLabel}</Heading>
                  <Caption style={{ marginTop: 2 }}>
                    {items} cylinder{items === 1 ? '' : 's'}
                    {returns > 0 ? ` · pick up ${returns} empt${returns === 1 ? 'y' : 'ies'}` : ''}
                  </Caption>
                  <Caption style={{ marginTop: 2 }} numberOfLines={1}>
                    {item.deliveryAddressLabel}
                  </Caption>
                  <Caption style={{ marginTop: 4, color: colors.textMuted }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </Caption>
                </View>
                <Pill label={item.status} tone={STATUS_TONE[item.status] ?? 'neutral'} />
              </View>
              {item.paymentStatus !== 'UNPAID' && (
                <Pill label={item.paymentStatus} tone={item.paymentStatus === 'PAID_VIA_LEDGER' ? 'ok' : 'primary'} style={{ marginTop: space.sm }} />
              )}
              {tab === 'current' && (
                <Caption style={{ marginTop: space.sm, color: colors.primary }}>Tap to track →</Caption>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        flex: 1,
        paddingVertical: 10,
        borderRadius: radius.md,
        backgroundColor: active ? colors.primary : colors.surface,
        borderWidth: 1, borderColor: active ? colors.primary : colors.border,
        opacity: pressed ? 0.85 : 1, alignItems: 'center',
      })}
    >
      <Body style={{ fontWeight: '600', color: active ? 'white' : colors.text }}>{label}</Body>
    </Pressable>
  );
}
