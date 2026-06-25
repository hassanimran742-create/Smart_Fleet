import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { RootNavigator } from './src/navigation/RootNavigator';
import './src/i18n';
import { loadSavedLanguage } from './src/i18n/persist';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const variant = (Constants.expoConfig?.extra?.variant ?? 'distributor') as 'distributor' | 'driver';

/**
 * Check for an EAS Update at boot and apply it BEFORE rendering the app.
 *
 * Default expo-updates behavior is: check on launch, download in background,
 * apply on the NEXT launch. That makes every fix take two cold restarts to
 * land, which is confusing for operators. This forces a synchronous check:
 * if a new update is downloaded, we reload immediately, so the user sees the
 * latest bundle on the very next open.
 *
 * Cap the wait at 3 seconds — if Expo's CDN is slow or unreachable we fall
 * back to the cached bundle instead of leaving the user staring at a spinner.
 */
async function maybeApplyUpdate(): Promise<void> {
  if (__DEV__) return; // dev builds don't use EAS Update
  if (!Updates.isEnabled) return;
  try {
    const check = await Promise.race([
      Updates.checkForUpdateAsync(),
      new Promise<{ isAvailable: false }>((resolve) =>
        setTimeout(() => resolve({ isAvailable: false }), 3000),
      ),
    ]);
    if ((check as any).isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Network / CDN error — just run the cached bundle.
  }
}

export default function App() {
  const [updateCheckDone, setUpdateCheckDone] = useState(false);

  useEffect(() => {
    loadSavedLanguage();
    maybeApplyUpdate().finally(() => setUpdateCheckDone(true));
  }, []);

  if (!updateCheckDone) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F6CF0' }}>
        <ActivityIndicator size="large" color="white" />
        <Text style={{ color: 'white', marginTop: 12, fontWeight: '600' }}>Loading…</Text>
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <RootNavigator variant={variant} />
      </NavigationContainer>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}
