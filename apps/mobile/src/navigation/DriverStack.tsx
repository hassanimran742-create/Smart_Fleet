import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HamburgerButton, SideMenu } from '../components/SideMenu';
import { ActiveTripScreen } from '../screens/driver/ActiveTripScreen';
import { useTodayTitle } from '../screens/driver/components';
import { DeliveryStepsScreen } from '../screens/driver/DeliveryStepsScreen';
import { DriverHelpScreen } from '../screens/driver/HelpScreen';
import { DriverHomeScreen } from '../screens/driver/HomeScreen';
import { RefillRunScreen } from '../screens/driver/RefillRunScreen';
import { RefillsScreen } from '../screens/driver/RefillsScreen';
import { UnloadScreen } from '../screens/driver/UnloadScreen';
import { VehicleInfoScreen } from '../screens/driver/VehicleInfoScreen';
import { HeaderCallOfficeButton, makeScreenOptions, useReduceMotion } from '../ui';

/**
 * The driver app's routes (UX_MOBILE §3.6 typed routes; driver spec §1.9). Today → Trip → a step:
 * each step holds its own camera, so there is no scan screen; `Unload` is the Inc 1 unload scan
 * (SCAN_IN). Refills is a list, and each refill opens on its own screen. Profile is merged into Help.
 * Fuel refill, Notifications, Transfers and Reconcile are not in the pilot (UX_MOBILE Appendix A).
 */
export type DriverStackParams = {
  Home: undefined;
  ActiveTrip: { tripId: string };
  /** The store's Load step or a customer's Deliver step. */
  DeliverySteps: { tripId: string; stopId: string };
  /** The trip's last step: unload at the store. */
  Unload: { tripId: string };
  Refills: undefined;
  RefillRun: { refillId: string };
  VehicleInfo: undefined;
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
          component={DriverHomeScreen}
          options={{
            title: today,
            headerRight: () => <HomeHeaderActions onMenu={() => setMenuOpen(true)} />,
          }}
        />
        <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} options={{ title: t('driver.nav.trip') }} />
        {/* The step screens set "Step 2 of 3" themselves, from the trip. */}
        <Stack.Screen name="DeliverySteps" component={DeliveryStepsScreen} options={{ title: '' }} />
        <Stack.Screen name="Unload" component={UnloadScreen} options={{ title: '' }} />
        <Stack.Screen name="Refills" component={RefillsScreen} options={{ title: t('driver.menu.refills') }} />
        <Stack.Screen name="RefillRun" component={RefillRunScreen} options={{ title: t('driver.nav.refill') }} />
        <Stack.Screen name="VehicleInfo" component={VehicleInfoScreen} options={{ title: t('common.menu.van') }} />
        <Stack.Screen name="Help" component={DriverHelpScreen} options={{ title: t('common.menu.help') }} />
      </Stack.Navigator>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} variant="driver" />
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center' },
});
