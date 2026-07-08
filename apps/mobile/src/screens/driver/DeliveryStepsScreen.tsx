import { Alert, Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

type Phase = 'LOAD' | 'DRIVE' | 'DELIVER' | 'EMPTIES' | 'DONE';

const PHASE_CONFIG: Record<Phase, { emoji: string; title: string; color: string }> = {
  LOAD:    { emoji: '📥', title: 'Scan to LOAD',             color: colors.primary },
  DRIVE:   { emoji: '🧭', title: 'Drive to customer',        color: '#6b6f76' },
  DELIVER: { emoji: '📤', title: 'Scan to DELIVER',          color: '#f59e0b' },
  EMPTIES: { emoji: '📦', title: 'Scan EMPTY cylinders',     color: '#92400E' },
  DONE:    { emoji: '✅', title: 'Stop complete',            color: colors.ok },
};

/**
 * One-step-at-a-time screen. Shows only the current action — no lists,
 * no extra buttons. The driver does the action, then taps "Done" to
 * advance. Designed for low-literacy use.
 */
export function DeliveryStepsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const tripId: string = route.params?.tripId;
  const stopId: string = route.params?.stopId;
  const qc = useQueryClient();

  const trip = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => (await api.get(`/trips/${tripId}`)).data,
    refetchInterval: 15000,
  });

  const stop = trip.data?.stops?.find((s: any) => s.id === stopId);
  const order = stop?.orderId
    ? trip.data?.orders?.find((o: any) => o.id === stop.orderId)
    : null;
  const empties = (order?.lines ?? []).reduce(
    (s: number, l: any) => s + (l.expectedReturnCount ?? 0), 0,
  );
  const isStore = stop?.stopType === 'STORE_PICKUP';

  // Phase inference — simple state machine
  const phase: Phase = (() => {
    if (!stop) return 'LOAD';
    if (isStore) return stop.departedAt ? 'DONE' : 'LOAD';
    if (!stop.arrivedAt) return 'DRIVE';
    if (order?.status !== 'DELIVERED') return 'DELIVER';
    if (empties > 0 && !stop.departedAt) return 'EMPTIES';
    return 'DONE';
  })();

  const cfg = PHASE_CONFIG[phase];

  const arrive = useMutation({
    mutationFn: () => api.patch(`/trips/stops/${stopId}/arrive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });
  const depart = useMutation({
    mutationFn: () => api.patch(`/trips/stops/${stopId}/depart`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });
  const markDelivered = useMutation({
    mutationFn: () => api.patch(`/orders/${stop?.orderId}/status`, { status: 'DELIVERED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });

  function openMap() {
    const loc = stop?.location;
    if (!loc?.lat) return Alert.alert('No location');
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`);
  }
  function scan(eventType: string) {
    nav.navigate('Scan', { eventType, tripId, orderId: stop?.orderId });
  }

  if (!stop) return <Screen><Body muted>Loading…</Body></Screen>;

  return (
    <Screen scroll>
      {/* Where are we going? */}
      <Card>
        {isStore ? (
          <>
            <Caption>STORE PICKUP</Caption>
            <Heading size="h2" style={{ marginTop: 4 }}>
              {trip.data?.originStore?.name ?? 'Store'}
            </Heading>
          </>
        ) : (
          <>
            <Caption>DELIVER TO</Caption>
            <Heading size="h2" style={{ marginTop: 4 }}>
              {order?.client?.name ?? 'Customer'}
            </Heading>
            <Caption style={{ marginTop: 4 }} numberOfLines={2}>
              {order?.deliveryAddressLabel}
            </Caption>
            {empties > 0 && (
              <Pill
                label={`Pick up ${empties} empty`}
                tone="warn"
                style={{ marginTop: space.sm, alignSelf: 'flex-start' }}
              />
            )}
          </>
        )}
      </Card>

      {/* ───── Map button — always visible ───── */}
      {phase !== 'DONE' && (
        <Pressable
          onPress={openMap}
          style={({ pressed }: any) => ({
            flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: '#f1f5fb', padding: space.lg,
            borderRadius: radius.lg, marginBottom: space.md,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Body style={{ fontSize: 32 }}>🧭</Body>
          <View>
            <Heading size="h3">Open in maps</Heading>
            <Caption>Get turn-by-turn directions</Caption>
          </View>
        </Pressable>
      )}

      {/* ───── Current step — one big card ───── */}
      <View
        style={{
          backgroundColor: cfg.color, borderRadius: radius.lg,
          padding: space.xl, alignItems: 'center',
          marginBottom: space.md,
        }}
      >
        <Body style={{ fontSize: 56 }}>{cfg.emoji}</Body>
        <Heading size="h1" style={{ color: 'white', marginTop: space.md, textAlign: 'center' }}>
          {cfg.title}
        </Heading>

        {phase === 'LOAD' && (
          <>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
              Scan each cylinder as you load it onto the van.
            </Caption>
            <View style={{ width: '100%', gap: space.sm, marginTop: space.lg }}>
              <BigWhiteBtn label="📷 Scan cylinder" onPress={() => scan('SCAN_OUT')} />
              <BigWhiteBtn label="✓ Done loading" onPress={() => depart.mutate()} />
            </View>
          </>
        )}

        {phase === 'DRIVE' && (
          <>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
              Drive to the customer. Tap "I arrived" when you're there.
            </Caption>
            <View style={{ width: '100%', gap: space.sm, marginTop: space.lg }}>
              <BigWhiteBtn label="🧭 Navigate" onPress={openMap} />
              <BigWhiteBtn label="📍 I arrived" onPress={() => arrive.mutate()} />
            </View>
          </>
        )}

        {phase === 'DELIVER' && (
          <>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
              Scan each cylinder as you hand it to the customer.
            </Caption>
            <View style={{ width: '100%', gap: space.sm, marginTop: space.lg }}>
              <BigWhiteBtn label="📷 Scan delivered" onPress={() => scan('DELIVERED')} />
              <BigWhiteBtn label="✓ All delivered" onPress={() => markDelivered.mutate()} />
            </View>
          </>
        )}

        {phase === 'EMPTIES' && (
          <>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
              Pick up {empties} empty cylinder{empties === 1 ? '' : 's'} from the customer. Scan each one.
            </Caption>
            <View style={{ width: '100%', gap: space.sm, marginTop: space.lg }}>
              <BigWhiteBtn label="📷 Scan empty" onPress={() => scan('PICKED_UP_EMPTY')} />
              <BigWhiteBtn label="✓ Done" onPress={() => depart.mutate()} />
            </View>
          </>
        )}

        {phase === 'DONE' && (
          <>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
              This stop is finished. Go to the next one.
            </Caption>
            <View style={{ width: '100%', marginTop: space.lg }}>
              <BigWhiteBtn label="← Back to trip" onPress={() => nav.goBack()} />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

function BigWhiteBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        backgroundColor: 'white', borderRadius: radius.lg,
        paddingVertical: 18, alignItems: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Heading size="h3">{label}</Heading>
    </Pressable>
  );
}
