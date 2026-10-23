import { useId, useRef, type RefObject } from 'react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import {
  changeDistributorCodeSchema,
  phoneInputSchema,
  storeInputSchema,
  updateDistributorSchema,
  type StoreInput,
  type UpdateDistributorInput,
  type UpdateDistributorStoreInput,
} from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { Button, Field, InlineAlert, Modal, PhoneInput, TextInput, useToast, useZodForm } from '../../ui';
import { toApiError } from '../../api/errors';
import {
  useChangeCode,
  useInvalidateDistributor,
  useRecheckPinZones,
  useUpdateDistributor,
  useUpdateStore,
  type GeoPin,
} from './api';
import { StoreMapPicker } from './LazyMaps';
import { usePinZone } from './pinZone';
import './distributors.css';

/** The Edit contact form: the shared update schema, with the phone checked as a Pakistani mobile first. */
const contactSchema = updateDistributorSchema.extend({
  phone: phoneInputSchema.refine((value) => normalizePkPhone(value) !== null, 'INVALID_PHONE').optional(),
});

interface DialogProps {
  distributor: DistributorDto;
  onClose: () => void;
}

/** The footer every edit dialog shares: "Go back" (with the focus) and the one primary. */
function DialogFooter({
  formId,
  saveLabel,
  saving,
  blocked,
  goBackRef,
  onClose,
}: {
  formId: string;
  saveLabel: string;
  saving: boolean;
  blocked: string | null;
  goBackRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <>
      <Button ref={goBackRef} onClick={onClose} disabled={saving}>
        {t('actions.goBack')}
      </Button>
      <Button
        type="submit"
        form={formId}
        variant="primary"
        loading={saving}
        disabled={blocked !== null}
        disabledReason={blocked ?? undefined}
      >
        {saveLabel}
      </Button>
    </>
  );
}

/**
 * Edit contact (UX_ADMIN §2.4): business name, contact name, mobile and email. Only the changed fields
 * are sent (`PATCH /distributors/:id`); a new mobile signs the shop out of the app, so the dialog says so.
 */
export function EditContactDialog({ distributor, onClose }: DialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const formId = useId();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const update = useUpdateDistributor(distributor.id);
  const invalidate = useInvalidateDistributor(distributor.id);
  const form = useZodForm(contactSchema, {
    businessName: distributor.businessName,
    name: distributor.contact.name,
    phone: distributor.contact.phone,
    email: distributor.contact.email ?? '',
  });

  const submit = form.handleSubmit((data) => {
    const body: UpdateDistributorInput = {};
    if (data.businessName !== undefined && data.businessName !== distributor.businessName) body.businessName = data.businessName;
    if (data.name !== undefined && data.name !== distributor.contact.name) body.name = data.name;
    if (data.phone !== undefined && normalizePkPhone(data.phone) !== distributor.contact.phone) body.phone = data.phone;
    const email = data.email ?? null;
    if (data.email !== undefined && email !== (distributor.contact.email ?? null)) body.email = email;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    update.mutate(body, {
      onSuccess: (saved) => {
        toast.success(t('editContact.toast', { name: saved.businessName }));
        void invalidate();
        onClose();
      },
      onError: (error) => form.setServerError(error, { USER_PHONE_IN_USE: 'phone', CONFLICT_DUPLICATE: 'email' }),
    });
  });

  return (
    <Modal
      open
      size="md"
      title={t('editContact.title', { name: distributor.businessName })}
      onClose={() => {
        if (!update.isPending) onClose();
      }}
      dismissible={!update.isPending}
      initialFocusRef={goBackRef}
      footer={
        <DialogFooter
          formId={formId}
          saveLabel={t('editContact.save')}
          saving={update.isPending}
          blocked={form.isDirty ? null : t('editContact.noChanges')}
          goBackRef={goBackRef}
          onClose={onClose}
        />
      }
    >
      <form id={formId} className="sf-dist-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field label={t('contact.businessName')} error={form.errorFor('businessName')}>
          <TextInput
            name="businessName"
            value={form.values.businessName ?? ''}
            onChange={(event) => form.setValue('businessName', event.target.value)}
            onBlur={() => form.touch('businessName')}
          />
        </Field>
        <Field label={t('contact.name')} error={form.errorFor('name')}>
          <TextInput
            name="name"
            value={form.values.name ?? ''}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.touch('name')}
          />
        </Field>
        <Field label={t('contact.phone')} hint={t('editContact.phoneHint')} error={form.errorFor('phone')}>
          <PhoneInput
            name="phone"
            autoComplete="off"
            value={form.values.phone ?? ''}
            // The box sends the number again when it loses focus: only a real change clears an error.
            onChange={(value) => {
              if (value !== form.values.phone) form.setValue('phone', value);
            }}
            onBlur={() => form.touch('phone')}
          />
        </Field>
        <Field label={t('contact.email')} optional error={form.errorFor('email')}>
          <TextInput
            name="email"
            type="email"
            autoComplete="off"
            value={(form.values.email as string | null | undefined) ?? ''}
            onChange={(event) => form.setValue('email', event.target.value)}
            onBlur={() => form.touch('email')}
          />
        </Field>
      </form>
    </Modal>
  );
}

function pinOf(store: Partial<StoreInput>): GeoPin | null {
  return typeof store.lat === 'number' && typeof store.lng === 'number' ? { lat: store.lat, lng: store.lng } : null;
}

/**
 * Edit store (UX_ADMIN §2.4): name, address and the pin. The zone comes from the pin on the server; if
 * it changes, the dialog says "The store moves from zone G-9 to G-10. New trips start from the new
 * place." A distributor from before the pilot without a store gets one here (all four fields are sent).
 */
export function EditStoreDialog({ distributor, onClose }: DialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const formId = useId();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const update = useUpdateStore(distributor.id);
  const recheckZones = useRecheckPinZones();
  const invalidate = useInvalidateDistributor(distributor.id);
  const current = distributor.store;
  const form = useZodForm(storeInputSchema, {
    name: current?.name ?? '',
    address: current?.address ?? '',
    lat: current?.lat,
    lng: current?.lng,
  });
  const values = form.values;
  const pin = pinOf(values);
  const zone = usePinZone(pin);
  const outside = zone.status === 'outside';
  const moved = current && zone.status === 'found' && zone.zone.id !== current.zone.id ? zone.zone : null;

  // A pin outside every zone already has the map's own warning; the same words twice would be noise.
  const pinError = pin
    ? outside
      ? null
      : (form.errorFor('lat') ?? form.errorFor('lng') ?? null)
    : form.errorFor('lat') || form.errorFor('lng')
      ? t('map.pinRequired')
      : null;

  const submit = form.handleSubmit((data) => {
    if (outside || update.isPending) return;
    let body: UpdateDistributorStoreInput;
    if (!current) {
      body = data;
    } else {
      body = {};
      if (data.name !== current.name) body.name = data.name;
      if (data.address !== current.address) body.address = data.address;
      if (data.lat !== current.lat || data.lng !== current.lng) {
        body.lat = data.lat;
        body.lng = data.lng;
      }
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    }
    update.mutate(body, {
      onSuccess: (saved) => {
        toast.success(t('editStore.toast', { name: saved.businessName }));
        void invalidate();
        onClose();
      },
      onError: (error) => {
        form.setServerError(error, { STORE_OUTSIDE_ZONES: 'lat' });
        if (toApiError(error).code === 'STORE_OUTSIDE_ZONES') void recheckZones();
      },
    });
  });

  const blocked = outside ? t('add.pinFirst') : !form.isDirty && current ? t('editStore.noChanges') : null;

  return (
    <Modal
      open
      size="md"
      title={
        current
          ? t('editStore.title', { name: distributor.businessName })
          : t('editStore.titleSetUp', { name: distributor.businessName })
      }
      onClose={() => {
        if (!update.isPending) onClose();
      }}
      dismissible={!update.isPending}
      initialFocusRef={goBackRef}
      footer={
        <DialogFooter
          formId={formId}
          saveLabel={t('editStore.save')}
          saving={update.isPending}
          blocked={blocked}
          goBackRef={goBackRef}
          onClose={onClose}
        />
      }
    >
      <form id={formId} className="sf-dist-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <p className="sf-dist-form__help">{t('add.storeHelp')}</p>
        <Field label={t('add.storeName')} error={form.errorFor('name')}>
          <TextInput
            name="name"
            value={values.name ?? ''}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.touch('name')}
          />
        </Field>
        <Field label={t('add.storeAddress')} error={form.errorFor('address')}>
          <TextInput
            name="address"
            value={values.address ?? ''}
            onChange={(event) => form.setValue('address', event.target.value)}
            onBlur={() => form.touch('address')}
          />
        </Field>
        <div className="sf-dist-form__map">
          <p className="sf-field__label">{t('map.label')}</p>
          <p className="sf-field__hint">{t('map.hint')}</p>
          <StoreMapPicker
            value={pin}
            onChange={(next) => {
              form.setValue('lat', next.lat);
              form.setValue('lng', next.lng);
            }}
            zone={zone}
            error={pinError}
            disabled={update.isPending}
          />
        </div>
        {moved && current ? (
          <InlineAlert tone="warning" live>
            {t('editStore.moved', { from: current.zone.name, to: moved.name })}
          </InlineAlert>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * Change code (UX_ADMIN §2.4, ADR-22): offered only before the distributor's first order
 * (`codeLocked`); the server refuses it afterwards with `DISTRIBUTOR_CODE_LOCKED`.
 */
export function ChangeCodeDialog({ distributor, onClose }: DialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const formId = useId();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const change = useChangeCode(distributor.id);
  const invalidate = useInvalidateDistributor(distributor.id);
  const form = useZodForm(changeDistributorCodeSchema, { code: '' });
  const typed = (form.values.code ?? '').trim().toUpperCase();
  const same = typed !== '' && typed === distributor.code;

  const submit = form.handleSubmit((data) => {
    if (same || change.isPending) return;
    change.mutate(data.code, {
      onSuccess: (saved) => {
        toast.success(t('changeCode.toast', { name: saved.businessName, code: saved.code }));
        void invalidate();
        onClose();
      },
      onError: (error) => {
        form.setServerError(error, { DISTRIBUTOR_CODE_IN_USE: 'code', DISTRIBUTOR_CODE_INVALID: 'code' });
        if (error.is('DISTRIBUTOR_CODE_LOCKED')) void invalidate();
      },
    });
  });

  return (
    <Modal
      open
      size="sm"
      title={t('changeCode.title', { name: distributor.businessName })}
      onClose={() => {
        if (!change.isPending) onClose();
      }}
      dismissible={!change.isPending}
      initialFocusRef={goBackRef}
      footer={
        <DialogFooter
          formId={formId}
          saveLabel={t('changeCode.save')}
          saving={change.isPending}
          blocked={same ? t('changeCode.sameCode') : null}
          goBackRef={goBackRef}
          onClose={onClose}
        />
      }
    >
      <form id={formId} className="sf-dist-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field label={t('changeCode.label')} hint={t('changeCode.hint')} error={form.errorFor('code')}>
          <TextInput
            name="code"
            mono
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            placeholder={distributor.code}
            value={form.values.code ?? ''}
            onChange={(event) => form.setValue('code', event.target.value.toUpperCase())}
            onBlur={() => form.touch('code')}
          />
        </Field>
      </form>
    </Modal>
  );
}
