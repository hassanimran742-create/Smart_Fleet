import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { useLiveLocation } from '../../hooks/useLiveLocation';
import { Body, Button, Card, Caption, Heading, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

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
  const active = (trips.data ?? []).find((t: any) => t.status === 'PLANNED' || t.status === 'IN_PROGRESS');

  return (
    <Screen scroll>
      <Card style={{ backgroundColor: colors.primary }}>
        <Caption style={{ color: '#dbe7ff' }}>Welcome back, driver</Caption>
        <Heading size="h2" style={{ color: 'white', marginTop: 4 }}>
          {online ? 'You are online' : 'You are offline'}
        </Heading>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.sm }}>
          <Switch value={online} onValueChange={setOnline} />
          <Body style={{ color: 'white' }}>{online ? 'Sharing live location' : 'Toggle on to receive trips'}</Body>
        </View>
      </Card>

      {active ? (
        <Card>
          <Pill label="Active trip" tone="primary" />
          <Heading size="h3" style={{ marginTop: space.sm }}>
            Trip {active.id.slice(0, 8)}
          </Heading>
          <Caption style={{ marginTop: 2 }}>
            {active.stops?.length ?? 0} stop(s) · {active.status}
          </Caption>
          <Button
            title="Open trip"
            onPress={() => nav.navigate('ActiveTrip', { tripId: active.id })}
            style={{ marginTop: space.md }}
          />
        </Card>
      ) : (
        <Card>
          <Heading size="h3">No active trip</Heading>
          <Caption style={{ marginTop: 4 }}>
            You'll be notified when an order is assigned to you.
          </Caption>
        </Card>
      )}

      <View style={{ gap: space.sm }}>
        <Button title="Scan a cylinder" onPress={() => nav.navigate('Scan')} />
        <Button title="My filling runs" variant="secondary" onPress={() => nav.navigate('FillingRuns')} />
        <Button title="Record fuel refill" variant="secondary" onPress={() => nav.navigate('FuelRefill')} />
        <Button title="End of day reconciliation" variant="secondary" onPress={() => nav.navigate('Reconcile')} />
      </View>

      <View style={{ marginTop: space.lg }}>
        <Button title="Sign out" variant="ghost" onPress={() => clear()} />
      </View>
    </Screen>
  );
}
