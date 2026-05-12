import { Button, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export function DriverHomeScreen() {
  const nav = useNavigation<any>();
  const { clear } = useAuthStore();
  const trips = useQuery({
    queryKey: ['my-trips'],
    queryFn: async () => (await api.get('/trips/mine')).data,
  });
  const active = (trips.data ?? []).find((t: any) => t.status === 'PLANNED' || t.status === 'IN_PROGRESS');

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20 }}>Welcome, driver</Text>
      {active ? (
        <Button title={`Active trip · ${active.stops.length} stops`} onPress={() => nav.navigate('ActiveTrip', { tripId: active.id })} />
      ) : (
        <Text>No active trip — you'll be notified on assignment.</Text>
      )}
      <Button title="Scan cylinder" onPress={() => nav.navigate('Scan')} />
      <Button title="End of day reconciliation" onPress={() => nav.navigate('Reconcile')} />
      <Button title="Sign out" color="#d33a3a" onPress={() => clear()} />
    </View>
  );
}
