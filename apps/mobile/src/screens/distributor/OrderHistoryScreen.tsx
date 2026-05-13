import { FlatList, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';

export function OrderHistoryScreen() {
  const nav = useNavigation<any>();
  const { data } = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
    refetchInterval: 20000,
  });

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(o: any) => o.id}
      contentContainerStyle={{ padding: 16 }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => nav.navigate('TrackOrder', { orderId: item.id })}
          style={{ padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8, backgroundColor: 'white' }}
        >
          <Text style={{ fontWeight: '600' }}>{item.deliveryAddressLabel}</Text>
          <Text>Status: {item.status}</Text>
          <Text>Payment: {item.paymentStatus}</Text>
          <Text style={{ color: '#0f6cf0', marginTop: 4 }}>Tap to track →</Text>
          <Text style={{ color: '#888', fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
        </Pressable>
      )}
    />
  );
}
