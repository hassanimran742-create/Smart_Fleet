import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HamburgerButton, SideMenu } from '../components/SideMenu';
import { ActiveTripScreen } from '../screens/driver/ActiveTripScreen';
import { DeliveryStepsScreen } from '../screens/driver/DeliveryStepsScreen';
import { DriverFillingOrdersScreen } from '../screens/driver/FillingOrdersScreen';
import { DriverHelpScreen } from '../screens/driver/HelpScreen';
import { DriverHomeScreen } from '../screens/driver/HomeScreen';
import { DriverProfileScreen } from '../screens/driver/ProfileScreen';
import { ScanScreen } from '../screens/driver/ScanScreen';
import type { LegacyScanEvent } from '../screens/driver/tripApi';
import { VehicleInfoScreen } from '../screens/driver/VehicleInfoScreen';
import { HeaderCallOfficeButton, makeScreenOptions, useReduceMotion } from '../ui';

/**
 * The driver app's routes (UX_MOBILE §3.6 typed routes). Fuel refill, Notifications, Transfers and
 * Reconcile are not in the pilot (UX_MOBILE Appendix A), and every scan opens from a trip step.
 */
export type DriverStackParams = {
  Home: undefined;
  ActiveTrip: { tripId: string };
  DeliverySteps: { tripId: string; stopId: string };
  /** One fixed step: the event, the trip and, for a customer's step, the order. */
  Scan: { eventType: LegacyScanEvent; tripId: string; orderId?: string };
  FillingRuns: undefined;
  Profile: undefined;
  VehicleInfo: undefined;
  Help: undefined;
};

const Stack = createNativeStackNavigator<DriverStackParams>();

/** Home's header: "Call office" (shown on every driver screen once the office's phone is set) and the menu. */
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
            title: t('driver.nav.home'),
            headerRight: () => <HomeHeaderActions onMenu={() => setMenuOpen(true)} />,
          }}
        />
        <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} options={{ title: t('driver.nav.trip') }} />
        <Stack.Screen name="DeliverySteps" component={DeliveryStepsScreen} options={{ title: t('driver.nav.stop') }} />
        <Stack.Screen name="Scan" component={ScanScreen} options={{ title: t('driver.nav.scan') }} />
        <Stack.Screen
          name="FillingRuns"
          component={DriverFillingOrdersScreen}
          options={{ title: t('common.menu.refillRuns') }}
        />
        <Stack.Screen name="Profile" component={DriverProfileScreen} options={{ title: t('common.menu.profile') }} />
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
