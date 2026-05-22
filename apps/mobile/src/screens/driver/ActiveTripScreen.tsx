import { Alert, Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

const STOP_LABEL: Record<string, string> = {
  STORE_PICKUP: 'Pickup from store',
  DELIVERY: 'Deliver to client',
  RETURN_DROPOFF: 'Return empties',
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

  if (!trip) return <Screen><Body muted>Loading…</Body></Screen>;

  const ordersById: Record<string, any> = {};
  for (const o of trip.orders ?? []) ordersById[o.id] = o;

  function openNav(stop: any) {
    const loc = stop?.location?.coordinates;
    if (!loc) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${loc[1]},${loc[0]}`);
  }
  function stepInto(stop: any) {
    nav.navigate('DeliverySteps', { tripId, stopId: stop.id });
  }

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
        const phaseLabel = !stop.arrivedAt
          ? 'NOT STARTED'
          : !stop.departedAt
            ? (stop.stopType === 'DELIVERY' ? 'AT CLIENT' : 'AT STORE')
            : 'DONE';
        const phaseTone =
          phaseLabel === 'DONE' ? 'ok'
          : phaseLabel === 'NOT STARTED' ? 'neutral' : 'warn';

        return (
          <Pressable
            key={stop.id}
            onPress={() => stepInto(stop)}
            style={({ pressed }: any) => ({
              backgroundColor: colors.surface,
              padding: space.lg, borderRadius: radius.lg,
              marginBottom: space.sm, opacity: pressed ? 0.85 : 1,
              ...shadow.card,
            })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Caption>STOP {stop.seq + 1}</Caption>
                <Heading size="h3" style={{ marginTop: 2 }}>{STOP_LABEL[stop.stopType] ?? stop.stopType}</Heading>
                {order && (
                  <>
                    <Caption style={{ marginTop: 4 }}>
                      Client: <Body style={{ fontWeight: '600' }}>{order.client?.name ?? '—'}</Body>
                    </Caption>
                    <Caption style={{ marginTop: 2 }} numberOfLines={2}>{order.deliveryAddressLabel}</Caption>
                    {expectedEmpties > 0 && (
                      <Caption style={{ marginTop: 4, color: '#92400E' }}>
                        📦 Pick up {expectedEmpties} empt{expectedEmpties === 1 ? 'y' : 'ies'}
                      </Caption>
                    )}
                  </>
                )}
              </View>
              <Pill label={phaseLabel} tone={phaseTone as any} />
            </View>

            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); openNav(stop); }}
                style={({ pressed }: any) => ({
                  flex: 1, padding: space.sm, backgroundColor: colors.surface,
                  borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
                  alignItems: 'center', opacity: pressed ? 0.85 : 1,
                })}
              >
                <Body style={{ fontWeight: '600' }}>🧭 Open in maps</Body>
              </Pressable>
              <Pressable
                onPress={() => stepInto(stop)}
                style={({ pressed }: any) => ({
                  flex: 1, padding: space.sm, backgroundColor: colors.primary,
                  borderRadius: radius.md, alignItems: 'center', opacity: pressed ? 0.85 : 1,
                })}
              >
                <Body style={{ fontWeight: '600', color: 'white' }}>Open steps →</Body>
              </Pressable>
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}
