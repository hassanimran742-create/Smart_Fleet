import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { OrderListTab, PayerChannel } from '@smartfleet/shared-types';
import { HamburgerButton, SideMenu } from '../components/SideMenu';
import { AddCustomerScreen } from '../screens/distributor/AddCustomerScreen';
import { CasesScreen } from '../screens/distributor/CasesScreen';
import { CustomersScreen } from '../screens/distributor/CustomersScreen';
import { HelpScreen } from '../screens/distributor/HelpScreen';
import { DistributorHomeScreen } from '../screens/distributor/HomeScreen';
import { NewAddressScreen } from '../screens/distributor/NewAddressScreen';
import { NewOrderScreen } from '../screens/distributor/NewOrderScreen';
import { NewRefillScreen } from '../screens/distributor/NewRefillScreen';
import { OrderDetailScreen } from '../screens/distributor/OrderDetailScreen';
import { OrdersScreen } from '../screens/distributor/OrdersScreen';
import { ProfileScreen } from '../screens/distributor/ProfileScreen';
import { RefillListScreen } from '../screens/distributor/RefillListScreen';
import { WalletScreen, type WalletFilter } from '../screens/distributor/WalletScreen';
import { TopupAmountScreen } from '../screens/distributor/topup/TopupAmountScreen';
import { TopupHowToPayScreen } from '../screens/distributor/topup/TopupHowToPayScreen';
import { TopupStatusScreen } from '../screens/distributor/topup/TopupStatusScreen';
import { TopupTellUsScreen } from '../screens/distributor/topup/TopupTellUsScreen';
import { makeScreenOptions, useReduceMotion } from '../ui';

/** How the shop paid, as Add money offers it: Easypaisa or a bank app ("Other" is gone, DECIDED). */
export type PayChannel = Exclude<PayerChannel, 'OTHER'>;

/** What Add money can start with: an amount to fill in, or the amount an order is short by. */
export interface TopupPrefill {
  /** A paisa digit string, used as it is ("Tell us again" on a top-up that wasn't added). */
  amountPaisa?: string;
  /** From an order refused for money: the amount becomes max(minimum, shortBy rounded up to Rs 100). */
  shortByPaisa?: string;
  payerName?: string;
  payerChannel?: PayChannel;
}

/**
 * The shop app's routes (UX_MOBILE S2–S12b; shop spec §4). Typed, so every `navigate` names a real
 * screen with the right params. Home is first: it is the initial route.
 */
export type DistributorStackParams = {
  Home: undefined;
  /** History (S7). Home's "Being checked" opens it on "Top-ups" when several are being checked. */
  Wallet: { filter?: WalletFilter } | undefined;
  TopupAmount: TopupPrefill | undefined;
  TopupHowToPay: { amountPaisa: string; payerName?: string; payerChannel?: PayChannel };
  TopupTellUs: { amountPaisa: string; payerChannel: PayChannel; payerName?: string };
  TopupStatus: { id: string };
  /** S8b Customers: a tap starts New order for that customer. */
  Customers: undefined;
  /** `forOrder`: opened from New order, so a saved customer goes back there on step 2. */
  AddCustomer: { forOrder?: boolean } | undefined;
  /**
   * `clientId` / `addressId` choose a customer and address (from Customers, Add customer, "Use Sana",
   * New address or the address sheet); `pickedAt` makes a repeat of the same choice count again, and
   * opens New order on step 2.
   */
  NewOrder: { clientId?: string; addressId?: string; pickedAt?: number } | undefined;
  /** A new delivery address for a customer (§R); saving it opens New order with it chosen. */
  NewAddress: { clientId: string };
  Orders: { tab?: OrderListTab } | undefined;
  OrderDetail: { orderId: string };
  Profile: undefined;
  Help: undefined;
  /** S16 Refills (in Inc 1 as the shop spec's X1). */
  Refills: undefined;
  /** S17 New refill (the shop spec's X2). */
  NewRefill: undefined;
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
            // Home sets "Salam, {{name}}" once it has loaded (shop spec §D).
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
        <Stack.Screen name="Customers" component={CustomersScreen} options={{ title: t('customers.list.title') }} />
        <Stack.Screen name="AddCustomer" component={AddCustomerScreen} options={{ title: t('customers.add.title') }} />
        <Stack.Screen name="NewOrder" component={NewOrderScreen} options={{ title: t('orders.new.title') }} />
        <Stack.Screen
          name="NewAddress"
          component={NewAddressScreen}
          options={{ title: t('customers.address.newTitle') }}
        />
        <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: t('orders.list.title') }} />
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ title: t('orders.detail.titleLoading') }}
        />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t('home.profile.title') }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: t('home.help.title') }} />
        <Stack.Screen name="Refills" component={RefillListScreen} options={{ title: t('refill.list.title') }} />
        <Stack.Screen name="NewRefill" component={NewRefillScreen} options={{ title: t('refill.request.title') }} />
        <Stack.Screen name="Cases" component={CasesScreen} options={{ title: t('home.cases.title') }} />
      </Stack.Navigator>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} variant="distributor" />
    </>
  );
}
