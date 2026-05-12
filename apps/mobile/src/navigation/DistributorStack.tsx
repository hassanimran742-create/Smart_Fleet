import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DistributorHomeScreen } from '../screens/distributor/HomeScreen';
import { PlaceOrderScreen } from '../screens/distributor/PlaceOrderScreen';
import { OrderHistoryScreen } from '../screens/distributor/OrderHistoryScreen';
import { LedgerScreen } from '../screens/distributor/LedgerScreen';
import { TopupScreen } from '../screens/distributor/TopupScreen';

const Stack = createNativeStackNavigator();

export function DistributorStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={DistributorHomeScreen} options={{ title: 'Smart_Fleet' }} />
      <Stack.Screen name="PlaceOrder" component={PlaceOrderScreen} options={{ title: 'New order' }} />
      <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="Ledger" component={LedgerScreen} options={{ title: 'Ledger' }} />
      <Stack.Screen name="Topup" component={TopupScreen} options={{ title: 'Top up' }} />
    </Stack.Navigator>
  );
}
