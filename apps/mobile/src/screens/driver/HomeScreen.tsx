import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { useLiveLocation } from '../../hooks/useLiveLocation';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

/**
 * Minimal driver home — primarily a list of orders to deliver.
 * Scan button is removed from here; scanning is contextual and lives
 * inside the active-trip screen where it actually makes sense.
 */
export function DriverHomeScreen() {
  const nav = useNavigation<any>();
  const { clear, driverId } = useAuthStore();
  const [online, setOnline] = useState(true);

  useLiveLocation(driverId, online);

  const trips = useQuery({
    queryKey: ['my-trips'],
    queryFn: async () => (await api.get('/trips/mine')).data,
    refetchInterval: 20000,
  });
  const filling = useQuery({
    queryKey: ['driver-filling-mine'],
    queryFn: async () => (await api.get('/filling-orders/driver/mine')).data,
    refetchInterval: 20000,
  });
  const transfers = useQuery({
    queryKey: ['driver-transfers'],
    queryFn: async () => (await api.get('/transfers/mine')).data,
    refetchInterval: 30000,
  });

  const allTrips = trips.data ?? [];
  const active = allTrips.find((t: any) => t.status === 'PLANNED' || t.status === 'IN_PROGRESS');
  const upcoming = allTrips.filter((t: any) => t.status === 'PLANNED' && t.id !== active?.id);
  const openFilling = (filling.data ?? []).filter(
    (f: any) => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(f.status),
  );
  const openTransfers = (transfers.data ?? []).length;

  return (
    <Screen scroll>
      {/* Online switch — the only state a driver normally toggles */}
      <Card style={{ backgroundColor: online ? colors.ok : '#6b6f76', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Caption style={{ color: 'rgba(255,255,255,0.8)' }}>You are</Caption>
          <Heading size="h2" style={{ color: 'white', marginTop: 2 }}>
            {online ? 'ON DUTY' : 'OFF DUTY'}
          </Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
            {online ? 'Sharing your location' : 'Turn on to get orders'}
          </Caption>
        </View>
        <Switch value={online} onValueChange={setOnline} />
      </Card>

      {/* Active trip — most important card */}
      {active && (
        <Pressable
          onPress={() => nav.navigate('ActiveTrip', { tripId: active.id })}
          style={({ pressed }: any) => ({
            backgroundColor: colors.primary, padding: space.lg, borderRadius: radius.lg,
            marginBottom: space.md, opacity: pressed ? 0.85 : 1, ...shadow.card,
          })}
        >
          <Pill label="ACTIVE NOW" tone="warn" />
          <Heading size="h2" style={{ color: 'white', marginTop: space.sm }}>
            Current delivery
          </Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
            {active.stops?.length ?? 0} stops · Tap to open
          </Caption>
        </Pressable>
      )}

      {/* List of orders */}
      <Heading size="h3" style={{ marginTop: space.md, marginBottom: space.sm }}>
        Your delivery orders
      </Heading>
      {allTrips.length === 0 && (
        <Card>
          <Body muted>No orders right now. You'll see them here when admin assigns one.</Body>
        </Card>
      )}
      {allTrips.slice(0, 10).map((t: any) => (
        <TripRow
          key={t.id}
          trip={t}
          onPress={() => nav.navigate('ActiveTrip', { tripId: t.id })}
        />
      ))}

      {/* Filling orders */}
      {openFilling.length > 0 && (
        <>
          <Heading size="h3" style={{ marginTop: space.md, marginBottom: space.sm }}>
            Refill runs ({openFilling.length})
          </Heading>
          <Pressable
            onPress={() => nav.navigate('FillingRuns')}
            style={({ pressed }: any) => ({
              backgroundColor: colors.surface,
              padding: space.lg, borderRadius: radius.lg,
              marginBottom: space.md, opacity: pressed ? 0.85 : 1,
              ...shadow.card, flexDirection: 'row', alignItems: 'center', gap: 12,
            })}
          >
            <Body style={{ fontSize: 28 }}>⛽</Body>
            <View style={{ flex: 1 }}>
              <Heading size="h3">Open refill runs</Heading>
              <Caption style={{ marginTop: 2 }}>Tap to see details</Caption>
            </View>
            <Body style={{ fontSize: 22, color: colors.textMuted }}>›</Body>
          </Pressable>
        </>
      )}

      {/* Inventory roll-plan transfers — only shown if any are pending */}
      {openTransfers > 0 && (
        <Pressable
          onPress={() => nav.navigate('Transfers')}
          style={({ pressed }: any) => ({
            backgroundColor: colors.surface,
            padding: space.lg, borderRadius: radius.lg,
            marginTop: space.md, marginBottom: space.sm,
            opacity: pressed ? 0.85 : 1, ...shadow.card,
            flexDirection: 'row', alignItems: 'center', gap: 12,
          })}
        >
          <Body style={{ fontSize: 28 }}>📦</Body>
          <View style={{ flex: 1 }}>
            <Heading size="h3">Transfer tasks ({openTransfers})</Heading>
            <Caption style={{ marginTop: 2 }}>Cylinder moves between stores · tap to see</Caption>
          </View>
          <Body style={{ fontSize: 22, color: colors.textMuted }}>›</Body>
        </Pressable>
      )}

      <View style={{ marginTop: space.lg, gap: space.sm }}>
        <Button title="⛽ Record fuel refill" variant="ghost" onPress={() => nav.navigate('FuelRefill')} />
        <Button title="📋 End-of-day reconciliation" variant="ghost" onPress={() => nav.navigate('Reconcile')} />
        <Button title="Sign out" variant="ghost" onPress={() => clear()} />
      </View>
    </Screen>
  );
}

/**
 * Each delivery shown as: order # · type/qty · distributor · client name.
 * Only the essentials; no jargon.
 */
function TripRow({ trip, onPress }: { trip: any; onPress: () => void }) {
  // Pull the delivery stop and its order
  const deliveryStops = (trip.stops ?? []).filter((s: any) => s.stopType === 'DELIVERY');
  const orders = trip.orders ?? [];
  const summary = orders.map((o: any) => {
    const items = (o.lines ?? []).reduce((s: number, l: any) => s + (l.fullCount ?? 0), 0);
    const types = (o.lines ?? []).map((l: any) => l.cylinderType?.code ?? '').join(', ');
    return { id: o.id, items, types, client: o.client?.name, distributor: o.distributor?.businessName, addr: o.deliveryAddressLabel };
  });

  const tone =
    trip.status === 'COMPLETED' ? 'ok'
    : trip.status === 'IN_PROGRESS' ? 'warn'
    : 'primary' as 'ok' | 'warn' | 'primary';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        backgroundColor: colors.surface,
        padding: space.lg, borderRadius: radius.lg,
        marginBottom: space.sm, opacity: pressed ? 0.85 : 1,
        ...shadow.card,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Heading size="h3">
            {summary[0]?.items ?? deliveryStops.length} cylinder{(summary[0]?.items ?? 1) === 1 ? '' : 's'}
            {summary[0]?.types ? ` · ${summary[0].types}` : ''}
          </Heading>
          {summary[0] && (
            <>
              <Caption style={{ marginTop: 4 }}>
                From: <Body style={{ fontWeight: '600' }}>{summary[0].distributor}</Body>
              </Caption>
              <Caption style={{ marginTop: 2 }}>
                To: <Body style={{ fontWeight: '600' }}>{summary[0].client}</Body>
              </Caption>
              <Caption style={{ marginTop: 2, color: colors.textMuted }}>{summary[0].addr}</Caption>
            </>
          )}
        </View>
        <Pill label={trip.status} tone={tone} />
      </View>
    </Pressable>
  );
}
