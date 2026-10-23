import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientAddressCreateResult, ClientAddressDto, ClientDto, DistributorDto } from '@smartfleet/shared-types';
import { useIdempotencyKey } from '../../api/client';
import { fieldErrorsOf, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorBanner,
  Icon,
  layout,
  Screen,
  SkeletonList,
  sizes,
  space,
  StatusChip,
  Text,
  useToast,
} from '../../ui';
import { addClientAddress, fetchClients, fetchDistributorMe } from './shared/api';
import { useCostPanelState, type Pin } from './shared/CostPanel';
import { shopKeys } from './shared/keys';
import { LocationPicker } from './shared/LocationPicker';
import { useFormGuard, useShopNavigation, useShopRoute } from './shared/navigation';
import { Notice } from './shared/Notice';
import { StaleNotice } from './shared/StaleNotice';

/**
 * New order → "Change address" (UX_MOBILE S9): pick one of the customer's saved addresses, or add a
 * new pin with the same cost panel as Add customer (`POST /clients/:id/addresses`; addresses are
 * add-only in the pilot). The choice goes back to New order, which quotes again.
 */
export function PickAddressScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'PickAddress'>();

  const clients = useQuery<ClientDto[], ApiError>({ queryKey: qk.clients, queryFn: fetchClients });
  const store = useQuery<DistributorDto, ApiError>({ queryKey: shopKeys.distributorMe, queryFn: fetchDistributorMe });
  const client = clients.data?.find((c) => c.id === params.clientId) ?? null;

  const [adding, setAdding] = useState(false);
  const [blocked, setBlocked] = useState<ClientAddressDto | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const showNew = adding || (client !== null && client.addresses.length === 0);
  const cost = useCostPanelState(showNew ? pin : null);
  const trimmedLabel = label.trim();
  const idem = useIdempotencyKey([params.clientId, trimmedLabel, pin?.lat, pin?.lng]);
  const guard = useFormGuard(showNew && (pin !== null || trimmedLabel !== ''));

  const backToOrder = (addressId: string) => {
    guard.release();
    navigation.navigate('NewOrder', { clientId: params.clientId, addressId, pickedAt: Date.now() });
  };

  const save = useMutation<ClientAddressCreateResult, ApiError, { label: string; lat: number; lng: number }>({
    mutationFn: (body) => addClientAddress(params.clientId, body, idem.key),
    onSuccess: async (created) => {
      toast.show({ message: t('customers.address.savedToast'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: qk.clients });
      backToOrder(created.id);
    },
    onError: (error) => {
      if (error.code === 'PRICING_ZONE_NOT_COVERED' || error.code === 'PRICING_PRICE_NOT_SET') {
        void queryClient.invalidateQueries({ queryKey: qk.pricing.all });
      }
    },
  });

  const serverFields = save.error ? fieldErrorsOf(save.error, t) : {};
  const priced = cost.kind === 'priced';
  const canSave = priced && !!pin && trimmedLabel.length > 0 && !save.isPending;
  // "Save address" is enabled once the pin is priced, as on Add customer (UX_MOBILE S8): House /
  // street is checked on press, so an empty one says "Write the house or street.".
  const submit = () => {
    setLabelTouched(true);
    if (!canSave || !pin) return;
    save.mutate({ label: trimmedLabel, lat: pin.lat, lng: pin.lng });
  };

  if (!client) {
    return (
      <Screen>
        {clients.isError ? (
          <ErrorBanner error={clients.error} onRetry={() => void clients.refetch()} />
        ) : clients.data ? (
          <EmptyState icon="customer" title={t('errors.CLIENT_NOT_FOUND')} />
        ) : (
          <SkeletonList rows={3} />
        )}
      </Screen>
    );
  }

  if (showNew) {
    return (
      <Screen
        footer={
          <Button
            label={t('customers.address.save')}
            onPress={submit}
            size="lg"
            loading={save.isPending}
            loadingLabel={t('customers.address.saving')}
            disabled={!priced}
          />
        }
      >
        <View style={styles.stack}>
          <Text variant="title">{t('customers.address.newTitle')}</Text>
          {client.addresses.length > 0 ? (
            <Button label={t('customers.add.back')} onPress={() => setAdding(false)} variant="ghost" fullWidth={false} />
          ) : null}
          <LocationPicker
            pin={pin}
            onPinChange={setPin}
            label={label}
            onLabelChange={setLabel}
            labelError={(labelTouched && !trimmedLabel ? t('customers.location.houseRequired') : null) ?? serverFields.label}
            center={store.data?.store ? { lat: store.data.store.lat, lng: store.data.store.lng } : null}
            costState={cost}
            purpose="address"
          />
          {save.error && !(save.error.code === 'VALIDATION_FAILED' && serverFields.label) ? (
            <ErrorBanner error={save.error} />
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.stack}>
        {clients.isError ? <StaleNotice updatedAt={clients.dataUpdatedAt} onRetry={() => void clients.refetch()} /> : null}
        <Text variant="heading">{t('customers.address.saved')}</Text>
        <Card padding={0}>
          {client.addresses.map((address, index) => (
            <AddressRow
              key={address.id}
              address={address}
              selected={address.id === params.selectedAddressId}
              first={index === 0}
              onPress={() => {
                if (address.priceStatus === 'SET') backToOrder(address.id);
                else setBlocked(address);
              }}
            />
          ))}
        </Card>
        {blocked ? (
          <Notice
            tone="danger"
            alert
            text={
              blocked.priceStatus === 'NOT_SET'
                ? t('customers.cost.priceNotSetAddress', { zoneName: blocked.zone?.name ?? '' })
                : t('customers.cost.outside')
            }
          />
        ) : null}
        <Button
          label={t('customers.address.addNew')}
          onPress={() => {
            setBlocked(null);
            setAdding(true);
          }}
          icon="map"
          variant="secondary"
        />
      </View>
    </Screen>
  );
}

/** A saved address: its label, and its zone or why it can't be delivered to now. */
function AddressRow({
  address,
  selected,
  first,
  onPress,
}: {
  address: ClientAddressDto;
  selected: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const chip =
    address.priceStatus === 'SET' && address.zone ? (
      <StatusChip tone="neutral" label={t('customers.address.zone', { zone: address.zone.name })} icon="map" />
    ) : address.priceStatus === 'NOT_SET' ? (
      <StatusChip tone="danger" label={t('orders.new.noPrice')} icon="error" />
    ) : (
      <StatusChip tone="danger" label={t('orders.new.outside')} icon="error" />
    );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={address.label}
      android_ripple={{ color: colors.ripple }}
      style={[styles.row, first ? null : styles.rowDivider, selected ? styles.rowSelected : null]}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong">{address.label}</Text>
        <View style={styles.chip}>{chip}</View>
      </View>
      {selected ? <Icon name="ok" size={24} tone="brand" label={t('customers.address.current')} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  row: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowSelected: { backgroundColor: colors.brandSoft },
  chip: { marginTop: space.xs },
});
