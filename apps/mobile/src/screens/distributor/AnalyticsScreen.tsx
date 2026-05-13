import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export function AnalyticsScreen() {
  const orders = useQuery({
    queryKey: ['orders-mine-analytics'],
    queryFn: async () => (await api.get('/orders')).data,
  });
  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: async () => (await api.get('/ledger/balance')).data,
  });
  const inventory = useQuery({
    queryKey: ['my-inventory'],
    queryFn: async () => (await api.get('/inventory/me')).data,
  });

  const data = orders.data ?? [];
  const last30 = data.filter((o: any) => Date.now() - new Date(o.createdAt).getTime() < 30 * 24 * 3600 * 1000);
  const delivered = data.filter((o: any) => o.status === 'DELIVERED');
  const pending = data.filter((o: any) => o.status === 'PENDING' || o.status === 'ASSIGNED' || o.status === 'IN_TRANSIT');
  const totalSpentPaisa = delivered.reduce((s: number, o: any) => s + Number(o.deliveryFeePaisa), 0);

  const cylindersByState: Record<string, number> = { FULL: 0, EMPTY: 0 };
  for (const r of (inventory.data ?? []) as any[]) {
    cylindersByState[r.state] = (cylindersByState[r.state] ?? 0) + r.count;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card title="Advance balance" value={balance.data ? `Rs. ${(Number(balance.data.balancePaisa) / 100).toLocaleString()}` : '…'} />
      <Card title="Orders (last 30 days)" value={String(last30.length)} />
      <Card title="In progress" value={String(pending.length)} />
      <Card title="Delivered (all-time)" value={String(delivered.length)} />
      <Card title="Total delivery spend (delivered)" value={`Rs. ${(totalSpentPaisa / 100).toLocaleString()}`} />
      <Card title="Cylinders full / empty" value={`${cylindersByState.FULL} / ${cylindersByState.EMPTY}`} />
    </ScrollView>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <View style={{ padding: 16, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#eee' }}>
      <Text style={{ color: '#888', fontSize: 12 }}>{title}</Text>
      <Text style={{ fontSize: 20, fontWeight: '600', marginTop: 4 }}>{value}</Text>
    </View>
  );
}
