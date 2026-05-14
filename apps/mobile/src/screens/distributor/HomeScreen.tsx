import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { Body, Button, Card, Caption, Heading, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

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
  const delivered = (orders.data ?? []).filter((o: any) => o.status === 'DELIVERED').length;

  return (
    <Screen scroll>
      <Card style={{ backgroundColor: colors.primary }}>
        <Caption style={{ color: '#dbe7ff' }}>Advance balance</Caption>
        <Heading size="h1" style={{ color: 'white', marginTop: 4 }}>
          {balance.data ? `Rs. ${(Number(balance.data.balancePaisa) / 100).toLocaleString()}` : '…'}
        </Heading>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Pill label={`${inProgress} in progress`} tone="warn" />
          <Pill label={`${delivered} delivered`} tone="ok" />
        </View>
      </Card>

      <View style={{ gap: space.sm }}>
        <Button title={t('newOrder') ?? 'New order'} onPress={() => nav.navigate('PlaceOrder')} />
        <Button title={t('orders') ?? 'My orders'} variant="secondary" onPress={() => nav.navigate('OrderHistory')} />
        <Button title="Inventory" variant="secondary" onPress={() => nav.navigate('Inventory')} />
        <Button title="Analytics" variant="secondary" onPress={() => nav.navigate('Analytics')} />
        <Button title="Ledger" variant="secondary" onPress={() => nav.navigate('Ledger')} />
        <Button title="Top up balance" variant="secondary" onPress={() => nav.navigate('Topup')} />
      </View>

      <View style={{ marginTop: space.lg }}>
        <Button title={t('logout') ?? 'Sign out'} variant="ghost" onPress={() => clear()} />
      </View>
    </Screen>
  );
}
