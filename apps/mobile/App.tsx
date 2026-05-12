import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { RootNavigator } from './src/navigation/RootNavigator';
import './src/i18n';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const variant = (Constants.expoConfig?.extra?.variant ?? 'distributor') as 'distributor' | 'driver';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <RootNavigator variant={variant} />
      </NavigationContainer>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}
