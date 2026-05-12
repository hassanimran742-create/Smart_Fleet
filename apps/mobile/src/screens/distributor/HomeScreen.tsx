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

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 16 }}>
        Advance balance: {balance.data ? `Rs. ${Number(balance.data.balancePaisa) / 100}` : '…'}
      </Text>
      <Button title={t('newOrder')} onPress={() => nav.navigate('PlaceOrder')} />
      <Button title={t('orders')} onPress={() => nav.navigate('OrderHistory')} />
      <Button title="Ledger" onPress={() => nav.navigate('Ledger')} />
      <Button title="Top up" onPress={() => nav.navigate('Topup')} />
      <Button title={t('logout')} color="#d33a3a" onPress={() => clear()} />
    </View>
  );
}
