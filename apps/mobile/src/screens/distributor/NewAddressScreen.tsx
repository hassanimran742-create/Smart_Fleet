import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientAddressCreateResult, DistributorDto } from '@smartfleet/shared-types';
import { useIdempotencyKey } from '../../api/client';
import { fieldErrorsOf, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { ActionLine, Button, Field, Screen, space, useToast } from '../../ui';
import { addClientAddress, fetchDistributorMe } from './shared/api';
import { useCostPanelState, type Pin } from './shared/CostPanel';
import { shopKeys } from './shared/keys';
import { LocationPicker } from './shared/LocationPicker';
import { returnToOrder, useFormGuard, useShopNavigation, useShopRoute } from './shared/navigation';

const HOUSE_MAX = 60;

/**
 * New address (shop spec §R; split out of the old PickAddress screen so the header arrow is the only
 * Back): House and street, then the map with its cost line, and "Save address" once the pin is
 * priced. `POST /clients/:id/addresses` (add-only in the pilot) with this intent's Idempotency-Key.
 * Saved, it opens New order on "Cylinders to deliver" with the new address chosen.
 */
export function NewAddressScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'NewAddress'>();

  const store = useQuery<DistributorDto, ApiError>({ queryKey: shopKeys.distributorMe, queryFn: fetchDistributorMe });
  const [pin, setPin] = useState<Pin | null>(null);
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const cost = useCostPanelState(pin);
  const trimmedLabel = label.trim();
  const idem = useIdempotencyKey([params.clientId, trimmedLabel, pin?.lat, pin?.lng]);
  const guard = useFormGuard(pin !== null || trimmedLabel !== '');

  const save = useMutation<ClientAddressCreateResult, ApiError, { label: string; lat: number; lng: number }>({
    mutationFn: (body) => addClientAddress(params.clientId, body, idem.key),
    onSuccess: async (created) => {
      toast.show({ message: t('customers.address.savedToast'), tone: 'success' });
      guard.release();
      await queryClient.invalidateQueries({ queryKey: qk.clients });
      returnToOrder(navigation, { clientId: params.clientId, addressId: created.id });
    },
    onError: (error) => {
      if (error.code === 'PRICING_ZONE_NOT_COVERED' || error.code === 'PRICING_PRICE_NOT_SET') {
        void queryClient.invalidateQueries({ queryKey: qk.pricing.all });
      }
    },
  });

  const serverFields = save.error ? fieldErrorsOf(save.error, t) : {};
  const lineError = save.error && !(save.error.code === 'VALIDATION_FAILED' && serverFields.label) ? save.error : null;
  const priced = cost.kind === 'priced';
  const canSave = priced && !!pin && trimmedLabel.length > 0 && !save.isPending;

  // "Save address" is enabled once the pin is priced, as on Add customer (UX_MOBILE S8): House and
  // street is checked on press, so an empty one says "Write the house or street.".
  const submit = () => {
    setLabelTouched(true);
    if (!canSave || !pin) return;
    save.mutate({ label: trimmedLabel, lat: pin.lat, lng: pin.lng });
  };

  return (
    <Screen
      footer={
        <>
          <ActionLine error={lineError} />
          <Button
            label={t('customers.address.save')}
            onPress={submit}
            size="lg"
            loading={save.isPending}
            loadingLabel={t('customers.address.saving')}
            disabled={!priced}
          />
        </>
      }
    >
      <View style={styles.stack}>
        <Field
          label={t('customers.location.house')}
          value={label}
          onChangeText={setLabel}
          error={(labelTouched && !trimmedLabel ? t('customers.location.houseRequired') : null) ?? serverFields.label}
          autoCapitalize="words"
          maxLength={HOUSE_MAX}
        />
        <LocationPicker
          pin={pin}
          onPinChange={setPin}
          center={store.data?.store ? { lat: store.data.store.lat, lng: store.data.store.lng } : null}
          costState={cost}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
});
