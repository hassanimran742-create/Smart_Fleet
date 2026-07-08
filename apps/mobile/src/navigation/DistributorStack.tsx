import { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DistributorHomeScreen } from '../screens/distributor/HomeScreen';
import { PlaceOrderScreen } from '../screens/distributor/PlaceOrderScreen';
import { OrderHistoryScreen } from '../screens/distributor/OrderHistoryScreen';
import { TopupScreen } from '../screens/distributor/TopupScreen';
import { TrackOrderScreen } from '../screens/distributor/TrackOrderScreen';
import { RequestFillingScreen } from '../screens/distributor/RequestFillingScreen';
import { AddClientScreen } from '../screens/distributor/AddClientScreen';
import { ProfileScreen } from '../screens/distributor/ProfileScreen';
import { NotificationsScreen } from '../screens/distributor/NotificationsScreen';
import { AboutScreen } from '../screens/distributor/AboutScreen';
import { HamburgerButton, SideMenu } from '../components/SideMenu';

const Stack = createNativeStackNavigator();

export function DistributorStack() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={DistributorHomeScreen}
          options={{
            title: 'LPG Management',
            headerRight: () => <HamburgerButton onPress={() => setMenuOpen(true)} />,
          }}
        />
        <Stack.Screen name="PlaceOrder" component={PlaceOrderScreen} options={{ title: 'New order' }} />
        <Stack.Screen name="AddClient" component={AddClientScreen} options={{ title: 'Add new client' }} />
        <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} options={{ title: 'My orders' }} />
        <Stack.Screen name="TrackOrder" component={TrackOrderScreen} options={{ title: 'Track order' }} />
        <Stack.Screen name="Topup" component={TopupScreen} options={{ title: 'Top up balance' }} />
        <Stack.Screen name="RequestFilling" component={RequestFillingScreen} options={{ title: 'Refill cylinders' }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile settings' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
        <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      </Stack.Navigator>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} variant="distributor" />
    </>
  );
}
