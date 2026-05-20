import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DriverHomeScreen } from '../screens/driver/HomeScreen';
import { ActiveTripScreen } from '../screens/driver/ActiveTripScreen';
import { ScanScreen } from '../screens/driver/ScanScreen';
import { ReconcileScreen } from '../screens/driver/ReconcileScreen';
import { FuelRefillScreen } from '../screens/driver/FuelRefillScreen';
import { DriverFillingOrdersScreen } from '../screens/driver/FillingOrdersScreen';

const Stack = createNativeStackNavigator();

export function DriverStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={DriverHomeScreen} options={{ title: 'LPG Management — Driver' }} />
      <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} options={{ title: 'Active trip' }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan cylinder' }} />
      <Stack.Screen name="Reconcile" component={ReconcileScreen} options={{ title: 'End of day' }} />
      <Stack.Screen name="FuelRefill" component={FuelRefillScreen} options={{ title: 'Record fuel refill' }} />
      <Stack.Screen name="FillingRuns" component={DriverFillingOrdersScreen} options={{ title: 'My filling runs' }} />
    </Stack.Navigator>
  );
}
