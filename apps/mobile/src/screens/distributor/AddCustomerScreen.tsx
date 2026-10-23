import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientCreateResult, ClientDto, DistributorDto } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { useIdempotencyKey } from '../../api/client';
import { fieldErrorsOf, toUserMessage, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import {
  ActionLine,
  AddMore,
  Button,
  ChoiceChips,
  Field,
  PhoneField,
  Screen,
  space,
  StepHeader,
  Text,
  useToast,
} from '../../ui';
import { createClient, fetchDistributorMe, type NewClientBody } from './shared/api';
import { useCostPanelState, type Pin } from './shared/CostPanel';
import { shopKeys } from './shared/keys';
import { LocationPicker } from './shared/LocationPicker';
import { returnToOrder, useFormGuard, useShopNavigation, useShopRoute, useStepBack } from './shared/navigation';
import { useClients } from './shared/queries';

const NAME_MAX = 80;
const HOUSE_MAX = 60;
const AREA_MAX = 80;
const NOTES_MAX = 200;
/** Area suggestions: the shop's most used areas (shop spec §L). */
const AREA_CHIPS = 4;

/** A customer that already has the number typed (409 `CLIENT_PHONE_EXISTS` `{clientId, name}`). */
interface ExistingCustomer {
  clientId: string;
  name: string;
}

function existingFrom(error: ApiError): ExistingCustomer | null {
  const { clientId, name } = error.details as { clientId?: unknown; name?: unknown };
  return typeof clientId === 'string' && typeof name === 'string' ? { clientId, name } : null;
}

/** The body fields shown on step 1: a server error on any of them goes back there. */
const STEP1_PATHS: readonly string[] = ['name', 'phone', 'address.label', 'area', 'notes'];

/** The shop's most used areas, most used first, written as the shop first wrote them. */
function topAreas(clients: readonly ClientDto[] | undefined): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const client of clients ?? []) {
    const area = client.area?.trim();
    if (!area) continue;
    const key = area.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label: area, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, AREA_CHIPS)
    .map((entry) => entry.label);
}

/**
 * S8 Add customer (shop spec §L, §M), two steps: the customer (name, mobile, house and street, and
 * Area and Notes behind "+ Add more"), then the delivery spot with its cost line. Saved with one
 * atomic `POST /clients` and this intent's Idempotency-Key. A number already used gives "{{name}}
 * already has this number." with "Use {{name}}". The header arrow goes back a step. Opened from New
 * order, a saved customer goes back there on "Cylinders to deliver".
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
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState<Pin | null>(null);
  const [existing, setExisting] = useState<ExistingCustomer | null>(null);

  const clients = useClients();
  const areas = useMemo(() => topAreas(clients.data), [clients.data]);
  const store = useQuery<DistributorDto, ApiError>({ queryKey: shopKeys.distributorMe, queryFn: fetchDistributorMe });
  const center = store.data?.store ? { lat: store.data.store.lat, lng: store.data.store.lng } : null;
  const cost = useCostPanelState(pin);

  const e164 = normalizePkPhone(phone);
  const trimmedName = name.trim();
  const trimmedLabel = label.trim();
  const idem = useIdempotencyKey([trimmedName, e164, trimmedLabel, pin?.lat, pin?.lng]);
  const dirty = !!(trimmedName || phone.trim() || trimmedLabel || area.trim() || notes.trim() || pin);
  // On step 2 the header arrow goes back to step 1; only leaving from step 1 asks.
  const guard = useFormGuard(dirty && step === 1);
  const stepBack = useStepBack(step, () => setStep(1));

  const save = useMutation<ClientCreateResult, ApiError, NewClientBody>({
    mutationFn: (body) => createClient(body, idem.key),
    onSuccess: async (result) => {
      toast.show({ message: t('customers.add.saved'), tone: 'success' });
      guard.release();
      stepBack.release();
      await queryClient.invalidateQueries({ queryKey: qk.clients });
      if (forOrder) returnToOrder(navigation, { clientId: result.client.id, addressId: result.address?.id });
      else navigation.goBack();
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
      } else if (error.code === 'VALIDATION_FAILED' && Object.keys(fieldErrorsOf(error, t)).some((p) => STEP1_PATHS.includes(p))) {
        setStep(1);
      } else if (error.code === 'PRICING_ZONE_NOT_COVERED' || error.code === 'PRICING_PRICE_NOT_SET') {
        // The price changed since the line under the map was shown: ask again for this pin.
        void queryClient.invalidateQueries({ queryKey: qk.pricing.all });
      }
    },
  });

  const serverFields = save.error ? fieldErrorsOf(save.error, t) : {};
  const lineError =
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
    setLabelTouched(true);
    if (!nameOk || !e164 || !trimmedLabel) return;
    setExisting(null);
    setStep(2);
  };

  // "Use Sana": New order on "Cylinders to deliver" for the customer who has this number.
  const pickExisting = () => {
    if (!existing) return;
    guard.release();
    returnToOrder(navigation, { clientId: existing.clientId });
  };

  const priced = cost.kind === 'priced';
  const canSave = priced && trimmedLabel.length > 0 && !!pin && !!e164 && trimmedName.length > 0 && !save.isPending;

  // "Save customer" is enabled once the pin is priced (UX_MOBILE S8): the line under the map always
  // says why it isn't. House and street was checked on step 1; a server refusal sends it back there.
  const submit = () => {
    setLabelTouched(true);
    if (!trimmedLabel) {
      setStep(1);
      return;
    }
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
    const chosenArea = areas.find((suggestion) => suggestion.toLowerCase() === area.trim().toLowerCase()) ?? '';
    return (
      <Screen key="step-1" footer={<Button label={t('customers.add.next')} onPress={goToStep2} size="lg" />}>
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
              if (phoneError) setPhoneError(null);
            }}
            onBlur={checkPhone}
            error={phoneError ?? serverFields.phone}
            returnKeyType="next"
          />
          {existing ? (
            // The field above says "{{name}} already has this number."; this is what to do about it.
            <Button
              label={t('customers.add.useExisting', { name: existing.name })}
              onPress={pickExisting}
              icon="customer"
              variant="secondary"
            />
          ) : null}
          <Field
            label={t('customers.location.house')}
            value={label}
            onChangeText={setLabel}
            error={
              (labelTouched && !trimmedLabel ? t('customers.location.houseRequired') : null) ?? serverFields['address.label']
            }
            autoCapitalize="words"
            maxLength={HOUSE_MAX}
          />
          <AddMore open={!!(area.trim() || notes.trim() || serverFields.area || serverFields.notes)}>
            <View style={styles.group}>
              <Text variant="label">{t('customers.add.area')}</Text>
              {areas.length > 0 ? (
                <ChoiceChips<string>
                  accessibilityLabel={t('customers.add.area')}
                  options={areas.map((value) => ({ value, label: value }))}
                  value={chosenArea}
                  onChange={setArea}
                />
              ) : null}
              <Field
                accessibilityLabel={t('customers.add.area')}
                value={area}
                onChangeText={setArea}
                autoCapitalize="words"
                maxLength={AREA_MAX}
                error={serverFields.area}
              />
            </View>
            <Field
              label={t('customers.add.notes')}
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={NOTES_MAX}
              error={serverFields.notes}
            />
          </AddMore>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      key="step-2"
      footer={
        <>
          <ActionLine error={lineError} />
          <Button
            label={t('customers.add.save')}
            onPress={submit}
            size="lg"
            loading={save.isPending}
            loadingLabel={t('customers.add.saving')}
            disabled={!priced}
          />
        </>
      }
    >
      <StepHeader step={2} total={2} title={t('customers.add.step2')} />
      <LocationPicker pin={pin} onPinChange={setPin} center={center} costState={cost} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  group: { gap: space.sm },
});
