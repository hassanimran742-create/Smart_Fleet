import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DistributorHomeScreen } from '../screens/distributor/HomeScreen';
import { PlaceOrderScreen } from '../screens/distributor/PlaceOrderScreen';
import { OrderHistoryScreen } from '../screens/distributor/OrderHistoryScreen';
import { LedgerScreen } from '../screens/distributor/LedgerScreen';
import { TopupScreen } from '../screens/distributor/TopupScreen';
import { TrackOrderScreen } from '../screens/distributor/TrackOrderScreen';
import { DistributorInventoryScreen } from '../screens/distributor/InventoryScreen';
import { AnalyticsScreen } from '../screens/distributor/AnalyticsScreen';
import { RequestFillingScreen } from '../screens/distributor/RequestFillingScreen';

const Stack = createNativeStackNavigator();

export function DistributorStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={DistributorHomeScreen} options={{ title: 'LPG Management' }} />
      <Stack.Screen name="PlaceOrder" component={PlaceOrderScreen} options={{ title: 'New order' }} />
      <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="TrackOrder" component={TrackOrderScreen} options={{ title: 'Track order' }} />
      <Stack.Screen name="Ledger" component={LedgerScreen} options={{ title: 'Ledger' }} />
      <Stack.Screen name="Topup" component={TopupScreen} options={{ title: 'Top up' }} />
      <Stack.Screen name="Inventory" component={DistributorInventoryScreen} options={{ title: 'Inventory' }} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ title: 'Analytics' }} />
      <Stack.Screen name="RequestFilling" component={RequestFillingScreen} options={{ title: 'Filling order' }} />
    </Stack.Navigator>
  );
}
