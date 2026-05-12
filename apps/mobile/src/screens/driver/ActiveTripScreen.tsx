import { Button, FlatList, Linking, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRoute } from '@react-navigation/native';
import { api } from '../../api/client';

export function ActiveTripScreen() {
  const route = useRoute<any>();
  const tripId = route.params?.tripId;
  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => (await api.get(`/trips/${tripId}`)).data,
    enabled: !!tripId,
  });

  if (!trip) return <Text style={{ padding: 24 }}>Loading…</Text>;

  return (
    <FlatList
      data={trip.stops}
      keyExtractor={(s: any) => s.id}
      ListHeaderComponent={
        <View style={{ padding: 16 }}>
          <Text style={{ fontWeight: '600' }}>Trip {trip.id.slice(0, 8)}</Text>
          <Text>Status: {trip.status}</Text>
          <Button
            title="Start trip"
            onPress={() => api.patch(`/trips/${trip.id}/status`, { status: 'IN_PROGRESS' })}
          />
        </View>
      }
      renderItem={({ item }: any) => (
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: '#eee' }}>
          <Text>{item.seq + 1}. {item.stopType}</Text>
          <Button
            title="Navigate"
            onPress={() => {
              const loc = item.location?.coordinates;
              if (loc) Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${loc[1]},${loc[0]}`);
            }}
          />
        </View>
      )}
    />
  );
}
