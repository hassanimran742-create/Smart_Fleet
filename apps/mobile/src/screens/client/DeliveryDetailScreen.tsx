import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

type Phase = 'WAITING' | 'ON_WAY' | 'RECEIVE' | 'EMPTIES' | 'DONE';

const PHASE_CFG: Record<Phase, { emoji: string; title: string; color: string }> = {
  WAITING: { emoji: '⏳', title: 'Being prepared',        color: '#6b6f76' },
  ON_WAY:  { emoji: '🚚', title: 'Driver is coming',      color: colors.primary },
  RECEIVE: { emoji: '📥', title: 'Confirm your delivery',  color: colors.ok },
  EMPTIES: { emoji: '📤', title: 'Hand over empties',      color: '#f59e0b' },
  DONE:    { emoji: '✅', title: 'Delivery complete',      color: colors.ok },
};

/**
 * Single-card per phase, same pattern as the driver app. The client
 * sees one action at a time — no lists, no jargon.
 */
export function DeliveryDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const orderId = route.params?.orderId;
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ['client-order', orderId],
    queryFn: async () => (await api.get(`/client-portal/orders/${orderId}`)).data,
    refetchInterval: 10000,
  });

  const confirmDelivery = useMutation({
    mutationFn: () => api.post(`/client-portal/orders/${orderId}/confirm-delivery`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-order', orderId] });
      qc.invalidateQueries({ queryKey: ['client-active'] });
      qc.invalidateQueries({ queryKey: ['client-orders'] });
    },
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });
  const confirmEmpties = useMutation({
    mutationFn: () => api.post(`/client-portal/orders/${orderId}/confirm-empties`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-order', orderId] });
      qc.invalidateQueries({ queryKey: ['client-active'] });
      qc.invalidateQueries({ queryKey: ['client-orders'] });
    },
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  const o = detail.data;
  if (!o) return <Screen><Body muted>Loading…</Body></Screen>;

  const items = (o.lines ?? []).reduce((s: number, l: any) => s + (l.fullCount ?? 0), 0);
  const empties = (o.lines ?? []).reduce((s: number, l: any) => s + (l.expectedReturnCount ?? 0), 0);
  const driverName = o.trip?.driver?.user?.name;
  const plate = o.trip?.vehicle?.plateNo;

  const phase: Phase = (() => {
    if (o.clientConfirmedAt && (empties === 0 || o.emptiesHandedOverAt)) return 'DONE';
    if (o.clientConfirmedAt && empties > 0 && !o.emptiesHandedOverAt) return 'EMPTIES';
    if (o.status === 'DELIVERED') return 'RECEIVE';
    if (o.status === 'IN_TRANSIT') return 'ON_WAY';
    return 'WAITING';
  })();

  const cfg = PHASE_CFG[phase];

  return (
    <Screen scroll>
      {/* Order summary */}
      <Card>
        <Caption>ORDER</Caption>
        <Heading size="h2" style={{ marginTop: 4 }}>
          {items} cylinder{items === 1 ? '' : 's'}
        </Heading>
        <Caption style={{ marginTop: 4 }}>
          From: {o.distributor?.businessName ?? '—'}
        </Caption>
        {(o.lines ?? []).map((l: any) => (
          <Caption key={l.id} style={{ marginTop: 2 }}>
            {l.fullCount} × {l.cylinderType?.name ?? ''} ({Number(l.cylinderType?.weightKg ?? 0)} kg)
          </Caption>
        ))}
        {empties > 0 && (
          <Pill label={`Return ${empties} empty`} tone="warn" style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
        )}
        {driverName && (
          <Caption style={{ marginTop: space.sm, color: colors.textMuted }}>
            Driver: {driverName}{plate ? ` · ${plate}` : ''}
          </Caption>
        )}
      </Card>

      {/* Current phase — one big card */}
      <View
        style={{
          backgroundColor: cfg.color, borderRadius: radius.lg,
          padding: space.xl, alignItems: 'center', marginBottom: space.md,
        }}
      >
        <Body style={{ fontSize: 56 }}>{cfg.emoji}</Body>
        <Heading size="h1" style={{ color: 'white', marginTop: space.md, textAlign: 'center' }}>
          {cfg.title}
        </Heading>

        {phase === 'WAITING' && (
          <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
            Your order is being prepared. You'll be notified when the driver is on the way.
          </Caption>
        )}

        {phase === 'ON_WAY' && (
          <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, textAlign: 'center' }}>
            {driverName ? `${driverName} is` : 'The driver is'} heading to you.
            You can confirm when they arrive.
          </Caption>
        )}

        {phase === 'RECEIVE' && (
          <View style={{ width: '100%', gap: space.sm, marginTop: space.lg }}>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: space.sm }}>
              Check the cylinders, then tap to confirm you received them.
            </Caption>
            <BigWhiteBtn
              label="📷 Scan each cylinder"
              onPress={() => nav.navigate('Scan', { eventType: 'DELIVERED', orderId })}
            />
            <BigWhiteBtn
              label="✓ I received all"
              onPress={() => {
                Alert.alert(
                  'Confirm delivery?',
                  `You're confirming you received ${items} cylinder${items === 1 ? '' : 's'}.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Confirm', onPress: () => confirmDelivery.mutate() },
                  ],
                );
              }}
            />
          </View>
        )}

        {phase === 'EMPTIES' && (
          <View style={{ width: '100%', gap: space.sm, marginTop: space.lg }}>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: space.sm }}>
              Give {empties} empty cylinder{empties === 1 ? '' : 's'} to the driver. Scan each one.
            </Caption>
            <BigWhiteBtn
              label="📷 Scan empty cylinder"
              onPress={() => nav.navigate('Scan', { eventType: 'PICKED_UP_EMPTY', orderId })}
            />
            <BigWhiteBtn
              label="✓ All empties given"
              onPress={() => {
                Alert.alert(
                  'Confirm empties?',
                  `You're confirming you gave ${empties} empty cylinder${empties === 1 ? '' : 's'} to the driver.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Confirm', onPress: () => confirmEmpties.mutate() },
                  ],
                );
              }}
            />
          </View>
        )}

        {phase === 'DONE' && (
          <View style={{ width: '100%', marginTop: space.lg }}>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: space.md }}>
              Everything confirmed. Thank you!
            </Caption>
            <BigWhiteBtn label="← Back to home" onPress={() => nav.goBack()} />
          </View>
        )}
      </View>
    </Screen>
  );
}

function BigWhiteBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const { Pressable } = require('react-native');
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
