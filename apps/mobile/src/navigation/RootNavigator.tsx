import { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth';
import { PhoneScreen } from '../screens/auth/PhoneScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { DistributorStack } from './DistributorStack';
import { DriverStack } from './DriverStack';
import { ClientStack } from './ClientStack';
import { ActivityIndicator, View } from 'react-native';

const Stack = createNativeStackNavigator();

interface Props { variant: 'distributor' | 'driver' }

export function RootNavigator({ variant }: Props) {
  const { token, role, loading, init } = useAuthStore();

  useEffect(() => { init(); }, []);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }

  if (!token) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Phone" component={PhoneScreen} />
        <Stack.Screen name="Otp" component={OtpScreen} />
      </Stack.Navigator>
    );
  }

  // Route by JWT role after login — auto-detects client/driver/distributor.
  // The build-time `variant` is a fallback for non-CLIENT/DRIVER roles.
  if (role === 'CLIENT') return <ClientStack />;
  if (role === 'DRIVER') return <DriverStack />;
  return <DistributorStack />;
}
