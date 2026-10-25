import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HamburgerButton, SideMenu } from '../components/SideMenu';
import { useTodayTitle } from '../screens/driver/components';
import { DriverHelpScreen } from '../screens/driver/HelpScreen';
import { LoadScreen } from '../screens/driver/LoadScreen';
import { useNewTripPush } from '../screens/driver/push';
import { RefillRunScreen } from '../screens/driver/RefillRunScreen';
import { RefillsScreen } from '../screens/driver/RefillsScreen';
import { TodayScreen } from '../screens/driver/TodayScreen';
import { TripScreen } from '../screens/driver/TripScreen';
import { UnloadScreen } from '../screens/driver/UnloadScreen';
import { VanScreen } from '../screens/driver/VanScreen';
import { VisitScreen } from '../screens/driver/VisitScreen';
import { HeaderCallOfficeButton, makeScreenOptions, useReduceMotion } from '../ui';

/**
 * The driver app's routes (UX_MOBILE §3.6 typed routes, §7.2; driver spec §1.9, R2–R10). Today → Trip →
 * a step: Load at the store, the Visit to each customer (on the way, deliver, take back, done) and
 * Unload, where the shop scans the cylinders in. Each scanning step holds its own camera, so there is no
 * scan screen. Refills is a list, and each refill runs on its own screen (pick up, fill, unload).
 * Profile is merged into Help. Fuel refill, Notifications, Transfers and Reconcile are not in the pilot
 * (UX_MOBILE Appendix A).
 */
export type DriverStackParams = {
  Home: undefined;
  Trip: { tripId: string };
  /** The store's Load step. */
  Load: { tripId: string; stopId: string };
  /** One customer's visit. */
  Visit: { tripId: string; stopId: string };
  /** The trip's last step: unload at the store. */
  Unload: { tripId: string };
  Refills: undefined;
  RefillRun: { refillId: string };
  Van: undefined;
  Help: undefined;
};

const Stack = createNativeStackNavigator<DriverStackParams>();

/** Today's header: "Call office" (on every driver screen, also offline) and the menu. */
function HomeHeaderActions({ onMenu }: { onMenu: () => void }) {
  return (
    <View style={styles.actions}>
      <HeaderCallOfficeButton />
      <HamburgerButton onPress={onMenu} />
    </View>
  );
}

/** The driver app: mounted by RootNavigator for the driver build once the gates pass. */
export function DriverStack() {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const today = useTodayTitle();
  // "New trip" pushes open Today (R8): registered once per sign-in, best effort.
  useNewTripPush();

  return (
    <>
      <Stack.Navigator
        screenOptions={{
          ...makeScreenOptions({ reduceMotion }),
          headerRight: () => <HeaderCallOfficeButton />,
        }}
      >
        <Stack.Screen
          name="Home"
          component={TodayScreen}
          options={{
            title: today,
            headerRight: () => <HomeHeaderActions onMenu={() => setMenuOpen(true)} />,
          }}
        />
        <Stack.Screen name="Trip" component={TripScreen} options={{ title: t('driver.nav.trip') }} />
        {/* The step screens set "Step 2 of 3" themselves, from the trip. */}
        <Stack.Screen name="Load" component={LoadScreen} options={{ title: '' }} />
        <Stack.Screen name="Visit" component={VisitScreen} options={{ title: '' }} />
        <Stack.Screen name="Unload" component={UnloadScreen} options={{ title: '' }} />
        <Stack.Screen name="Refills" component={RefillsScreen} options={{ title: t('driver.menu.refills') }} />
        <Stack.Screen name="RefillRun" component={RefillRunScreen} options={{ title: t('driver.nav.refill') }} />
        <Stack.Screen name="Van" component={VanScreen} options={{ title: t('common.menu.van') }} />
        <Stack.Screen name="Help" component={DriverHelpScreen} options={{ title: t('common.menu.help') }} />
      </Stack.Navigator>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} variant="driver" />
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center' },
});
