import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { OrderListTab, PayerChannel } from '@smartfleet/shared-types';
import { HamburgerButton, SideMenu } from '../components/SideMenu';
import { AddCustomerScreen } from '../screens/distributor/AddCustomerScreen';
import { CasesScreen } from '../screens/distributor/CasesScreen';
import { HelpScreen } from '../screens/distributor/HelpScreen';
import { DistributorHomeScreen } from '../screens/distributor/HomeScreen';
import { NewOrderScreen } from '../screens/distributor/NewOrderScreen';
import { OrderDetailScreen } from '../screens/distributor/OrderDetailScreen';
import { OrdersScreen } from '../screens/distributor/OrdersScreen';
import { PickAddressScreen } from '../screens/distributor/PickAddressScreen';
import { ProfileScreen } from '../screens/distributor/ProfileScreen';
import { RequestFillingScreen } from '../screens/distributor/RequestFillingScreen';
import { WalletScreen, type WalletFilter } from '../screens/distributor/WalletScreen';
import { TopupAmountScreen } from '../screens/distributor/topup/TopupAmountScreen';
import { TopupHowToPayScreen } from '../screens/distributor/topup/TopupHowToPayScreen';
import { TopupStatusScreen } from '../screens/distributor/topup/TopupStatusScreen';
import { TopupTellUsScreen } from '../screens/distributor/topup/TopupTellUsScreen';
import { makeScreenOptions, useReduceMotion } from '../ui';

/** What Add money can start with: an amount to fill in, or the amount an order is short by. */
export interface TopupPrefill {
  /** A paisa digit string, used as it is ("Try again" on a rejected top-up). */
  amountPaisa?: string;
  /** From an order refused for money: the amount becomes max(minimum, shortBy rounded up to Rs 100). */
  shortByPaisa?: string;
  payerName?: string;
  payerChannel?: PayerChannel;
}

/**
 * The shop app's routes (UX_MOBILE S2–S12b). Typed, so every `navigate` names a real screen with the
 * right params (this replaces the `useNavigation<any>()` calls).
 */
export type DistributorStackParams = {
  Home: undefined;
  Wallet: { filter?: WalletFilter } | undefined;
  TopupAmount: TopupPrefill | undefined;
  TopupHowToPay: { amountPaisa: string; payerName?: string; payerChannel?: PayerChannel };
  TopupTellUs: { amountPaisa: string; payerChannel: PayerChannel; payerName?: string };
  TopupStatus: { id: string };
  AddCustomer: { forOrder?: boolean } | undefined;
  /**
   * `clientId` / `addressId` preselect a customer and address (back from Add customer or Change
   * address); `pickedAt` makes a repeat of the same choice count again.
   */
  NewOrder: { clientId?: string; addressId?: string; pickedAt?: number } | undefined;
  PickAddress: { clientId: string; selectedAddressId?: string };
  Orders: { tab?: OrderListTab } | undefined;
  OrderDetail: { orderId: string };
  Profile: undefined;
  Help: undefined;
  RequestFilling: undefined;
  /** [Inc 2] Open customer problems; reached from Home only while `features.confirmations` is on. */
  Cases: undefined;
};

const Stack = createNativeStackNavigator<DistributorStackParams>();

/** The shop app (APP_VARIANT=distributor), mounted by RootNavigator after its gates. */
export function DistributorStack() {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const topupTitle = t('topup.flowTitle');

  return (
    <>
      <Stack.Navigator screenOptions={makeScreenOptions({ reduceMotion })}>
        <Stack.Screen
          name="Home"
          component={DistributorHomeScreen}
          options={{
            title: t('common.appName'),
            headerRight: () => <HamburgerButton onPress={() => setMenuOpen(true)} />,
          }}
        />
        <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: t('wallet.history.title') }} />
        <Stack.Screen name="TopupAmount" component={TopupAmountScreen} options={{ title: topupTitle }} />
        <Stack.Screen name="TopupHowToPay" component={TopupHowToPayScreen} options={{ title: topupTitle }} />
        <Stack.Screen name="TopupTellUs" component={TopupTellUsScreen} options={{ title: topupTitle }} />
        <Stack.Screen
          name="TopupStatus"
          component={TopupStatusScreen}
          options={{ title: t('topup.status.titleLoading') }}
        />
        <Stack.Screen name="AddCustomer" component={AddCustomerScreen} options={{ title: t('customers.add.title') }} />
        <Stack.Screen name="NewOrder" component={NewOrderScreen} options={{ title: t('orders.new.title') }} />
        <Stack.Screen
          name="PickAddress"
          component={PickAddressScreen}
          options={{ title: t('customers.address.title') }}
        />
        <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: t('orders.list.title') }} />
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ title: t('orders.detail.titleLoading') }}
        />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t('home.profile.title') }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: t('home.help.title') }} />
        <Stack.Screen name="RequestFilling" component={RequestFillingScreen} options={{ title: t('refill.title') }} />
        <Stack.Screen name="Cases" component={CasesScreen} options={{ title: t('home.cases.title') }} />
      </Stack.Navigator>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} variant="distributor" />
    </>
  );
}
