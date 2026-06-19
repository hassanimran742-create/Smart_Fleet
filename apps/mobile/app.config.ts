import { ExpoConfig } from '@expo/config-types';

const variant = (process.env.APP_VARIANT ?? 'distributor') as 'distributor' | 'driver';

const baseName = 'LPG Management';
const isDriver = variant === 'driver';

// One Expo project per slug. Distributor created via `eas init`.
// Driver project gets its own id (set EAS_PROJECT_ID_DRIVER) after its eas init.
const projectId = isDriver
  ? (process.env.EAS_PROJECT_ID_DRIVER ?? '')
  : '0edc05a5-2034-4838-a24a-62194d799503';

const config: ExpoConfig = {
  name: isDriver ? `${baseName} Driver` : `${baseName}`,
  slug: isDriver ? 'smartfleet-driver' : 'smartfleet-distributor',
  scheme: isDriver ? 'smartfleet-driver' : 'smartfleet',
  version: '0.1.0',
  orientation: 'portrait',
  // EAS Update (OTA): lets us push JS-only fixes without a new APK.
  runtimeVersion: { policy: 'appVersion' },
  ...(projectId
    ? { updates: { url: `https://u.expo.dev/${projectId}` } }
    : {}),
  // icon omitted until real assets ship; Expo falls back to a default icon.
  // A splash backgroundColor is required so the Android prebuild generates the
  // splashscreen_background color resource (without it, AAPT resource linking
  // fails: "resource color/splashscreen_background not found").
  splash: {
    backgroundColor: '#0F6CF0',
    resizeMode: 'contain',
  },
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
    // Google Maps SDK for Android — needed for the distributor app's location
    // picker (AddClient, PlaceOrder, TrackOrder). Maps SDK display is free of
    // charge; key is restricted to package + SHA-1 at the Google Cloud Console.
    // Provided as an EAS secret named GOOGLE_MAPS_ANDROID_API_KEY.
    config: isDriver
      ? undefined
      : {
          googleMaps: {
            apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '',
          },
        },
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1',
    variant,
    eas: { projectId },
  },
  owner: 'huzaifalodhi07',
  plugins: [
    'expo-camera',
    'expo-location',
    'expo-notifications',
    ['expo-secure-store', { faceIDPermission: 'Used to unlock saved credentials.' }],
    ...(isDriver ? ['expo-task-manager'] : []),
  ],
};

export default config;
