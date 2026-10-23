import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientCreateResult, DistributorDto } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { useIdempotencyKey } from '../../api/client';
import { fieldErrorsOf, toUserMessage, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { Button, ErrorBanner, Field, PhoneField, Screen, space, StepHeader, useToast } from '../../ui';
import { createClient, fetchDistributorMe, type NewClientBody } from './shared/api';
import { useCostPanelState, type Pin } from './shared/CostPanel';
import { shopKeys } from './shared/keys';
import { LocationPicker } from './shared/LocationPicker';
import { useFormGuard, useShopNavigation, useShopRoute } from './shared/navigation';

const NAME_MAX = 80;
const AREA_MAX = 80;
const NOTES_MAX = 200;

/** A customer that already has the number typed (409 `CLIENT_PHONE_EXISTS` `{clientId, name}`). */
interface ExistingCustomer {
  clientId: string;
  name: string;
}

function existingFrom(error: ApiError): ExistingCustomer | null {
  const { clientId, name } = error.details as { clientId?: unknown; name?: unknown };
  return typeof clientId === 'string' && typeof name === 'string' ? { clientId, name } : null;
}

/**
 * S8 Add customer (replaces AddClientScreen), two steps: the customer's details, then the delivery
 * spot with the live cost panel. Saved with one atomic `POST /clients` and this intent's
 * Idempotency-Key. A number already used gives "{{name}} already has this number." with "Use {{name}}".
 * Opened from New order, it goes back there with the customer chosen.
 */
export function AddCustomerScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'AddCustomer'>();
  const forOrder = params?.forOrder ?? false;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState<Pin | null>(null);
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [existing, setExisting] = useState<ExistingCustomer | null>(null);

  const store = useQuery<DistributorDto, ApiError>({ queryKey: shopKeys.distributorMe, queryFn: fetchDistributorMe });
  const center = store.data?.store ? { lat: store.data.store.lat, lng: store.data.store.lng } : null;
  const cost = useCostPanelState(pin);

  const e164 = normalizePkPhone(phone);
  const trimmedName = name.trim();
  const trimmedLabel = label.trim();
  const idem = useIdempotencyKey([trimmedName, e164, trimmedLabel, pin?.lat, pin?.lng]);
  const guard = useFormGuard(!!(trimmedName || phone.trim() || area.trim() || notes.trim() || pin || trimmedLabel));

  const save = useMutation<ClientCreateResult, ApiError, NewClientBody>({
    mutationFn: (body) => createClient(body, idem.key),
    onSuccess: async (result) => {
      toast.show({ message: t('customers.add.saved'), tone: 'success' });
      guard.release();
      await queryClient.invalidateQueries({ queryKey: qk.clients });
      if (forOrder) {
        navigation.navigate('NewOrder', {
          clientId: result.client.id,
          addressId: result.address?.id,
          pickedAt: Date.now(),
        });
      } else {
        navigation.goBack();
      }
    },
    onError: (error) => {
      if (error.code === 'CLIENT_PHONE_EXISTS') {
        const found = existingFrom(error);
        setExisting(found);
        setPhoneError(found ? t('customers.add.phoneExists', { name: found.name }) : toUserMessage(error, t));
        setStep(1);
      } else if (error.code === 'CLIENT_PHONE_INVALID') {
        setPhoneError(toUserMessage(error, t));
        setStep(1);
      } else if (error.code === 'PRICING_ZONE_NOT_COVERED' || error.code === 'PRICING_PRICE_NOT_SET') {
        // The price changed since the panel was shown: ask again for this pin.
        void queryClient.invalidateQueries({ queryKey: qk.pricing.all });
      }
    },
  });

  const serverFields = save.error ? fieldErrorsOf(save.error, t) : {};
  const bannerError =
    save.error &&
    !['CLIENT_PHONE_EXISTS', 'CLIENT_PHONE_INVALID'].includes(save.error.code) &&
    !(save.error.code === 'VALIDATION_FAILED' && Object.keys(serverFields).length > 0)
      ? save.error
      : null;

  const checkPhone = (value: string | null) => {
    if (value) setPhoneError(null);
    else if (phone.trim()) setPhoneError(t('errors.CLIENT_PHONE_INVALID'));
  };

  const goToStep2 = () => {
    const nameOk = trimmedName.length > 0;
    setNameError(nameOk ? null : t('customers.add.nameRequired'));
    if (!e164) setPhoneError(t('errors.CLIENT_PHONE_INVALID'));
    if (!nameOk || !e164) return;
    setExisting(null);
    setStep(2);
  };

  const pickExisting = () => {
    if (!existing) return;
    guard.release();
    if (forOrder) navigation.navigate('NewOrder', { clientId: existing.clientId, pickedAt: Date.now() });
    else navigation.goBack();
  };

  const priced = cost.kind === 'priced';
  const canSave = priced && trimmedLabel.length > 0 && !!pin && !!e164 && trimmedName.length > 0 && !save.isPending;

  // "Save customer" is enabled once the pin is priced (UX_MOBILE S8). House / street is checked on
  // press, so an empty one says "Write the house or street." instead of leaving a grey button.
  const submit = () => {
    setLabelTouched(true);
    if (!canSave || !pin || !e164) return;
    save.mutate({
      name: trimmedName,
      phone: e164,
      address: { label: trimmedLabel, lat: pin.lat, lng: pin.lng },
      ...(area.trim() ? { area: area.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  if (step === 1) {
    return (
      <Screen footer={<Button label={t('customers.add.next')} onPress={goToStep2} size="lg" />}>
        <StepHeader step={1} total={2} title={t('customers.add.step1')} />
        <View style={styles.stack}>
          <Field
            label={t('customers.add.name')}
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (nameError && value.trim()) setNameError(null);
            }}
            error={nameError ?? serverFields.name}
            autoCapitalize="words"
            autoComplete="name"
            maxLength={NAME_MAX}
            returnKeyType="next"
          />
          <PhoneField
            label={t('customers.add.mobile')}
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              if (existing) setExisting(null);
            }}
            onBlur={checkPhone}
            placeholder={t('auth.signIn.phonePlaceholder')}
            error={phoneError ?? serverFields.phone}
            returnKeyType="next"
          />
          {existing ? (
            // The field above already says "{{name}} already has this number."; this is what to do about it.
            <Button
              label={t('customers.add.useExisting', { name: existing.name })}
              onPress={pickExisting}
              icon="customer"
              variant="secondary"
            />
          ) : null}
          <Field
            label={t('customers.add.area')}
            optional
            value={area}
            onChangeText={setArea}
            placeholder={t('customers.add.areaPlaceholder')}
            autoCapitalize="words"
            maxLength={AREA_MAX}
            error={serverFields.area}
          />
          <Field
            label={t('customers.add.notes')}
            optional
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={NOTES_MAX}
            error={serverFields.notes}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={t('customers.add.save')}
          onPress={submit}
          size="lg"
          loading={save.isPending}
          loadingLabel={t('customers.add.saving')}
          disabled={!priced}
        />
      }
    >
      <StepHeader step={2} total={2} title={t('customers.add.step2')} />
      <View style={styles.stack}>
        <Button
          label={t('customers.add.back')}
          onPress={() => setStep(1)}
          variant="ghost"
          fullWidth={false}
          disabled={save.isPending}
        />
        <LocationPicker
          pin={pin}
          onPinChange={setPin}
          label={label}
          onLabelChange={setLabel}
          labelError={
            (labelTouched && !trimmedLabel ? t('customers.location.houseRequired') : null) ?? serverFields['address.label']
          }
          center={center}
          costState={cost}
          purpose="customer"
        />
        {bannerError ? <ErrorBanner error={bannerError} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
});
