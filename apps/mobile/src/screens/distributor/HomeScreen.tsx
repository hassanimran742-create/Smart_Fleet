import { Button, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export function DistributorHomeScreen() {
  const nav = useNavigation<any>();
  const { t } = useTranslation();
  const { clear } = useAuthStore();
  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: async () => (await api.get('/ledger/balance')).data,
  });
  const orders = useQuery({
    queryKey: ['orders-mine'],
    queryFn: async () => (await api.get('/orders')).data,
  });
  const inProgress = (orders.data ?? []).filter((o: any) =>
    ['PENDING', 'ASSIGNED', 'IN_TRANSIT'].includes(o.status),
  ).length;

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <View style={{ padding: 16, backgroundColor: '#eef6ff', borderRadius: 8 }}>
        <Text style={{ color: '#666', fontSize: 12 }}>Advance balance</Text>
        <Text style={{ fontSize: 22, fontWeight: '600' }}>
          {balance.data ? `Rs. ${(Number(balance.data.balancePaisa) / 100).toLocaleString()}` : '…'}
        </Text>
        <Text style={{ color: '#666', marginTop: 8 }}>{inProgress} orders in progress</Text>
      </View>

      <Button title={t('newOrder')} onPress={() => nav.navigate('PlaceOrder')} />
      <Button title={t('orders')} onPress={() => nav.navigate('OrderHistory')} />
      <Button title="Inventory" onPress={() => nav.navigate('Inventory')} />
      <Button title="Analytics" onPress={() => nav.navigate('Analytics')} />
      <Button title="Ledger" onPress={() => nav.navigate('Ledger')} />
      <Button title="Top up" onPress={() => nav.navigate('Topup')} />
      <Button title={t('logout')} color="#d33a3a" onPress={() => clear()} />
    </View>
  );
}
