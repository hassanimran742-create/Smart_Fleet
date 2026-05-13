import { SectionList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface Row {
  holderType: 'DISTRIBUTOR' | 'STORE' | 'VEHICLE' | 'CLIENT';
  holderId: string;
  holderLabel: string;
  cylinderTypeCode: string;
  state: 'FULL' | 'EMPTY';
  count: number;
}

export function DistributorInventoryScreen() {
  const { data } = useQuery({
    queryKey: ['my-inventory'],
    queryFn: async () => (await api.get<Row[]>('/inventory/me')).data,
    refetchInterval: 30000,
  });

  // Group by holderType
  const byType: Record<string, Row[]> = {};
  for (const r of data ?? []) {
    byType[r.holderType] ??= [];
    byType[r.holderType].push(r);
  }
  const sections = Object.entries(byType).map(([title, rows]) => ({ title, data: rows }));

  if (!data) return <Text style={{ padding: 24 }}>Loading…</Text>;
  if (data.length === 0) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: '#888' }}>
          No inventory tracked yet. Cylinders show up here after they're registered and scanned.
        </Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item, i) => `${item.holderId}-${item.cylinderTypeCode}-${item.state}-${i}`}
      renderSectionHeader={({ section }) => (
        <View style={{ backgroundColor: '#eef', padding: 8 }}>
          <Text style={{ fontWeight: '600' }}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={{ padding: 12, borderBottomWidth: 1, borderColor: '#eee' }}>
          <Text>{item.holderLabel}</Text>
          <Text style={{ color: '#666' }}>
            {item.cylinderTypeCode} · {item.state} · count: {item.count}
          </Text>
        </View>
      )}
    />
  );
}
