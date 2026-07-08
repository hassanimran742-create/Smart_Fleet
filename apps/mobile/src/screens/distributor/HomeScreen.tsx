import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { Body, Button, Card, Caption, Heading, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

/**
 * Minimal distributor home — primary actions only, large tap targets.
 * Each tile uses an emoji to be readable by users with low literacy.
 */
export function DistributorHomeScreen() {
  const nav = useNavigation<any>();
  const { clear } = useAuthStore();
  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: async () => (await api.get('/ledger/balance')).data,
  });
  const orders = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
  });
  const inProgress = (orders.data ?? []).filter((o: any) =>
    ['PENDING', 'ASSIGNED', 'IN_TRANSIT'].includes(o.status),
  ).length;
  const delivered = (orders.data ?? []).filter((o: any) => o.status === 'DELIVERED').length;
  const balanceRs = balance.data ? Number(balance.data.balancePaisa) / 100 : 0;

  return (
    <Screen scroll>
      {/* Balance card — biggest, most important number */}
      <Card style={{ backgroundColor: colors.primary, alignItems: 'center', paddingVertical: space.xl }}>
        <Caption style={{ color: '#dbe7ff', textTransform: 'uppercase', letterSpacing: 1 }}>
          Your Balance
        </Caption>
        <Heading size="h1" style={{ color: 'white', fontSize: 36, marginTop: 6 }}>
          Rs. {balanceRs.toLocaleString()}
        </Heading>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Pill label={`${inProgress} in progress`} tone="warn" />
          <Pill label={`${delivered} delivered`} tone="ok" />
        </View>
      </Card>

      {/* Primary actions — big tiles */}
      <Tile
        emoji="📦"
        title="New Order"
        subtitle="Order cylinders for a customer"
        onPress={() => nav.navigate('PlaceOrder')}
        primary
      />
      <Tile
        emoji="🛒"
        title="My Orders"
        subtitle="See and track your orders"
        onPress={() => nav.navigate('OrderHistory')}
      />
      <Tile
        emoji="⛽"
        title="Refill Cylinders"
        subtitle="Send empties to filling station"
        onPress={() => nav.navigate('RequestFilling')}
      />
      <Tile
        emoji="💳"
        title="Top Up Balance"
        subtitle={`Add money — currently Rs. ${balanceRs.toLocaleString()}`}
        onPress={() => nav.navigate('Topup')}
      />

      <View style={{ marginTop: space.lg }}>
        <Button title="Sign out" variant="ghost" onPress={() => clear()} />
      </View>
    </Screen>
  );
}

function Tile({
  emoji, title, subtitle, onPress, primary = false,
}: {
  emoji: string; title: string; subtitle?: string; onPress: () => void; primary?: boolean;
}) {
  const { Pressable } = require('react-native');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        backgroundColor: primary ? colors.primary : colors.surface,
        borderRadius: 14,
        padding: 18,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: primary ? colors.primary : colors.border,
        opacity: pressed ? 0.85 : 1,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      })}
    >
      <View
        style={{
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: primary ? 'rgba(255,255,255,0.18)' : '#f1f5fb',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Body style={{ fontSize: 28 }}>{emoji}</Body>
      </View>
      <View style={{ flex: 1 }}>
        <Heading size="h3" style={{ color: primary ? 'white' : colors.text }}>{title}</Heading>
        {subtitle && (
          <Caption style={{ color: primary ? 'rgba(255,255,255,0.85)' : colors.textMuted, marginTop: 2 }}>
            {subtitle}
          </Caption>
        )}
      </View>
      <Body style={{ color: primary ? 'white' : colors.textMuted, fontSize: 22 }}>›</Body>
    </Pressable>
  );
}
