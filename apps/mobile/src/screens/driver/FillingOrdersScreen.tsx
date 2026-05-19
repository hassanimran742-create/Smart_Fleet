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

export function DriverFillingOrdersScreen() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['driver-filling-mine'],
    queryFn: async () => (await api.get('/filling-orders/driver/mine')).data,
    refetchInterval: 15000,
  });

  const [pickedFor, setPickedFor] = useState<string | null>(null);
  const [emptyCount, setEmptyCount] = useState('');
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState('');

  const transition = useMutation({
    mutationFn: (input: { id: string; endpoint: string; body?: any }) =>
      api.patch(`/filling-orders/${input.id}/${input.endpoint}`, input.body ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-filling-mine'] }),
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  const open = (data ?? []).filter((o: any) => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(o.status));
  const done = (data ?? []).filter((o: any) => ['COMPLETED', 'CANCELLED', 'FAILED'].includes(o.status));

  return (
    <Screen scroll>
      <Heading size="h2" style={{ marginBottom: space.md }}>My filling runs</Heading>

      {open.length === 0 && (
        <Card>
          <Body muted>No active filling orders. Admin will assign one when needed.</Body>
        </Card>
      )}

      {open.map((o: any) => (
        <Card key={o.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Heading size="h3">{o.distributor?.businessName}</Heading>
              <Caption style={{ marginTop: 2 }}>
                {o.requestedCount} × {o.cylinderType?.code} → {o.fillingStation?.name}
              </Caption>
              <Caption style={{ marginTop: 2 }}>
                Pick up from: {o.pickupStore?.name ?? '—'}
              </Caption>
            </View>
            <Pill label={o.status} tone={STATUS_TONE[o.status] ?? 'neutral'} />
          </View>

          <View style={{ marginTop: space.md, gap: space.sm }}>
            {o.status === 'ASSIGNED' && (
              <>
                <Input
                  label={`Empties picked up from ${o.pickupStore?.name ?? 'store'}`}
                  value={pickedFor === o.id ? emptyCount : ''}
                  onChangeText={(v) => { setPickedFor(o.id); setEmptyCount(v); }}
                  keyboardType="number-pad"
                  placeholder={`e.g. ${o.requestedCount}`}
                />
                <Button
                  title="Mark empties picked"
                  onPress={() => {
                    const n = Number(emptyCount);
                    if (!Number.isFinite(n) || n <= 0) {
                      Alert.alert('Enter the count of empty cylinders you picked up');
                      return;
                    }
                    transition.mutate({ id: o.id, endpoint: 'picked-empties', body: { emptyCount: n } });
                    setPickedFor(null); setEmptyCount('');
                  }}
                />
              </>
            )}

            {o.status === 'EMPTIES_PICKED' && (
              <Button
                title={`Arrived at ${o.fillingStation?.name}`}
                onPress={() => transition.mutate({ id: o.id, endpoint: 'at-station' })}
              />
            )}

            {o.status === 'AT_STATION' && (
              <>
                <Caption>You picked up {o.pickedUpEmptyCount} empties. How many were filled?</Caption>
                <Input
                  label="Filled count"
                  value={filledFor === o.id ? filledCount : ''}
                  onChangeText={(v) => { setFilledFor(o.id); setFilledCount(v); }}
                  keyboardType="number-pad"
                  placeholder={`e.g. ${o.pickedUpEmptyCount}`}
                />
                <Button
                  title="Mark filled at station"
                  variant="success"
                  onPress={() => {
                    const n = Number(filledCount);
                    if (!Number.isFinite(n) || n < 0) {
                      Alert.alert('Enter the count of cylinders filled');
                      return;
                    }
                    transition.mutate({ id: o.id, endpoint: 'filled', body: { filledCount: n } });
                    setFilledFor(null); setFilledCount('');
                  }}
                />
              </>
            )}

            {o.status === 'FILLED' && (
              <Button
                title={`Drop ${o.filledCount} filled back at ${o.pickupStore?.name ?? 'store'}`}
                variant="success"
                onPress={() => transition.mutate({ id: o.id, endpoint: 'returned' })}
              />
            )}

            {o.status === 'RETURNED' && (
              <Caption>Awaiting admin to confirm + debit distributor's balance.</Caption>
            )}
          </View>
        </Card>
      ))}

      {done.length > 0 && (
        <Card>
          <Heading size="h3">Completed</Heading>
          {done.slice(0, 10).map((o: any) => (
            <View key={o.id} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: '#eee' }}>
              <Body>{o.distributor?.businessName} · {o.filledCount ?? 0} × {o.cylinderType?.code}</Body>
              <Caption>{new Date(o.completedAt ?? o.updatedAt).toLocaleString()} · {o.status}</Caption>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
