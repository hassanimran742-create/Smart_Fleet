import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientDto } from '@smartfleet/shared-types';
import { Fab, Screen } from '../../ui';
import { AddressPickerSheet } from './shared/AddressPickerSheet';
import { CustomerList } from './shared/CustomerList';
import { useShopNavigation } from './shared/navigation';

/** Lets the sheet slide away before the next screen opens. */
const SHEET_CLOSE_MS = 200;

/**
 * S8b Customers (shop spec §K, new): the shop's customers with search, "Recent" first, a call button
 * on each row and "+ Add customer". A tap starts New order on "Cylinders to deliver" for that customer
 * (DECIDED). A customer whose address can't take an order opens in place with its fix: "Change
 * address" (the address sheet, hosted here) or "Add address" (New address).
 */
export function CustomersScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const [sheetFor, setSheetFor] = useState<ClientDto | null>(null);

  return (
    <Screen
      scroll={false}
      padded={false}
      fab={<Fab label={t('customers.list.add')} onPress={() => navigation.navigate('AddCustomer')} />}
    >
      <CustomerList
        variant="customers"
        onPick={(client, address) =>
          navigation.navigate('NewOrder', { clientId: client.id, addressId: address.id, pickedAt: Date.now() })
        }
        onChangeAddress={setSheetFor}
        onAddAddress={(client) => navigation.navigate('NewAddress', { clientId: client.id })}
      />
      <AddressPickerSheet
        visible={sheetFor !== null}
        client={sheetFor}
        onClose={() => setSheetFor(null)}
        onPick={(address) => {
          const client = sheetFor;
          if (!client) return;
          navigation.navigate('NewOrder', { clientId: client.id, addressId: address.id, pickedAt: Date.now() });
        }}
        onNewAddress={() => {
          const client = sheetFor;
          if (!client) return;
          setTimeout(() => navigation.navigate('NewAddress', { clientId: client.id }), SHEET_CLOSE_MS);
        }}
      />
    </Screen>
  );
}
