import { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClientHomeScreen } from '../screens/client/HomeScreen';
import { DeliveryDetailScreen } from '../screens/client/DeliveryDetailScreen';
import { ScanScreen } from '../screens/driver/ScanScreen';
import { AboutScreen } from '../screens/distributor/AboutScreen';
import { HamburgerButton, SideMenu } from '../components/SideMenu';

const Stack = createNativeStackNavigator();

export function ClientStack() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={ClientHomeScreen}
          options={{
            title: 'My Deliveries',
            headerRight: () => <HamburgerButton onPress={() => setMenuOpen(true)} />,
          }}
        />
        <Stack.Screen name="DeliveryDetail" component={DeliveryDetailScreen} options={{ title: 'Delivery' }} />
        <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan' }} />
        <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      </Stack.Navigator>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} variant="client" />
    </>
  );
}
