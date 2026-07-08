import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Button, Card, Caption, Heading, Input, Pill, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'primary' | 'neutral' | 'danger'> = {
  PENDING: 'warn',
  ASSIGNED: 'primary',
  EMPTIES_PICKED: 'primary',
  AT_STATION: 'primary',
  FILLED: 'primary',
  RETURNED: 'primary',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

type CartLine = { cylinderTypeId: string; label: string; weightKg: string; count: number };
type Mode = 'choose' | 'our' | 'diy' | 'placed';

/**
 * Refill flow. First asks if the distributor wants us to handle it or
 * they'll do it themselves at their own station. The "cart" mirrors the
 * Place Order screen so users have a consistent multi-pick experience.
 */
export function RequestFillingScreen() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('choose');

  const stations = useQuery({
    queryKey: ['filling-stations'],
    queryFn: async () => (await api.get('/filling-stations')).data,
    enabled: mode === 'our',
  });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get('/cylinder-types')).data });
  const balance = useQuery({ queryKey: ['balance'], queryFn: async () => (await api.get('/ledger/balance')).data });
  const myOrders = useQuery({
    queryKey: ['my-filling-orders'],
    queryFn: async () => (await api.get('/filling-orders/mine')).data,
    refetchInterval: 15000,
  });

  const [stationId, setStationId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [ownStation, setOwnStation] = useState({ name: '', address: '', notes: '' });

  function addToCart(t: any) {
    setCart((c) => {
      const ex = c.find((x) => x.cylinderTypeId === t.id);
      if (ex) return c.map((x) => x.cylinderTypeId === t.id ? { ...x, count: x.count + 1 } : x);
      return [...c, { cylinderTypeId: t.id, label: t.name, weightKg: t.weightKg, count: 1 }];
    });
  }
  function changeQty(id: string, delta: number) {
    setCart((c) => c
      .map((x) => x.cylinderTypeId === id ? { ...x, count: Math.max(0, x.count + delta) } : x)
      .filter((x) => x.count > 0));
  }

  const pickedStation = (stations.data ?? []).find((s: any) => s.id === stationId);
  const pricePerCyl = pickedStation ? Number(pickedStation.price_per_cylinder_paisa) / 100 : 0;
  const cartTotal = cart.reduce((s, x) => s + x.count, 0);
  const estimatedCost = mode === 'our' ? pricePerCyl * cartTotal : 0;
  const myBalance = Number(balance.data?.balancePaisa ?? 0) / 100;
  const sufficient = myBalance >= estimatedCost;

  const create = useMutation({
    mutationFn: async () => {
      // The API accepts one cylinder type per filling order; place one per cart line.
      const results = [];
      for (const line of cart) {
        if (mode === 'our') {
          const r = await api.post('/filling-orders', {
            fillingStationId: stationId,
            cylinderTypeId: line.cylinderTypeId,
            requestedCount: line.count,
            serviceType: 'OUR_SERVICE',
          });
          results.push(r.data);
        } else {
          const r = await api.post('/filling-orders', {
            cylinderTypeId: line.cylinderTypeId,
            requestedCount: line.count,
            serviceType: 'DIY',
            ownStationName: ownStation.name,
            ownStationAddress: ownStation.address,
            ownStationNotes: ownStation.notes,
          });
          results.push(r.data);
        }
      }
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-filling-orders'] });
      qc.invalidateQueries({ queryKey: ['balance'] });
      setCart([]); setStationId('');
      setMode('placed');
    },
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  function submitOur() {
    if (!stationId) { Alert.alert('Pick a filling station'); return; }
    if (cartTotal === 0) { Alert.alert('Add at least one cylinder'); return; }
    if (!sufficient) {
      Alert.alert('Insufficient balance', `You need Rs. ${estimatedCost.toLocaleString()} but only have Rs. ${myBalance.toLocaleString()}. Top up first.`);
      return;
    }
    create.mutate();
  }
  function submitDiy() {
    if (!ownStation.name.trim()) { Alert.alert('Name your filling station first'); return; }
    if (cartTotal === 0) { Alert.alert('Add at least one cylinder'); return; }
    create.mutate();
  }

  return (
    <Screen scroll>
      {mode === 'choose' && (
        <Card>
          <Heading size="h3">How do you want to refill?</Heading>
          <Caption style={{ marginTop: 4, marginBottom: space.md }}>
            We can pick up your empties, refill at our station, and return — or you can handle it on your own and we'll just track it.
          </Caption>
          <Pressable
            onPress={() => setMode('our')}
            style={({ pressed }: any) => ({
              padding: space.lg, borderRadius: radius.lg, marginBottom: space.sm,
              backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1,
            })}
          >
            <Heading size="h3" style={{ color: 'white' }}>🚚 Use our service</Heading>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
              We pick up empties from your store, take them to our station, and return filled. Charged to your advance balance.
            </Caption>
          </Pressable>
          <Pressable
            onPress={() => setMode('diy')}
            style={({ pressed }: any) => ({
              padding: space.lg, borderRadius: radius.lg,
              backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Heading size="h3">🛠️ Do it yourself</Heading>
            <Caption style={{ marginTop: 4 }}>
              You handle pickup and refill at your own station. We just record the refill for your inventory.
            </Caption>
          </Pressable>
        </Card>
      )}

      {mode === 'our' && (
        <>
          <Card style={{ backgroundColor: sufficient ? undefined : '#FEF3C7' }}>
            <Caption>Advance balance</Caption>
            <Heading size="h2" style={{ marginTop: 2 }}>Rs. {myBalance.toLocaleString()}</Heading>
            {!sufficient && estimatedCost > 0 && (
              <Body style={{ color: '#92400E', marginTop: 4 }}>
                Estimated Rs. {estimatedCost.toLocaleString()} — top up before placing.
              </Body>
            )}
          </Card>

          <Card>
            <Heading size="h3">Pick filling station</Heading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm }}>
              {(stations.data ?? []).map((s: any) => (
                <Button
                  key={s.id}
                  title={`${s.name} · Rs.${Number(s.price_per_cylinder_paisa)/100}/cyl`}
                  variant={stationId === s.id ? 'primary' : 'ghost'}
                  fullWidth={false}
                  onPress={() => setStationId(s.id)}
                />
              ))}
            </View>
          </Card>

          <CartCard
            types={types.data ?? []}
            cart={cart}
            onAdd={addToCart}
            onChange={changeQty}
          />

          {estimatedCost > 0 && (
            <Card>
              <Body>Estimated cost: <Body style={{ fontWeight: '700' }}>Rs. {estimatedCost.toLocaleString()}</Body></Body>
            </Card>
          )}

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="← Back" variant="ghost" onPress={() => setMode('choose')} fullWidth={false} />
            <Button title={create.isPending ? 'Placing…' : 'Place filling order'} onPress={submitOur} disabled={create.isPending} />
          </View>
        </>
      )}

      {mode === 'diy' && (
        <>
          <Card>
            <Heading size="h3">Your filling station</Heading>
            <Caption style={{ marginBottom: space.sm }}>
              Tell us about the station you're using so we can record the refill against it.
            </Caption>
            <Input label="Station name *" value={ownStation.name} onChangeText={(v) => setOwnStation({ ...ownStation, name: v })} />
            <Input label="Station address" value={ownStation.address} onChangeText={(v) => setOwnStation({ ...ownStation, address: v })} />
            <Input label="Notes" value={ownStation.notes} onChangeText={(v) => setOwnStation({ ...ownStation, notes: v })}
              placeholder='e.g. "Owner: Ali Khan · Receipt #4523"' />
          </Card>

          <CartCard
            types={types.data ?? []}
            cart={cart}
            onAdd={addToCart}
            onChange={changeQty}
          />

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="← Back" variant="ghost" onPress={() => setMode('choose')} fullWidth={false} />
            <Button title={create.isPending ? 'Recording…' : 'Record DIY refill'} variant="success" onPress={submitDiy} disabled={create.isPending} />
          </View>
        </>
      )}

      {mode === 'placed' && (
        <Card>
          <Heading size="h3">✓ Done</Heading>
          <Caption style={{ marginTop: 4 }}>Order(s) saved. You'll see them below.</Caption>
          <Button title="Place another" onPress={() => setMode('choose')} style={{ marginTop: space.md }} />
        </Card>
      )}

      <Card>
        <Heading size="h3">My filling orders</Heading>
        {(myOrders.data ?? []).length === 0 && <Caption>No filling orders yet.</Caption>}
        {(myOrders.data ?? []).slice(0, 20).map((o: any) => (
          <View key={o.id} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Body>{o.requestedCount} × {o.cylinderType?.code} → {o.serviceType === 'DIY' ? (o.ownStationName ?? 'DIY') : o.fillingStation?.name}</Body>
              <Caption>
                {o.filledCount != null ? `${o.filledCount} filled · ` : ''}
                {o.serviceType === 'DIY' ? 'DIY' : `Rs. ${Number(o.totalCostPaisa)/100}`} · {new Date(o.createdAt).toLocaleDateString()}
              </Caption>
            </View>
            <Pill label={o.status} tone={STATUS_TONE[o.status] ?? 'neutral'} />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function CartCard({
  types, cart, onAdd, onChange,
}: {
  types: any[];
  cart: CartLine[];
  onAdd: (t: any) => void;
  onChange: (id: string, delta: number) => void;
}) {
  return (
    <>
      <Card>
        <Heading size="h3">Pick cylinders to refill</Heading>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
          {types.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => onAdd(t)}
              style={({ pressed }: any) => ({
                flexBasis: '47%',
                padding: space.md, borderRadius: radius.md,
                borderWidth: 2, borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Body style={{ fontSize: 22, marginBottom: 4 }}>🛢️</Body>
              <Heading size="h3">{Number(t.weightKg)} kg</Heading>
              <Caption>{t.name}</Caption>
              <Caption style={{ color: colors.primary, marginTop: 4 }}>+ Add to cart</Caption>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Heading size="h3">Cart ({cart.reduce((s, x) => s + x.count, 0)})</Heading>
        {cart.length === 0 && <Caption style={{ marginTop: 4 }}>Empty — pick cylinders above.</Caption>}
        {cart.map((x) => (
          <View key={x.cylinderTypeId} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Body style={{ fontWeight: '600' }}>{x.label} ({Number(x.weightKg)} kg)</Body>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable onPress={() => onChange(x.cylinderTypeId, -1)} style={({ pressed }: any) => ({ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
                <Body style={{ color: 'white', fontWeight: '700' }}>−</Body>
              </Pressable>
              <Body style={{ minWidth: 24, textAlign: 'center', fontWeight: '700' }}>{x.count}</Body>
              <Pressable onPress={() => onChange(x.cylinderTypeId, 1)} style={({ pressed }: any) => ({ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
                <Body style={{ color: 'white', fontWeight: '700' }}>+</Body>
              </Pressable>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}
