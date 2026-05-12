import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export function OrderHistoryScreen() {
  const { data } = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
  });

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(o: any) => o.id}
      contentContainerStyle={{ padding: 16 }}
      renderItem={({ item }) => (
        <View style={{ padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ fontWeight: '600' }}>{item.deliveryAddressLabel}</Text>
          <Text>Status: {item.status}</Text>
          <Text>Payment: {item.paymentStatus}</Text>
          <Text style={{ color: '#888', fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
        </View>
      )}
    />
  );
}
