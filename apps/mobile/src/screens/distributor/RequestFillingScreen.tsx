import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Button, Card, Caption, Heading, Input, Pill, Screen } from '../../components/ui';
import { space } from '../../theme';

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

export function RequestFillingScreen() {
  const qc = useQueryClient();
  const stations = useQuery({ queryKey: ['filling-stations'], queryFn: async () => (await api.get('/filling-stations')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get('/cylinder-types')).data });
  const balance = useQuery({ queryKey: ['balance'], queryFn: async () => (await api.get('/ledger/balance')).data });
  const myOrders = useQuery({
    queryKey: ['my-filling-orders'],
    queryFn: async () => (await api.get('/filling-orders/mine')).data,
    refetchInterval: 15000,
  });

  const [stationId, setStationId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [count, setCount] = useState('20');

  const pickedStation = (stations.data ?? []).find((s: any) => s.id === stationId);
  const pricePerCyl = pickedStation ? Number(pickedStation.price_per_cylinder_paisa) / 100 : 0;
  const estimatedCost = pricePerCyl * (Number(count) || 0);
  const myBalance = Number(balance.data?.balancePaisa ?? 0) / 100;
  const sufficient = myBalance >= estimatedCost;

  const create = useMutation({
    mutationFn: () =>
      api.post('/filling-orders', {
        fillingStationId: stationId,
        cylinderTypeId: typeId,
        requestedCount: Number(count),
      }),
    onSuccess: () => {
      Alert.alert('Filling order placed', 'Admin will assign a driver shortly.');
      qc.invalidateQueries({ queryKey: ['my-filling-orders'] });
      qc.invalidateQueries({ queryKey: ['balance'] });
      setStationId(''); setTypeId(''); setCount('20');
    },
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  function submit() {
    if (!stationId || !typeId || !count) {
      Alert.alert('Missing values', 'Pick a station, cylinder type, and a quantity.');
      return;
    }
    if (!sufficient) {
      Alert.alert('Insufficient balance', `You need Rs. ${estimatedCost.toLocaleString()} but only have Rs. ${myBalance.toLocaleString()}. Top up first.`);
      return;
    }
    create.mutate();
  }

  return (
    <Screen scroll>
      <Card style={{ backgroundColor: sufficient ? undefined : '#FEF3C7' }}>
        <Caption>Advance balance</Caption>
        <Heading size="h2" style={{ marginTop: 2 }}>Rs. {myBalance.toLocaleString()}</Heading>
        {!sufficient && estimatedCost > 0 && (
          <Body style={{ color: '#92400E', marginTop: 4 }}>
            Estimated Rs. {estimatedCost.toLocaleString()} — top up before placing this order.
          </Body>
        )}
      </Card>

      <Card>
        <Heading size="h3">New filling order</Heading>
        <Caption style={{ marginTop: 4, marginBottom: space.md }}>
          A driver picks empties from your home store, takes them to the station, returns filled.
        </Caption>

        <Caption>Filling station</Caption>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md }}>
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

        <Caption>Cylinder type</Caption>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md }}>
          {(types.data ?? []).map((t: any) => (
            <Button
              key={t.id}
              title={t.name}
              variant={typeId === t.id ? 'primary' : 'ghost'}
              fullWidth={false}
              onPress={() => setTypeId(t.id)}
            />
          ))}
        </View>

        <Input label="Quantity *" value={count} onChangeText={setCount} keyboardType="number-pad" />

        {estimatedCost > 0 && (
          <Body style={{ marginVertical: space.sm }}>
            Estimated cost: <Body style={{ fontWeight: '700' }}>Rs. {estimatedCost.toLocaleString()}</Body>
          </Body>
        )}

        <Button title={create.isPending ? 'Placing…' : 'Place filling order'} onPress={submit} disabled={create.isPending} />
      </Card>

      <Card>
        <Heading size="h3">My filling orders</Heading>
        {(myOrders.data ?? []).length === 0 && <Caption>No filling orders yet.</Caption>}
        {(myOrders.data ?? []).slice(0, 20).map((o: any) => (
          <View key={o.id} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Body>{o.requestedCount} × {o.cylinderType?.code} → {o.fillingStation?.name}</Body>
              <Caption>
                {o.filledCount != null ? `${o.filledCount} filled · ` : ''}
                Rs. {Number(o.totalCostPaisa)/100} · {new Date(o.createdAt).toLocaleDateString()}
              </Caption>
            </View>
            <Pill label={o.status} tone={STATUS_TONE[o.status] ?? 'neutral'} />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
