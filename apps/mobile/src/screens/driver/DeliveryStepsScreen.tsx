import { Alert, Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Card, Caption, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

type Phase = 'LOAD' | 'IN_TRANSIT' | 'AT_CLIENT' | 'COLLECT_EMPTIES' | 'DONE';

/**
 * Walks the driver through each phase of a delivery for one stop.
 * Phases:
 *   1. LOAD         — pick cylinders up at the store (scan SCAN_OUT)
 *   2. IN_TRANSIT   — driving to client (open in maps)
 *   3. AT_CLIENT    — scan as DELIVERED at the client
 *   4. COLLECT_EMPTIES — scan empties to bring back (if order has any)
 *   5. DONE         — mark delivery complete
 *
 * Phase is derived from the trip-stop's arrivedAt/departedAt timestamps
 * and the order's status, so it survives screen restarts.
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
  const order = stop?.orderId ? trip.data?.orders?.find((o: any) => o.id === stop.orderId) : null;

  const expectedEmpties = (order?.lines ?? []).reduce(
    (s: number, l: any) => s + (l.expectedReturnCount ?? 0),
    0,
  );

  // Phase inference
  const phase: Phase = (() => {
    if (!stop) return 'LOAD';
    if (stop.stopType === 'STORE_PICKUP') {
      return stop.departedAt ? 'DONE' : 'LOAD';
    }
    // DELIVERY
    if (!stop.arrivedAt) return 'IN_TRANSIT';
    if (order?.status !== 'DELIVERED') return 'AT_CLIENT';
    if (expectedEmpties > 0 && !stop.departedAt) return 'COLLECT_EMPTIES';
    return 'DONE';
  })();

  const arrive = useMutation({
    mutationFn: () => api.patch(`/trips/stops/${stopId}/arrive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });
  const depart = useMutation({
    mutationFn: () => api.patch(`/trips/stops/${stopId}/depart`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });
  const setOrderStatus = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/orders/${stop?.orderId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });

  function openInMaps() {
    const loc = stop?.location?.coordinates;
    if (!loc) return Alert.alert('No coordinates', 'This stop has no location set.');
    const [lng, lat] = loc;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  }

  function goScan(eventType: string) {
    nav.navigate('Scan', { eventType, tripId, orderId: stop?.orderId });
  }

  if (!stop) return <Screen><Body muted>Stop not found.</Body></Screen>;

  const stopHeader =
    stop.stopType === 'STORE_PICKUP' ? 'Pickup at store'
    : stop.stopType === 'DELIVERY' ? 'Deliver to client'
    : 'Return empties';

  return (
    <Screen scroll>
      <Card>
        <Caption>STOP {stop.seq + 1} · {stop.stopType.replace('_', ' ')}</Caption>
        <Heading size="h2" style={{ marginTop: 2 }}>{stopHeader}</Heading>
        {order && (
          <>
            <Caption style={{ marginTop: space.sm }}>
              Client: <Body style={{ fontWeight: '600' }}>{order.client?.name ?? '—'}</Body>
            </Caption>
            <Caption style={{ marginTop: 2 }} numberOfLines={3}>{order.deliveryAddressLabel}</Caption>
            <Caption style={{ marginTop: 6, color: colors.textMuted }}>
              {(order.lines ?? []).map((l: any) => `${l.fullCount} × ${l.cylinderType?.code ?? ''}`).join(', ')}
              {expectedEmpties > 0 ? ` · pick up ${expectedEmpties} empt${expectedEmpties === 1 ? 'y' : 'ies'}` : ''}
            </Caption>
          </>
        )}
      </Card>

      <Card>
        <Heading size="h3" style={{ marginBottom: space.sm }}>Steps</Heading>
        <StepRow
          n={1}
          title="Load cylinders at the store"
          desc="Scan each cylinder so the system knows it's on your van."
          state={stop.stopType === 'STORE_PICKUP'
            ? (phase === 'LOAD' ? 'active' : 'done')
            : 'done'}
        />
        <StepRow
          n={2}
          title="Drive to the customer"
          desc="Tap 'Open in maps' for turn-by-turn directions."
          state={phase === 'IN_TRANSIT' ? 'active' : (phase === 'LOAD' ? 'todo' : 'done')}
        />
        <StepRow
          n={3}
          title="Hand over cylinders"
          desc="Scan each cylinder as DELIVERED at the customer's doorstep."
          state={phase === 'AT_CLIENT' ? 'active' : phase === 'IN_TRANSIT' || phase === 'LOAD' ? 'todo' : 'done'}
        />
        {expectedEmpties > 0 && (
          <StepRow
            n={4}
            title={`Pick up ${expectedEmpties} empty cylinder${expectedEmpties === 1 ? '' : 's'}`}
            desc="Scan each empty so it's recorded as collected."
            state={phase === 'COLLECT_EMPTIES' ? 'active' : phase === 'DONE' ? 'done' : 'todo'}
          />
        )}
        <StepRow
          n={expectedEmpties > 0 ? 5 : 4}
          title="Mark complete"
          desc="Confirm the delivery is finished."
          state={phase === 'DONE' ? 'done' : 'todo'}
        />
      </Card>

      {/* Action area — only the relevant button(s) per phase */}
      {phase === 'LOAD' && (
        <Card>
          <Button title="📷 Scan cylinders to load" onPress={() => goScan('SCAN_OUT')} />
          <Button title="✓ Finished loading" variant="success" onPress={() => depart.mutate()} style={{ marginTop: space.sm }} />
        </Card>
      )}
      {phase === 'IN_TRANSIT' && (
        <Card>
          <Button title="🧭 Open in maps" onPress={openInMaps} />
          <Button title="📍 I've arrived at the customer" variant="success" onPress={() => arrive.mutate()} style={{ marginTop: space.sm }} />
        </Card>
      )}
      {phase === 'AT_CLIENT' && (
        <Card>
          <Button title="📷 Scan as DELIVERED" onPress={() => goScan('DELIVERED')} />
          <Button
            title="✓ Mark delivered"
            variant="success"
            onPress={() => setOrderStatus.mutate('DELIVERED')}
            style={{ marginTop: space.sm }}
          />
        </Card>
      )}
      {phase === 'COLLECT_EMPTIES' && (
        <Card>
          <Body style={{ marginBottom: space.sm }}>
            Pick up <Body style={{ fontWeight: '700' }}>{expectedEmpties}</Body> empty cylinder{expectedEmpties === 1 ? '' : 's'} from the customer.
          </Body>
          <Button title="📦 Scan empties" onPress={() => goScan('PICKED_UP_EMPTY')} />
          <Button
            title="✓ Done collecting"
            variant="success"
            onPress={() => depart.mutate()}
            style={{ marginTop: space.sm }}
          />
        </Card>
      )}
      {phase === 'DONE' && (
        <Card style={{ backgroundColor: '#ecfdf5' }}>
          <Heading size="h3" style={{ color: colors.ok }}>✓ Stop complete</Heading>
          <Caption style={{ marginTop: space.sm }}>Move on to your next stop.</Caption>
          <Button title="← Back to trip" variant="ghost" onPress={() => nav.goBack()} style={{ marginTop: space.md }} />
        </Card>
      )}
    </Screen>
  );
}

function StepRow({
  n, title, desc, state,
}: { n: number; title: string; desc: string; state: 'todo' | 'active' | 'done' }) {
  const bg = state === 'done' ? colors.ok : state === 'active' ? colors.primary : colors.border;
  const labelColor = state === 'todo' ? colors.textMuted : colors.text;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        paddingVertical: 10, borderTopWidth: n === 1 ? 0 : 1, borderTopColor: colors.border,
      }}
    >
      <View
        style={{
          width: 32, height: 32, borderRadius: 16, backgroundColor: bg,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Body style={{ color: 'white', fontWeight: '700' }}>{state === 'done' ? '✓' : n}</Body>
      </View>
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: '700', color: labelColor }}>{title}</Body>
        <Caption style={{ marginTop: 2, color: state === 'active' ? colors.text : colors.textMuted }}>
          {desc}
        </Caption>
        {state === 'active' && (
          <Pill label="DO THIS NOW" tone="warn" style={{ marginTop: 6, alignSelf: 'flex-start' }} />
        )}
      </View>
    </View>
  );
}
