import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export function LedgerScreen() {
  const { data } = useQuery({
    queryKey: ['ledger-mine'],
    queryFn: async () => (await api.get('/ledger/me')).data,
  });

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(e: any) => e.id}
      contentContainerStyle={{ padding: 16 }}
      renderItem={({ item }) => (
        <View style={{ padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8 }}>
          <Text>{item.entryType}</Text>
          <Text>{Number(item.amountPaisa) / 100} PKR</Text>
          <Text>Balance after: {Number(item.balanceAfterPaisa) / 100} PKR</Text>
          <Text style={{ color: '#888', fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
        </View>
      )}
    />
  );
}
