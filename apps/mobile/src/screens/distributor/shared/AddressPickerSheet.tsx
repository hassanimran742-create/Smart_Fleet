import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { ClientAddressDto, ClientDto } from '@smartfleet/shared-types';
import { useOfficeContact } from '../../../hooks/useAppConfig';
import { Button, Icon, PickerSheet, space, StatusChip, Text, type PickerItem } from '../../../ui';
import { addressBlock } from './format';

/** The "+ New address" row's value: every other row's value is an address. */
const NEW_ADDRESS = 'new' as const;
type Choice = ClientAddressDto | typeof NEW_ADDRESS;

export interface AddressPickerSheetProps {
  visible: boolean;
  client: ClientDto | null;
  /** The address chosen now: it gets the tick. */
  currentAddressId?: string | null;
  /** An address that can take an order was tapped; the sheet closes. */
  onPick: (address: ClientAddressDto) => void;
  /** "+ New address": the sheet closes and the host opens New address. */
  onNewAddress: () => void;
  onClose: () => void;
}

/**
 * "Deliver to" (shop spec §Q): the customer's saved addresses in a PickerSheet, the current one
 * ticked. A tap picks and closes; an address that can't take an order opens in place with why (and
 * "Call office" when a price is missing), and the sheet stays open. The last row is "+ New address".
 * It reads the customer the host already has (`qk.clients`) and never loads on its own.
 */
export function AddressPickerSheet({ visible, client, currentAddressId, onPick, onNewAddress, onClose }: AddressPickerSheetProps) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  // Each opening starts with every row closed.
  useEffect(() => {
    if (!visible) setOpenId(null);
  }, [visible]);

  const addresses = client?.addresses ?? [];
  const items: PickerItem<Choice>[] = addresses.map((address) => {
    const block = addressBlock(address);
    const blocked = block !== 'none';
    const chip = block === 'noPrice' ? t('orders.new.noPrice') : block === 'outside' ? t('orders.new.outside') : null;
    return {
      key: address.id,
      value: address,
      title: address.label,
      selected: address.id === currentAddressId,
      below: chip ? <StatusChip tone="danger" icon="error" label={chip} /> : undefined,
      keepOpen: blocked,
      expanded: blocked && openId === address.id ? <BlockedLine block={block} /> : undefined,
      accessibilityLabel: [address.label, chip, address.id === currentAddressId ? t('customers.address.current') : null]
        .filter(Boolean)
        .join(', '),
    };
  });
  items.push({
    key: NEW_ADDRESS,
    value: NEW_ADDRESS,
    title: t('customers.address.addNew'),
    leadingIcon: 'plus',
    tone: 'action',
    dividerBefore: addresses.length > 0,
  });

  return (
    <PickerSheet<Choice>
      visible={visible}
      title={t('customers.address.title')}
      items={items}
      search={false}
      onClose={onClose}
      onPick={(value) => {
        if (value === NEW_ADDRESS) {
          onNewAddress();
          return;
        }
        if (addressBlock(value) !== 'none') {
          setOpenId((current) => (current === value.id ? null : value.id));
          return;
        }
        onPick(value);
      }}
    />
  );
}

function BlockedLine({ block }: { block: ReturnType<typeof addressBlock> }) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const noPrice = block === 'noPrice';
  return (
    <View style={styles.block}>
      <View style={styles.line} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icon name="error" size={20} tone="danger" />
        <Text style={styles.flex}>{noPrice ? t('customers.block.noPrice') : t('customers.block.outside')}</Text>
      </View>
      {noPrice && office.phone ? (
        <Button label={t('common.actions.callOffice')} onPress={office.call} icon="call" variant="secondary" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
