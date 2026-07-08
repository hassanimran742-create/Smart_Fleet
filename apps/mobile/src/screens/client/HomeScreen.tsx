import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Being prepared',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Driver assigned',
  IN_TRANSIT: 'On the way',
  DELIVERED: 'Arrived — confirm',
};
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'primary' | 'neutral'> = {
  PENDING: 'neutral',
  CONFIRMED: 'primary',
  ASSIGNED: 'primary',
  IN_TRANSIT: 'warn',
  DELIVERED: 'ok',
};
const ACTIVE = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'];

export function ClientHomeScreen() {
  const nav = useNavigation<any>();
  const active = useQuery({
    queryKey: ['client-active'],
    queryFn: async () => (await api.get('/client-portal/active')).data,
    refetchInterval: 15000,
  });
  const all = useQuery({
    queryKey: ['client-orders'],
    queryFn: async () => (await api.get('/client-portal/orders')).data,
    refetchInterval: 30000,
  });

  const activeOrders = active.data ?? [];
  const pastOrders = (all.data ?? []).filter(
    (o: any) => !ACTIVE.includes(o.status) || o.clientConfirmedAt,
  );

  return (
    <Screen scroll>
      {/* Active deliveries */}
      {activeOrders.length > 0 ? (
        <>
          <Heading size="h2" style={{ marginBottom: space.sm }}>Incoming deliveries</Heading>
          {activeOrders.map((o: any) => {
            const items = (o.lines ?? []).reduce((s: number, l: any) => s + (l.fullCount ?? 0), 0);
            const empties = (o.lines ?? []).reduce((s: number, l: any) => s + (l.expectedReturnCount ?? 0), 0);
            const isHere = o.status === 'DELIVERED';
            return (
              <Pressable
                key={o.id}
                onPress={() => nav.navigate('DeliveryDetail', { orderId: o.id })}
                style={({ pressed }: any) => ({
                  backgroundColor: isHere ? '#ecfdf5' : colors.surface,
                  borderWidth: isHere ? 2 : 1,
                  borderColor: isHere ? colors.ok : colors.border,
                  borderRadius: radius.lg,
                  padding: space.lg,
                  marginBottom: space.sm,
                  opacity: pressed ? 0.85 : 1,
                  ...shadow.card,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Body style={{ fontSize: 36 }}>{isHere ? '🚚' : '📦'}</Body>
                  <View style={{ flex: 1 }}>
                    <Heading size="h3">
                      {items} cylinder{items === 1 ? '' : 's'}
                    </Heading>
                    <Caption style={{ marginTop: 2 }}>
                      From {o.distributor?.businessName ?? 'distributor'}
                    </Caption>
                    {empties > 0 && (
                      <Caption style={{ marginTop: 2, color: '#92400E' }}>
                        + return {empties} empty
                      </Caption>
                    )}
                  </View>
                  <Pill
                    label={STATUS_LABEL[o.status] ?? o.status}
                    tone={STATUS_TONE[o.status] ?? 'neutral'}
                  />
                </View>
                {isHere && (
                  <View style={{ marginTop: space.md, backgroundColor: colors.ok, borderRadius: radius.md, padding: space.md, alignItems: 'center' }}>
                    <Body style={{ color: 'white', fontWeight: '700' }}>
                      Driver is here — tap to confirm
                    </Body>
                  </View>
                )}
              </Pressable>
            );
          })}
        </>
      ) : (
        <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
          <Body style={{ fontSize: 48, marginBottom: space.md }}>📦</Body>
          <Heading size="h3">No active deliveries</Heading>
          <Caption style={{ marginTop: space.sm, textAlign: 'center' }}>
            When your distributor sends cylinders, they'll show up here.
          </Caption>
        </Card>
      )}

      {/* Past deliveries */}
      {pastOrders.length > 0 && (
        <>
          <Heading size="h3" style={{ marginTop: space.lg, marginBottom: space.sm }}>
            Past deliveries
          </Heading>
          {pastOrders.slice(0, 10).map((o: any) => {
            const items = (o.lines ?? []).reduce((s: number, l: any) => s + (l.fullCount ?? 0), 0);
            return (
              <Pressable
                key={o.id}
                onPress={() => nav.navigate('DeliveryDetail', { orderId: o.id })}
                style={({ pressed }: any) => ({
                  backgroundColor: colors.surface,
                  borderRadius: radius.md, padding: space.md,
                  marginBottom: 6, opacity: pressed ? 0.85 : 1,
                  borderWidth: 1, borderColor: colors.border,
                })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: '600' }}>
                      {items} cyl · {o.distributor?.businessName}
                    </Body>
                    <Caption>{new Date(o.createdAt).toLocaleDateString()}</Caption>
                  </View>
                  <Pill
                    label={o.clientConfirmedAt ? 'Confirmed' : o.status}
                    tone={o.clientConfirmedAt ? 'ok' : 'neutral'}
                  />
                </View>
              </Pressable>
            );
          })}
        </>
      )}
    </Screen>
  );
}
