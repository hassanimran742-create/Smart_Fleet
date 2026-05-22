import { Alert, FlatList, Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

const STOP_LABEL: Record<string, string> = {
  STORE_PICKUP: 'Pick up from store',
  DELIVERY: 'Deliver to client',
  RETURN_TO_STORE: 'Return empties to store',
};

export function ActiveTripScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const tripId = route.params?.tripId;
  const qc = useQueryClient();

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => (await api.get(`/trips/${tripId}`)).data,
    enabled: !!tripId,
    refetchInterval: 10000,
  });

  const setTripStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/trips/${tripId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });
  const setOrderStatus = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });

  if (!trip) return <Screen><Body muted>Loading…</Body></Screen>;

  function openNav(stop: any) {
    const loc = stop.location?.coordinates;
    if (!loc) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${loc[1]},${loc[0]}`);
  }
  function goScan(stop: any, eventType: string) {
    nav.navigate('Scan', { eventType, tripId, orderId: stop.orderId });
  }

  // Look up the matching order for a delivery stop so we can show empty-pickup info.
  const ordersById: Record<string, any> = {};
  for (const o of trip.orders ?? []) ordersById[o.id] = o;

  return (
    <Screen scroll>
      <Card>
        <Caption>TRIP</Caption>
        <Heading size="h2" style={{ marginTop: 2 }}>{trip.id.slice(0, 8)}</Heading>
        <Pill label={trip.status} tone={trip.status === 'IN_PROGRESS' ? 'warn' : 'primary'} style={{ marginTop: space.sm }} />
        {trip.status === 'PLANNED' && (
          <Button title="Start trip" onPress={() => setTripStatus.mutate('IN_PROGRESS')} style={{ marginTop: space.md }} />
        )}
        {trip.status === 'IN_PROGRESS' && (
          <Button
            title="✓ Complete trip"
            variant="success"
            onPress={() => Alert.alert('Complete?', 'Make sure every stop is done.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Complete', onPress: () => setTripStatus.mutate('COMPLETED') },
            ])}
            style={{ marginTop: space.md }}
          />
        )}
      </Card>

      {(trip.stops ?? []).map((stop: any) => {
        const order = stop.orderId ? ordersById[stop.orderId] : null;
        const expectedEmpties = order
          ? (order.lines ?? []).reduce((s: number, l: any) => s + (l.expectedReturnCount ?? 0), 0)
          : 0;
        const isDelivery = stop.stopType === 'DELIVERY';
        const isPickup = stop.stopType === 'STORE_PICKUP';
        return (
          <Card key={stop.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Caption>STOP {stop.seq + 1}</Caption>
                <Heading size="h3" style={{ marginTop: 2 }}>{STOP_LABEL[stop.stopType] ?? stop.stopType}</Heading>
                {order && (
                  <>
                    <Caption style={{ marginTop: 4 }}>
                      Client: <Body style={{ fontWeight: '600' }}>{order.client?.name ?? '—'}</Body>
                    </Caption>
                    <Caption style={{ marginTop: 2 }} numberOfLines={2}>{order.deliveryAddressLabel}</Caption>
                  </>
                )}
              </View>
            </View>

            {/* Empties to pick up — only relevant at delivery */}
            {isDelivery && expectedEmpties > 0 && (
              <View style={{ marginTop: space.sm, padding: space.sm, backgroundColor: '#fffbea', borderRadius: radius.md, borderWidth: 1, borderColor: '#fde68a' }}>
                <Body style={{ fontWeight: '700', color: '#92400E' }}>
                  📦 Pick up {expectedEmpties} empty cylinder{expectedEmpties === 1 ? '' : 's'} from this client
                </Body>
                <Caption style={{ marginTop: 2, color: '#92400E' }}>
                  Scan each empty before leaving so it's recorded as collected.
                </Caption>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.md }}>
              <Pressable
                onPress={() => openNav(stop)}
                style={({ pressed }: any) => ({ flex: 1, padding: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', opacity: pressed ? 0.85 : 1, ...shadow.card })}
              >
                <Body style={{ fontWeight: '600' }}>🧭 Navigate</Body>
              </Pressable>

              {isPickup && (
                <Pressable
                  onPress={() => goScan(stop, 'SCAN_OUT')}
                  style={({ pressed }: any) => ({ flex: 1, padding: space.sm, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', opacity: pressed ? 0.85 : 1, ...shadow.card })}
                >
                  <Body style={{ fontWeight: '600', color: 'white' }}>📷 Scan loading</Body>
                </Pressable>
              )}

              {isDelivery && (
                <>
                  <Pressable
                    onPress={() => goScan(stop, 'DELIVERED')}
                    style={({ pressed }: any) => ({ flex: 1, padding: space.sm, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', opacity: pressed ? 0.85 : 1, ...shadow.card })}
                  >
                    <Body style={{ fontWeight: '600', color: 'white' }}>📷 Scan delivered</Body>
                  </Pressable>
                  {expectedEmpties > 0 && (
                    <Pressable
                      onPress={() => goScan(stop, 'PICKED_UP_EMPTY')}
                      style={({ pressed }: any) => ({ flex: 1, padding: space.sm, backgroundColor: '#f59e0b', borderRadius: radius.md, alignItems: 'center', opacity: pressed ? 0.85 : 1, ...shadow.card })}
                    >
                      <Body style={{ fontWeight: '600', color: 'white' }}>📦 Scan empties</Body>
                    </Pressable>
                  )}
                </>
              )}
            </View>

            {isDelivery && stop.orderId && (
              <Button
                title="✓ Mark this delivery complete"
                variant="success"
                onPress={() => setOrderStatus.mutate({ orderId: stop.orderId, status: 'DELIVERED' })}
                style={{ marginTop: space.sm }}
              />
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
