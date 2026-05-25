import { useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { useLiveLocation } from '../../hooks/useLiveLocation';
import { Body, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

export function DriverHomeScreen() {
  const nav = useNavigation<any>();
  const { driverId } = useAuthStore();
  const [online, setOnline] = useState(true);

  useLiveLocation(driverId, online);

  const trips = useQuery({
    queryKey: ['my-trips'],
    queryFn: async () => (await api.get('/trips/mine')).data,
    refetchInterval: 20000,
  });
  const suggestions = useQuery({
    queryKey: ['next-suggestions'],
    queryFn: async () => (await api.get('/trips/next-suggestions')).data as Array<{
      kind: string; id: string; tripId?: string; title: string;
      subtitle: string; distanceKm: number; onYourRoute: boolean;
      lat: number; lng: number;
    }>,
    refetchInterval: 60000,
    enabled: online,
  });
  const transfers = useQuery({
    queryKey: ['driver-transfers'],
    queryFn: async () => (await api.get('/transfers/mine')).data,
    refetchInterval: 30000,
  });

  const allTrips = trips.data ?? [];
  const active = allTrips.find((t: any) => t.status === 'PLANNED' || t.status === 'IN_PROGRESS');
  const openTransfers = (transfers.data ?? []).length;

  return (
    <Screen scroll>
      {/* On/Off duty */}
      <Card style={{ backgroundColor: online ? colors.ok : '#6b6f76', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Heading size="h2" style={{ color: 'white' }}>
            {online ? 'ON DUTY' : 'OFF DUTY'}
          </Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
            {online ? 'Sharing location' : 'Tap to go online'}
          </Caption>
        </View>
        <Switch value={online} onValueChange={setOnline} />
      </Card>

      {/* ───── Two main actions ───── */}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <BigAction
          emoji="📥"
          label="SCAN to LOAD"
          sublabel="Pick up from store"
          color={colors.primary}
          onPress={() => nav.navigate('Scan', { eventType: 'SCAN_OUT' })}
        />
        <BigAction
          emoji="📤"
          label="SCAN to DELIVER"
          sublabel="Drop at customer"
          color="#f59e0b"
          onPress={() => nav.navigate('Scan', { eventType: 'DELIVERED' })}
        />
      </View>

      {/* Active delivery — one big card */}
      {active && (
        <Pressable
          onPress={() => nav.navigate('ActiveTrip', { tripId: active.id })}
          style={({ pressed }: any) => ({
            backgroundColor: colors.primary, padding: space.lg, borderRadius: radius.lg,
            marginTop: space.md, opacity: pressed ? 0.85 : 1, ...shadow.card,
          })}
        >
          <Pill label="ACTIVE NOW" tone="warn" />
          <Heading size="h2" style={{ color: 'white', marginTop: space.sm }}>
            Current delivery
          </Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
            {active.stops?.length ?? 0} stops · Tap to see steps
          </Caption>
        </Pressable>
      )}

      {/* Nearby orders — the smart list */}
      {(suggestions.data ?? []).length > 0 && (
        <Heading size="h3" style={{ marginTop: space.lg, marginBottom: space.sm }}>
          Nearby orders
        </Heading>
      )}
      {(suggestions.data ?? []).slice(0, 5).map((s) => (
        <Pressable
          key={`${s.kind}-${s.id}`}
          onPress={() => {
            if (s.kind === 'ORDER' && s.tripId) nav.navigate('ActiveTrip', { tripId: s.tripId });
            else if (s.kind === 'TRANSFER') nav.navigate('TransferDetail', { transferId: s.id });
          }}
          style={({ pressed }: any) => ({
            backgroundColor: s.onYourRoute ? '#ecfdf5' : colors.surface,
            borderWidth: 1,
            borderColor: s.onYourRoute ? colors.ok : colors.border,
            padding: space.md, borderRadius: radius.lg,
            marginBottom: space.sm,
            opacity: pressed ? 0.85 : 1,
            ...shadow.card,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: s.onYourRoute ? colors.ok : colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Body style={{ fontSize: 20 }}>{s.kind === 'ORDER' ? '📦' : '🔄'}</Body>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '700' }} numberOfLines={1}>{s.title}</Body>
              <Caption style={{ marginTop: 2 }} numberOfLines={1}>{s.subtitle}</Caption>
              <Caption style={{ marginTop: 2, fontWeight: '600', color: s.onYourRoute ? colors.ok : colors.textMuted }}>
                {s.distanceKm.toFixed(1)} km{s.onYourRoute ? ' · on your route' : ''}
              </Caption>
            </View>
            {/* Quick map button */}
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`);
              }}
              style={({ pressed }: any) => ({
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: '#f1f5fb',
                alignItems: 'center', justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Body style={{ fontSize: 18 }}>🧭</Body>
            </Pressable>
          </View>
        </Pressable>
      ))}

      {/* Transfer tasks shortcut */}
      {openTransfers > 0 && (
        <Pressable
          onPress={() => nav.navigate('Transfers')}
          style={({ pressed }: any) => ({
            backgroundColor: colors.surface,
            padding: space.lg, borderRadius: radius.lg,
            marginTop: space.sm, opacity: pressed ? 0.85 : 1,
            ...shadow.card, flexDirection: 'row', alignItems: 'center', gap: 12,
          })}
        >
          <Body style={{ fontSize: 28 }}>📦</Body>
          <View style={{ flex: 1 }}>
            <Heading size="h3">Transfer tasks ({openTransfers})</Heading>
            <Caption>Move cylinders between stores</Caption>
          </View>
          <Body style={{ fontSize: 22, color: colors.textMuted }}>›</Body>
        </Pressable>
      )}

      {/* All orders list — compact */}
      {allTrips.length > 0 && (
        <Heading size="h3" style={{ marginTop: space.lg, marginBottom: space.sm }}>
          All my orders
        </Heading>
      )}
      {allTrips.slice(0, 10).map((t: any) => {
        const orders = t.orders ?? [];
        const first = orders[0];
        const items = orders.reduce((s: number, o: any) =>
          s + (o.lines ?? []).reduce((ss: number, l: any) => ss + (l.fullCount ?? 0), 0), 0);
        const tone = t.status === 'COMPLETED' ? 'ok' : t.status === 'IN_PROGRESS' ? 'warn' : 'primary' as any;
        return (
          <Pressable
            key={t.id}
            onPress={() => nav.navigate('ActiveTrip', { tripId: t.id })}
            style={({ pressed }: any) => ({
              backgroundColor: colors.surface,
              padding: space.md, borderRadius: radius.lg,
              marginBottom: space.sm, opacity: pressed ? 0.85 : 1,
              ...shadow.card,
            })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '700' }}>
                  {items} cylinder{items === 1 ? '' : 's'} → {first?.client?.name ?? 'customer'}
                </Body>
                <Caption style={{ marginTop: 2 }} numberOfLines={1}>
                  {first?.deliveryAddressLabel ?? ''}
                </Caption>
              </View>
              <Pill label={t.status} tone={tone} />
            </View>
          </Pressable>
        );
      })}

      {allTrips.length === 0 && !active && (suggestions.data ?? []).length === 0 && (
        <Card style={{ marginTop: space.md }}>
          <Body muted>No orders right now. Go online and wait for dispatch.</Body>
        </Card>
      )}
    </Screen>
  );
}

function BigAction({ emoji, label, sublabel, color, onPress }: {
  emoji: string; label: string; sublabel: string; color: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        flex: 1, backgroundColor: color,
        borderRadius: radius.lg, padding: space.lg,
        alignItems: 'center', opacity: pressed ? 0.85 : 1,
        ...shadow.card,
      })}
    >
      <Body style={{ fontSize: 36 }}>{emoji}</Body>
      <Heading size="h3" style={{ color: 'white', marginTop: space.sm, textAlign: 'center' }}>
        {label}
      </Heading>
      <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: 2, textAlign: 'center' }}>
        {sublabel}
      </Caption>
    </Pressable>
  );
}
