import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
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
import { requiredOr } from './required';
import './distributors.css';

/** The Edit contact form: the shared update schema, with the phone checked as a Pakistani mobile first. */
const contactSchema = updateDistributorSchema.extend({
  phone: phoneInputSchema.refine((value) => normalizePkPhone(value) !== null, 'INVALID_PHONE').optional(),
});

interface DialogProps {
  distributor: DistributorDto;
  onClose: () => void;
  /** After a save that changed something: the page tints the card that changed. */
  onSaved?: () => void;
}

/**
 * The footer every edit dialog shares: "Go back" (with the focus) and the one primary, which stays
 * enabled (UX_ADMIN §1.7): pressed with a gap, the form says what is missing.
 */
function DialogFooter({
  formId,
  saveLabel,
  saving,
  goBackRef,
  onClose,
}: {
  formId: string;
  saveLabel: string;
  saving: boolean;
  goBackRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <>
      <Button ref={goBackRef} onClick={onClose} disabled={saving}>
        {t('actions.goBack')}
      </Button>
      <Button type="submit" form={formId} variant="primary" loading={saving}>
        {saveLabel}
      </Button>
    </>
  );
}

/**
 * Edit contact (UX_ADMIN §2.4, website spec W21): business name, contact name, mobile and email. Only
 * the changed fields are sent (`PATCH /distributors/:id`); saving with no change just closes. A new
 * mobile signs them out of the app, so the field says so. The CNIC can't be changed here.
 */
export function EditContactDialog({ distributor, onClose, onSaved }: DialogProps) {
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
  const values = form.values;

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
        onSaved?.();
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
        <DialogFooter formId={formId} saveLabel={t('editContact.save')} saving={update.isPending} goBackRef={goBackRef} onClose={onClose} />
      }
    >
      <form id={formId} className="sf-dist-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field label={t('contact.businessName')} error={requiredOr(form, 'businessName', values.businessName, t('add.required.businessName'))}>
          <TextInput
            name="businessName"
            value={values.businessName ?? ''}
            onChange={(event) => form.setValue('businessName', event.target.value)}
            onBlur={() => form.touch('businessName')}
          />
        </Field>
        <Field label={t('contact.name')} error={requiredOr(form, 'name', values.name, t('add.required.contactName'))}>
          <TextInput
            name="name"
            value={values.name ?? ''}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.touch('name')}
          />
        </Field>
        <Field
          label={t('add.phone')}
          hint={t('editContact.phoneHint')}
          error={requiredOr(
            form,
            'phone',
            values.phone,
            t('add.required.phone'),
            normalizePkPhone(values.phone ?? '') === null ? t('add.phoneInvalid') : undefined,
          )}
        >
          <PhoneInput
            name="phone"
            autoComplete="off"
            value={values.phone ?? ''}
            // The box sends the number again when it loses focus: only a real change clears an error.
            onChange={(value) => {
              if (value !== values.phone) form.setValue('phone', value);
            }}
            onBlur={() => form.touch('phone')}
          />
        </Field>
        <Field label={t('contact.email')} optional error={form.errorFor('email')}>
          <TextInput
            name="email"
            type="email"
            autoComplete="off"
            value={(values.email as string | null | undefined) ?? ''}
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
 * Edit store (UX_ADMIN §2.4, website spec W22): name, address and the pin, on a map opened on the pin
 * at street level with the zones shaded. The zone comes from the pin on the server; if it changes, the
 * dialog says "Moves from zone North to South. New trips start here." A distributor from before the
 * pilot without a store gets one here (all four fields are sent).
 */
export function EditStoreDialog({ distributor, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
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
  /** Bring the map's line into view after the render that shows it. */
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (!showMap) return;
    formRef.current?.querySelector<HTMLElement>('.sf-map__status-wrap')?.scrollIntoView({ block: 'center' });
    setShowMap(false);
  }, [showMap]);

  const pinError = pin
    ? outside
      ? null
      : (form.errorFor('lat') ?? form.errorFor('lng') ?? null)
    : form.errorFor('lat') || form.errorFor('lng')
      ? t('add.pinFirst')
      : null;

  const save = form.handleSubmit((data) => {
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
        onSaved?.();
        onClose();
      },
      onError: (error) => {
        form.setServerError(error, { STORE_OUTSIDE_ZONES: 'lat' });
        if (toApiError(error).code === 'STORE_OUTSIDE_ZONES') {
          void recheckZones();
          setShowMap(true);
        }
      },
    });
  });

  const submit = (event: FormEvent) => {
    save(event);
    if (outside || (!pin && values.name && values.address)) setShowMap(true);
  };

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
        <DialogFooter formId={formId} saveLabel={t('editStore.save')} saving={update.isPending} goBackRef={goBackRef} onClose={onClose} />
      }
    >
      <form ref={formRef} id={formId} className="sf-dist-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field label={t('add.storeName')} error={requiredOr(form, 'name', values.name, t('add.required.storeName'))}>
          <TextInput
            name="name"
            value={values.name ?? ''}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.touch('name')}
          />
        </Field>
        <Field label={t('add.storeAddress')} error={requiredOr(form, 'address', values.address, t('add.required.storeAddress'))}>
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
            distributorId={distributor.id}
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
 * Change code (UX_ADMIN §2.4, ADR-22, website spec W24): offered only before the distributor's first
 * order (`codeLocked`); the server refuses it afterwards with `DISTRIBUTOR_CODE_LOCKED`.
 */
export function ChangeCodeDialog({ distributor, onClose }: DialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const formId = useId();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const change = useChangeCode(distributor.id);
  const invalidate = useInvalidateDistributor(distributor.id);
  const form = useZodForm(changeDistributorCodeSchema, { code: '' });
  const [sameShown, setSameShown] = useState(false);
  const typed = (form.values.code ?? '').trim().toUpperCase();
  const same = typed !== '' && typed === distributor.code;

  const save = form.handleSubmit((data) => {
    if (change.isPending) return;
    if (same) {
      setSameShown(true);
      return;
    }
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
        <DialogFooter formId={formId} saveLabel={t('changeCode.save')} saving={change.isPending} goBackRef={goBackRef} onClose={onClose} />
      }
    >
      <form id={formId} className="sf-dist-form" onSubmit={save} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field
          label={t('changeCode.label')}
          hint={t('changeCode.hint')}
          error={sameShown && same ? t('changeCode.sameCode') : requiredOr(form, 'code', form.values.code, t('add.required.code'))}
        >
          <TextInput
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            value={form.values.code ?? ''}
            onChange={(event) => {
              setSameShown(false);
              form.setValue('code', event.target.value.toUpperCase());
            }}
            onBlur={() => form.touch('code')}
          />
        </Field>
      </form>
    </Modal>
  );
}
