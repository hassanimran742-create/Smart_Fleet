import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import {
  createDistributorSchema,
  distributorCodeSchema,
  phoneInputSchema,
  type StoreInput,
} from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { fieldMessages, toApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import { Button, Drawer, Field, InlineAlert, PhoneInput, TextInput, useToast, useZodForm } from '../../ui';
import { useCreateDistributor, useInvalidateDistributor, useRecheckPinZones, type GeoPin } from './api';
import { StoreMapPicker } from './LazyMaps';
import { usePinZone } from './pinZone';
import './distributors.css';

/**
 * The Add form's rules: the shared create schema, with the shop code required here (the API would
 * otherwise pick the initials) and the phone checked as a Pakistani mobile before it is sent. Duplicate
 * phones, CNICs and codes are checked only on the server (UX_ADMIN §2.4: no browser-side checks).
 */
export const newDistributorSchema = createDistributorSchema.extend({
  phone: phoneInputSchema.refine((value) => normalizePkPhone(value) !== null, 'INVALID_PHONE'),
  code: distributorCodeSchema,
});

/** The store while it is being filled in: the pin may not be dropped yet. */
type StoreDraft = Partial<StoreInput>;

/** Server refusals that belong to one field (UX_ADMIN §2.4). */
const FIELD_ERRORS = {
  USER_PHONE_IN_USE: 'phone',
  USER_CNIC_IN_USE: 'cnic',
  DISTRIBUTOR_CODE_IN_USE: 'code',
  DISTRIBUTOR_CODE_INVALID: 'code',
  STORE_OUTSIDE_ZONES: 'store.lat',
} as const;

/**
 * Moves to the field of an error at `path` and brings it, message included, into view, so a message
 * above or below the visible part of the drawer is never missed. A pin's message, the last thing in the
 * drawer, is centred so the space under it shows too.
 */
function goToError(form: HTMLFormElement, path: string): void {
  if (path === 'store.lat' || path === 'store.lng') {
    form.querySelector<HTMLElement>('.sf-dist-form__map .leaflet-container')?.focus({ preventScroll: true });
    form.querySelector<HTMLElement>('.sf-map__status-wrap')?.scrollIntoView({ block: 'center' });
    return;
  }
  const name = path === 'store.address' ? 'storeAddress' : (path.split('.')[0] ?? path);
  const control = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
  control?.focus({ preventScroll: true });
  (control?.closest<HTMLElement>('.sf-field') ?? control)?.scrollIntoView({ block: 'nearest' });
}

function pinOf(store: StoreDraft): GeoPin | null {
  return typeof store.lat === 'number' && typeof store.lng === 'number' ? { lat: store.lat, lng: store.lng } : null;
}

/**
 * Add distributor (`/distributors/new`, the 640 px drawer of UX_ADMIN §2.4): the business, the shop
 * code, an optional CNIC and email, and the one store with its pin. The zone is read-only, from the
 * server; a pin outside every active zone can't be saved. Nothing is suggested or copied from other
 * people's records. The create carries an Idempotency-Key, so a retry never makes a second one.
 */
export function NewDistributorDrawer() {
  const { t } = useTranslation(['distributors', 'common']);
  const close = useCloseDrawer();
  const navigate = useNavigate();
  const toast = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  /** The field a server refusal is about, moved to once its message is on screen. */
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const recheckZones = useRecheckPinZones();
  const create = useCreateDistributor();
  const invalidate = useInvalidateDistributor();
  const form = useZodForm(newDistributorSchema, {
    businessName: '',
    name: '',
    phone: '',
    code: '',
    cnic: '',
    email: '',
    store: { name: '', address: '' } as StoreInput,
  });
  const [storeNameEdited, setStoreNameEdited] = useState(false);

  const store: StoreDraft = form.values.store ?? {};
  const pin = pinOf(store);
  const zone = usePinZone(pin);
  const outside = zone.status === 'outside';

  const setStore = (patch: StoreDraft) => {
    form.setValue('store', { ...store, ...patch } as StoreInput);
  };

  const onBusinessName = (value: string) => {
    form.setValue('businessName', value);
    if (!storeNameEdited) setStore({ name: value.trim() ? t('add.storeNameDefault', { business: value.trim() }) : '' });
  };

  // A pin outside every zone already has the map's own warning; the same words twice would be noise.
  const pinError = pin
    ? outside
      ? null
      : (form.errorFor('store.lat') ?? form.errorFor('store.lng') ?? null)
    : form.errorFor('store.lat') || form.errorFor('store.lng')
      ? t('map.pinRequired')
      : null;

  const submit = form.handleSubmit((body) => {
    if (outside || create.isPending) return;
    create.mutate(body, {
      onSuccess: (created) => {
        toast.success(t('add.toast', { name: created.businessName }));
        void invalidate();
        void navigate({ to: '/distributors/$id', params: { id: created.id }, replace: true });
      },
      onError: (error) => {
        form.setServerError(error, FIELD_ERRORS);
        const code = toApiError(error).code;
        const mapped = (FIELD_ERRORS as Readonly<Record<string, string | undefined>>)[code];
        const path = mapped ?? Object.keys(fieldMessages(error))[0] ?? null;
        if (code === 'STORE_OUTSIDE_ZONES') {
          // The pin's zone may have been archived since it was dropped: check it again first, then
          // move to the map with the final message (the outside warning) in place.
          void recheckZones().finally(() => setJumpTo(path));
        } else {
          setJumpTo(path);
        }
      },
    });
  });

  // After the render that shows the message, so it is measured with the message in place.
  useEffect(() => {
    if (!jumpTo || !formRef.current) return;
    goToError(formRef.current, jumpTo);
    setJumpTo(null);
  }, [jumpTo]);

  return (
    <Drawer
      title={t('add.title')}
      width="lg"
      dirty={form.isDirty && !create.isSuccess}
      dismissible={!create.isPending}
      onClose={close}
      footer={{
        end: (
          <>
            <Button onClick={close} disabled={create.isPending}>
              {t('add.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              loading={create.isPending}
              disabled={outside}
              disabledReason={outside ? t('add.pinFirst') : undefined}
            >
              {t('add.submit')}
            </Button>
          </>
        ),
      }}
    >
      <form ref={formRef} id={formId} className="sf-dist-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}

        <section className="sf-dist-form__section" aria-labelledby={`${formId}-business`}>
          <h3 id={`${formId}-business`} className="sf-dist-form__heading">
            {t('add.business')}
          </h3>
          <div className="sf-dist-form__grid">
            <Field label={t('add.businessName')} error={form.errorFor('businessName')}>
              <TextInput
                name="businessName"
                autoComplete="organization"
                value={form.values.businessName ?? ''}
                onChange={(event) => onBusinessName(event.target.value)}
                onBlur={() => form.touch('businessName')}
              />
            </Field>
            <Field label={t('add.contactName')} error={form.errorFor('name')}>
              <TextInput
                name="name"
                autoComplete="off"
                value={form.values.name ?? ''}
                onChange={(event) => form.setValue('name', event.target.value)}
                onBlur={() => form.touch('name')}
              />
            </Field>
            <Field label={t('add.phone')} hint={t('add.phoneHint')} error={form.errorFor('phone')}>
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
            <Field label={t('add.code')} hint={t('add.codeHint')} error={form.errorFor('code')}>
              <TextInput
                name="code"
                mono
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={6}
                value={form.values.code ?? ''}
                onChange={(event) => form.setValue('code', event.target.value.toUpperCase())}
                onBlur={() => form.touch('code')}
              />
            </Field>
            <Field label={t('add.cnic')} hint={t('add.cnicHint')} optional error={form.errorFor('cnic')}>
              <TextInput
                name="cnic"
                inputMode="numeric"
                autoComplete="off"
                maxLength={15}
                value={(form.values.cnic as string | undefined) ?? ''}
                onChange={(event) => form.setValue('cnic', event.target.value)}
                onBlur={() => form.touch('cnic')}
              />
            </Field>
            <Field label={t('add.email')} optional error={form.errorFor('email')}>
              <TextInput
                name="email"
                type="email"
                autoComplete="off"
                value={(form.values.email as string | undefined) ?? ''}
                onChange={(event) => form.setValue('email', event.target.value)}
                onBlur={() => form.touch('email')}
              />
            </Field>
          </div>
        </section>

        <section className="sf-dist-form__section" aria-labelledby={`${formId}-store`}>
          <h3 id={`${formId}-store`} className="sf-dist-form__heading">
            {t('add.store')}
          </h3>
          <p className="sf-dist-form__help">{t('add.storeHelp')}</p>
          <div className="sf-dist-form__grid">
            <Field label={t('add.storeName')} error={form.errorFor('store.name')}>
              <TextInput
                name="store"
                autoComplete="off"
                value={store.name ?? ''}
                onChange={(event) => {
                  setStoreNameEdited(true);
                  setStore({ name: event.target.value });
                }}
                onBlur={() => form.touch('store.name')}
              />
            </Field>
            <Field label={t('add.storeAddress')} error={form.errorFor('store.address')}>
              <TextInput
                name="storeAddress"
                autoComplete="off"
                value={store.address ?? ''}
                onChange={(event) => setStore({ address: event.target.value })}
                onBlur={() => form.touch('store.address')}
              />
            </Field>
          </div>
          <div className="sf-dist-form__map">
            <p className="sf-field__label">{t('map.label')}</p>
            <p className="sf-field__hint">{t('map.hint')}</p>
            <StoreMapPicker
              value={pin}
              onChange={(next) => setStore({ lat: next.lat, lng: next.lng })}
              zone={zone}
              error={pinError}
              disabled={create.isPending}
            />
          </div>
        </section>
      </form>
    </Drawer>
  );
}
