import { ExpoConfig } from '@expo/config-types';

const variant = (process.env.APP_VARIANT ?? 'distributor') as 'distributor' | 'driver';

const baseName = 'LPG Management';
const isDriver = variant === 'driver';

const config: ExpoConfig = {
  name: isDriver ? `${baseName} Driver` : `${baseName}`,
  slug: isDriver ? 'smartfleet-driver' : 'smartfleet-distributor',
  scheme: isDriver ? 'smartfleet-driver' : 'smartfleet',
  version: '0.1.0',
  orientation: 'portrait',
  // icon and splash references intentionally omitted until real assets
  // ship with the repo. Expo falls back to a default icon + splash.
  userInterfaceStyle: 'light',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: isDriver ? 'com.smartfleet.driver' : 'com.smartfleet.distributor',
    infoPlist: {
      NSCameraUsageDescription: 'Scan cylinder QR codes for chain-of-custody.',
      NSLocationWhenInUseUsageDescription: 'Show nearby stores and track deliveries.',
      ...(isDriver
        ? {
            NSLocationAlwaysAndWhenInUseUsageDescription:
              'Live driver location is required while on active deliveries.',
            UIBackgroundModes: ['location', 'fetch'],
          }
        : {}),
    },
  },
  android: {
    package: isDriver ? 'com.smartfleet.driver' : 'com.smartfleet.distributor',
    permissions: [
      'CAMERA',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      ...(isDriver ? ['ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE'] : []),
    ],
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1',
    variant,
  },
  plugins: [
    'expo-camera',
    'expo-location',
    'expo-notifications',
    ['expo-secure-store', { faceIDPermission: 'Used to unlock saved credentials.' }],
    ...(isDriver ? ['expo-task-manager'] : []),
  ],
};

export default config;
