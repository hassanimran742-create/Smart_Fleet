import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { onBeforeSignOut } from '../../api/session';

/**
 * The "New trip" push (driver spec R8; UX_MOBILE §7.2): the server sends "New trip" / "Sana · load at
 * Ahmed Gas Store" to the driver's phone, and a tap opens Today.
 *
 * The phone's part, best effort and never in the driver's way:
 * - after sign-in, get this phone's Expo push token and register it (`POST /push-tokens`); a token
 *   another driver held moves to this one;
 * - a tap on the notification opens Today;
 * - before signing out, `forgetPushToken()` removes the token (`DELETE /push-tokens`), so a signed-out
 *   phone gets no more trips.
 *
 * `expo-notifications` is in the 0.1.0 binary, but Android needs the FCM setup of the 0.2.0 APK (UX_MOBILE
 * §7.0) to hand out a token. Until then getting the token fails, quietly, and nothing is asked: the
 * permission is requested only once a token exists. The require is guarded like `expo-keep-awake`'s.
 */
type NotificationsModule = typeof import('expo-notifications');

const notifications: NotificationsModule | null = (() => {
  try {
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
})();

/** The token registered by this app run, removed again before signing out. */
let registeredToken: string | null = null;

async function registerPushToken(): Promise<void> {
  if (!notifications) return;
  try {
    const { data: token } = await notifications.getExpoPushTokenAsync();
    if (!token) return;
    const permission = await notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) await notifications.requestPermissionsAsync();
    await api.post('/push-tokens', { token, platform: Platform.OS });
    registeredToken = token;
  } catch {
    // No push on this phone yet (the 0.1.0 APK has no FCM setup) or no signal: Today still polls.
  }
}

/**
 * Removes this phone's push token before signing out (`DELETE /push-tokens { token }`). Best effort: a
 * failure never stops the sign-out, and the next sign-in on this phone moves the token anyway.
 */
export async function forgetPushToken(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  try {
    await api.delete('/push-tokens', { data: { token } });
  } catch {
    // The server keeps a stale token; the next sign-in on this phone takes it over.
  }
}

// Signing out removes this phone's token first (R8, DRV-048 E3), best effort and never longer than 3 s.
onBeforeSignOut(forgetPushToken);

/** Registers the phone for "New trip" pushes and opens Today when one is tapped (DriverStack). */
export function useNewTripPush(): void {
  const navigation = useNavigation();

  useEffect(() => {
    void registerPushToken();
  }, []);

  useEffect(() => {
    if (!notifications) return;
    const openToday = () => {
      // Outside a screen this is the container: before it is ready the app opens on Today anyway.
      const container = navigation as unknown as { isReady?: () => boolean };
      if (container.isReady && !container.isReady()) return;
      try {
        navigation.navigate('Home' as never);
      } catch {
        // No driver stack to open (signed out meanwhile): nothing to do.
      }
    };
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = notifications.addNotificationResponseReceivedListener(openToday);
      void notifications
        .getLastNotificationResponseAsync()
        .then((response) => {
          if (response) openToday();
        })
        .catch(() => undefined);
    } catch {
      subscription = null;
    }
    return () => subscription?.remove();
  }, [navigation]);
}
