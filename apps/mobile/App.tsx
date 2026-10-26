import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme, type Theme } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import i18n from './src/i18n';
import { loadSavedLanguage } from './src/i18n/persist';
import { APP_VARIANT } from './src/api/appInfo';
import { bindAppStateFocus, bindReconnectRefetch, queryClient } from './src/api/queryClient';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ConfirmHost, ToastHost, Text, colors, preloadIconFont, space } from './src/ui';

/** The navigation theme in design tokens, so no screen flashes another colour between transitions. */
const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.brand,
    background: colors.canvas,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

/** The longest the boot waits for an over-the-air update before running the cached bundle. */
const UPDATE_CHECK_TIMEOUT_MS = 3000;

/**
 * Check for an EAS Update at boot and apply it BEFORE rendering the app.
 *
 * Default expo-updates behaviour is: check on launch, download in background, apply on the NEXT
 * launch. That makes every fix take two cold restarts to land, which is confusing for operators. This
 * forces a synchronous check: if a new update is downloaded, we reload immediately, so the user sees
 * the latest bundle on the very next open.
 *
 * Cap the wait at 3 seconds: if Expo's CDN is slow or unreachable we fall back to the cached bundle
 * instead of leaving the user staring at a spinner.
 */
async function maybeApplyUpdate(): Promise<void> {
  if (__DEV__) return; // dev builds don't use EAS Update
  if (!Updates.isEnabled) return;
  try {
    const check = await Promise.race([
      Updates.checkForUpdateAsync(),
      new Promise<{ isAvailable: false }>((resolve) =>
        setTimeout(() => resolve({ isAvailable: false }), UPDATE_CHECK_TIMEOUT_MS),
      ),
    ]);
    if (check.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Network / CDN error: just run the cached bundle.
  }
}

export default function App() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void loadSavedLanguage();
    // The icon font loads while the update check runs, so icons never flash in empty.
    void Promise.all([maybeApplyUpdate(), preloadIconFont()]).finally(() => setBooted(true));
  }, []);

  // React Query: refetch stale data when the app returns to the foreground, pause polling in the
  // background, and refetch on-screen data when the network comes back (UX_MOBILE §3.5).
  useEffect(() => {
    const unbindFocus = bindAppStateFocus();
    const unbindReconnect = bindReconnectRefetch(queryClient);
    return () => {
      unbindFocus();
      unbindReconnect();
    };
  }, []);

  if (!booted) {
    return (
      <View style={styles.boot} accessibilityLabel={i18n.t('common.loading')}>
        <ActivityIndicator size="large" color={colors.onBrand} />
        <Text variant="bodyStrong" tone="onBrand">
          {i18n.t('common.loading')}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator variant={APP_VARIANT} />
        </NavigationContainer>
        <ToastHost />
        <ConfirmHost />
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    backgroundColor: colors.brand,
  },
});
