import { Alert, Button, FlatList, Linking, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';

export function ActiveTripScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const tripId = route.params?.tripId;
  const qc = useQueryClient();

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => (await api.get(`/trips/${tripId}`)).data,
    enabled: !!tripId,
    refetchInterval: 10000,
  });

  const setTripStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/trips/${tripId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });

  const setOrderStatus = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', tripId] }),
  });

  if (!trip) return <Text style={{ padding: 24 }}>Loading…</Text>;

  function openNav(stop: any) {
    const loc = stop.location?.coordinates;
    if (!loc) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${loc[1]},${loc[0]}`);
  }

  function goScan(stop: any) {
    const eventType =
      stop.stopType === 'STORE_PICKUP'
        ? 'SCAN_OUT'
        : stop.stopType === 'DELIVERY'
          ? 'DELIVERED'
          : 'SCAN_IN';
    nav.navigate('Scan', { eventType, tripId, orderId: stop.orderId });
  }

  return (
    <FlatList
      data={trip.stops}
      keyExtractor={(s: any) => s.id}
      ListHeaderComponent={
        <View style={{ padding: 16, gap: 8 }}>
          <Text style={{ fontWeight: '600', fontSize: 16 }}>Trip {trip.id.slice(0, 8)}</Text>
          <Text>Status: {trip.status}</Text>
          {trip.status === 'PLANNED' && (
            <Button title="Start trip (mark on the way)" onPress={() => setTripStatus.mutate('IN_PROGRESS')} />
          )}
          {trip.status === 'IN_PROGRESS' && (
            <Button title="Complete trip" color="#1ea675" onPress={() => {
              Alert.alert('Complete?', 'Make sure every stop is done.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Complete', onPress: () => setTripStatus.mutate('COMPLETED') },
              ]);
            }} />
          )}
        </View>
      }
      renderItem={({ item }: any) => (
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: '#eee', gap: 4 }}>
          <Text style={{ fontWeight: '500' }}>
            {item.seq + 1}. {item.stopType}
            {item.orderId ? ` · order ${item.orderId.slice(0, 6)}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button title="Navigate" onPress={() => openNav(item)} />
            <Button title="Scan cylinders" onPress={() => goScan(item)} />
            {item.stopType === 'DELIVERY' && item.orderId && (
              <Button
                title="Mark delivered"
                color="#1ea675"
                onPress={() => setOrderStatus.mutate({ orderId: item.orderId, status: 'DELIVERED' })}
              />
            )}
          </View>
        </View>
      )}
    />
  );
}
