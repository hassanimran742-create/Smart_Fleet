import { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth';
import { PhoneScreen } from '../screens/auth/PhoneScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { DistributorStack } from './DistributorStack';
import { DriverStack } from './DriverStack';
import { ActivityIndicator, View } from 'react-native';

const Stack = createNativeStackNavigator();

interface Props { variant: 'distributor' | 'driver' }

export function RootNavigator({ variant }: Props) {
  const { token, loading, init } = useAuthStore();

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

  return variant === 'driver' ? <DriverStack /> : <DistributorStack />;
}
