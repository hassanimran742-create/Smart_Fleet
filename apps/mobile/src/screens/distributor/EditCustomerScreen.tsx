import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ClientUpdateResult } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { fieldErrorsOf, toUserMessage, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import {
  ActionLine,
  AddMore,
  Button,
  EmptyState,
  Field,
  FirstLoadState,
  Icon,
  PhoneField,
  phoneFieldText,
  Screen,
  SkeletonCard,
  space,
  Text,
  useToast,
} from '../../ui';
import { useNewLinkStore } from './confirm/newLinkStore';
import { updateClient, type ClientUpdateBody } from './shared/api';
import { defaultAddress } from './shared/format';
import { useFormGuard, useShopNavigation, useShopRoute } from './shared/navigation';
import { useClients } from './shared/queries';

const NAME_MAX = 80;
const NOTES_MAX = 200;

/**
 * [Inc 2] S15b Edit customer (UX_MOBILE §7.3; Inc 2/3 spec §2.8): Add customer step 1 in edit mode, to
 * correct a number (or the name or note). Name, the +92 mobile field, the note (or "+ Add note"), and
 * the address read-only with "New address? Use New order." (addresses are add-only). "Save customer"
 * sends only what changed (`PATCH /clients/:id`), shows "Customer saved" and goes back. Opened from the
 * customer answer card's "Fix number": when the server answers `confirmationNeedsNewLink`, the order
 * asks "Make a new link?" as soon as it shows again. "Leave without saving?" after a change.
 */
export function EditCustomerScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'EditCustomer'>();
  const clients = useClients();
  const client = clients.data?.find((row) => row.id === params.clientId) ?? null;

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);

  // The form starts from the customer as saved, once.
  useEffect(() => {
    if (!client || loaded) return;
    setName(client.name);
    setPhone(phoneFieldText(client.phone));
    setNotes(client.notes ?? '');
    setLoaded(true);
  }, [client, loaded]);

  const trimmedName = name.trim();
  const trimmedNotes = notes.trim();
  const e164 = normalizePkPhone(phone);
  const changes = useMemo<ClientUpdateBody>(() => {
    if (!client) return {};
    const body: ClientUpdateBody = {};
    if (trimmedName !== client.name) body.name = trimmedName;
    if (phoneFieldText(phone) !== phoneFieldText(client.phone)) body.phone = e164 ?? phone;
    if (trimmedNotes !== (client.notes ?? '').trim()) body.notes = trimmedNotes;
    return body;
  }, [client, trimmedName, phone, e164, trimmedNotes]);
  const dirty = loaded && Object.keys(changes).length > 0;
  const guard = useFormGuard(dirty);

  const save = useMutation<ClientUpdateResult, ApiError, ClientUpdateBody>({
    mutationFn: (body) => updateClient(params.clientId, body),
    onSuccess: async (result) => {
      toast.show({ message: t('customers.edit.saved'), tone: 'success' });
      if (params.orderId && result.confirmationNeedsNewLink) useNewLinkStore.getState().need(params.orderId);
      guard.release();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.clients }),
        // The orders show the customer's name and number, and the card compares the link's number.
        queryClient.invalidateQueries({ queryKey: qk.orders.all }),
      ]);
      navigation.goBack();
    },
    onError: (error) => {
      if (error.code === 'CLIENT_PHONE_EXISTS') {
        const found = (error.details as { name?: unknown }).name;
        setPhoneError(typeof found === 'string' ? t('customers.add.phoneExists', { name: found }) : toUserMessage(error, t));
      } else if (error.code === 'CLIENT_PHONE_INVALID') {
        setPhoneError(toUserMessage(error, t));
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

  // The button stays enabled and says what is missing when pressed (UX_PRINCIPLES §7.3).
  const submit = () => {
    const nameOk = trimmedName.length > 0;
    setNameError(nameOk ? null : t('customers.add.nameRequired'));
    if (!e164) setPhoneError(t('errors.CLIENT_PHONE_INVALID'));
    if (!nameOk || !e164 || save.isPending) return;
    save.mutate(changes);
  };

  const footer = (
    <>
      <ActionLine error={lineError} />
      <Button
        label={t('customers.edit.save')}
        onPress={submit}
        size="lg"
        loading={save.isPending}
        loadingLabel={t('customers.edit.saving')}
        disabled={!client}
      />
    </>
  );

  if (!client) {
    return (
      <Screen footer={footer}>
        {clients.data ? (
          <EmptyState icon="customer" title={t('errors.CLIENT_NOT_FOUND')} />
        ) : (
          <FirstLoadState
            error={clients.error}
            isError={clients.isError}
            skeleton={<SkeletonCard lines={3} />}
            onRetry={() => void clients.refetch()}
          />
        )}
      </Screen>
    );
  }

  const address = defaultAddress(client);
  return (
    <Screen footer={footer}>
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
            if (phoneError) setPhoneError(null);
          }}
          onBlur={(value) => {
            if (!value && phone.trim()) setPhoneError(t('errors.CLIENT_PHONE_INVALID'));
          }}
          error={phoneError ?? serverFields.phone}
        />
        <AddMore label={t('customers.edit.addNote')} open={!!(client.notes?.trim() || serverFields.notes)}>
          <Field
            label={t('customers.add.notes')}
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={NOTES_MAX}
            error={serverFields.notes}
          />
        </AddMore>
        {address ? (
          <View style={styles.address} accessible>
            <Icon name="map" size={24} tone="secondary" />
            <View style={styles.flex}>
              <Text>{address.label}</Text>
              <Text variant="caption" tone="secondary">
                {t('customers.edit.addressNote')}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
});
