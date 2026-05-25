import { Alert, Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

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

  if (!trip) return <Screen><Body muted>Loading…</Body></Screen>;

  const ordersById: Record<string, any> = {};
  for (const o of trip.orders ?? []) ordersById[o.id] = o;

  function openMap(stop: any) {
    const loc = stop?.location;
    if (!loc?.lat) return Alert.alert('No location');
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`);
  }

  return (
    <Screen scroll>
      {/* Trip header — minimal */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <View>
          <Heading size="h2">My trip</Heading>
          <Pill label={trip.status} tone={trip.status === 'IN_PROGRESS' ? 'warn' : 'ok'} style={{ marginTop: 4 }} />
        </View>
        {trip.status === 'PLANNED' && (
          <Button title="Start trip" onPress={() => setTripStatus.mutate('IN_PROGRESS')} fullWidth={false} />
        )}
        {trip.status === 'IN_PROGRESS' && (
          <Button
            title="✓ Finish"
            variant="success"
            fullWidth={false}
            onPress={() => Alert.alert('Done?', 'Make sure every stop is finished.', [
              { text: 'No', style: 'cancel' },
              { text: 'Yes', onPress: () => setTripStatus.mutate('COMPLETED') },
            ])}
          />
        )}
      </View>

      {/* Stops — one card each */}
      {(trip.stops ?? []).map((stop: any) => {
        const order = stop.orderId ? ordersById[stop.orderId] : null;
        const empties = order
          ? (order.lines ?? []).reduce((s: number, l: any) => s + (l.expectedReturnCount ?? 0), 0)
          : 0;
        const isDone = !!stop.departedAt;
        const isStore = stop.stopType === 'STORE_PICKUP';
        const emoji = isDone ? '✅' : isStore ? '🏪' : '🏠';
        const title = isStore
          ? 'Pick up at store'
          : order?.client?.name ?? 'Deliver';

        return (
          <Pressable
            key={stop.id}
            onPress={() => nav.navigate('DeliverySteps', { tripId, stopId: stop.id })}
            style={({ pressed }: any) => ({
              backgroundColor: isDone ? '#f0fdf4' : colors.surface,
              borderWidth: isDone ? 0 : 1,
              borderColor: colors.border,
              padding: space.lg, borderRadius: radius.lg,
              marginBottom: space.sm, opacity: pressed ? 0.85 : 1,
              ...shadow.card,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Body style={{ fontSize: 32 }}>{emoji}</Body>
              <View style={{ flex: 1 }}>
                <Heading size="h3">{title}</Heading>
                {order && (
                  <Caption style={{ marginTop: 2 }} numberOfLines={1}>
                    {order.deliveryAddressLabel}
                  </Caption>
                )}
                {!isStore && empties > 0 && (
                  <Caption style={{ marginTop: 2, color: '#92400E' }}>
                    + pick up {empties} empty
                  </Caption>
                )}
              </View>
              {isDone && <Body style={{ color: colors.ok, fontWeight: '700' }}>Done</Body>}
            </View>

            {!isDone && (
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); openMap(stop); }}
                  style={({ pressed }: any) => ({
                    flex: 1, padding: space.md,
                    backgroundColor: '#f1f5fb', borderRadius: radius.md,
                    alignItems: 'center', opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Body style={{ fontSize: 22 }}>🧭</Body>
                  <Caption style={{ marginTop: 4, fontWeight: '600' }}>Open map</Caption>
                </Pressable>
                <Pressable
                  onPress={() => nav.navigate('DeliverySteps', { tripId, stopId: stop.id })}
                  style={({ pressed }: any) => ({
                    flex: 1, padding: space.md,
                    backgroundColor: colors.primary, borderRadius: radius.md,
                    alignItems: 'center', opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Body style={{ fontSize: 22 }}>📋</Body>
                  <Caption style={{ marginTop: 4, fontWeight: '600', color: 'white' }}>
                    {isStore ? 'Scan & go' : 'Steps'}
                  </Caption>
                </Pressable>
              </View>
            )}
          </Pressable>
        );
      })}
    </Screen>
  );
}
