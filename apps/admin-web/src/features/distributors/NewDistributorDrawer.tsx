import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import {
  createDistributorSchema,
  distributorCodeSchema,
  parseRequest,
  phoneInputSchema,
  type StoreInput,
} from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { fieldMessages, toApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import { AddMore, Button, Drawer, Field, flashRow, InlineAlert, PhoneInput, TextInput, useToast, useZodForm } from '../../ui';
import { useCreateDistributor, useDistributors, useInvalidateDistributor, useRecheckPinZones, type GeoPin } from './api';
import { suggestCode } from './code';
import { StoreMapPicker } from './LazyMaps';
import { usePinZone } from './pinZone';
import { requiredOr } from './required';
import './distributors.css';

/**
 * The Add form's rules: the shared create schema, with the distributor code required here (it is
 * suggested from the business name) and the phone checked as a Pakistani mobile before it is sent.
 * Duplicate phones, CNICs and codes are checked only on the server (UX_ADMIN §2.4).
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
  if (path === 'store.lat' || path === 'store.lng' || path === 'store') {
    form.querySelector<HTMLElement>('.sf-dist-form__map .leaflet-container')?.focus({ preventScroll: true });
    form.querySelector<HTMLElement>('.sf-map__status-wrap')?.scrollIntoView({ block: 'center' });
    return;
  }
  const name = path === 'store.address' ? 'storeAddress' : path === 'store.name' ? 'store' : (path.split('.')[0] ?? path);
  const control = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
  control?.focus({ preventScroll: true });
  (control?.closest<HTMLElement>('.sf-field') ?? control)?.scrollIntoView({ block: 'nearest' });
}

function pinOf(store: StoreDraft): GeoPin | null {
  return typeof store.lat === 'number' && typeof store.lng === 'number' ? { lat: store.lat, lng: store.lng } : null;
}

/** The order the fields appear in, so the first missing one is the one the person reaches first. */
const FIELD_ORDER = ['businessName', 'name', 'phone', 'code', 'cnic', 'email', 'store.name', 'store.address', 'store.lat', 'store.lng'];

function firstPath(paths: readonly string[]): string | null {
  const sorted = [...paths].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return sorted[0] ?? null;
}

/**
 * Add distributor (`/distributors/new`, the 640 px drawer of UX_ADMIN §2.4, website spec W19): the
 * business with a distributor code suggested from its name, the CNIC and email behind "+ Add CNIC or
 * email", and the one store with its pin on a map that shows the zones. The zone is read-only, from the
 * server; a pin outside every active zone can't be saved. The main button stays enabled: pressed with a
 * gap, each field says what to type and the drawer moves to the first one. The create carries an
 * Idempotency-Key, so a retry never makes a second one. There is no Cancel: × and Esc close it.
 */
export function NewDistributorDrawer() {
  const { t } = useTranslation(['distributors', 'common']);
  const close = useCloseDrawer();
  const toast = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  /** The field to move to once its message is on screen. */
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const recheckZones = useRecheckPinZones();
  const create = useCreateDistributor();
  const invalidate = useInvalidateDistributor();
  const existing = useDistributors();
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
  const [codeEdited, setCodeEdited] = useState(false);

  const store: StoreDraft = form.values.store ?? {};
  const pin = pinOf(store);
  const zone = usePinZone(pin);
  const outside = zone.status === 'outside';
  const takenCodes = useMemo(() => new Set((existing.data ?? []).map((d) => d.code)), [existing.data]);

  const setStore = (patch: StoreDraft) => {
    form.setValue('store', { ...store, ...patch } as StoreInput);
  };

  const onBusinessName = (value: string) => {
    form.setValue('businessName', value);
    if (!storeNameEdited) setStore({ name: value.trim() ? t('add.storeNameDefault', { business: value.trim() }) : '' });
    // The code follows the name ("Noor Gas" → "NG") until the person types their own.
    if (!codeEdited) form.setValue('code', suggestCode(value, takenCodes));
  };

  const values = form.values;
  const pinError = pin
    ? outside
      ? null
      : (form.errorFor('store.lat') ?? form.errorFor('store.lng') ?? null)
    : form.errorFor('store.lat') || form.errorFor('store.lng')
      ? t('add.pinFirst')
      : null;

  const create$ = form.handleSubmit((body) => {
    if (outside || create.isPending) return;
    create.mutate(body, {
      onSuccess: (created) => {
        toast.success(t('add.toast', { name: created.businessName }));
        flashRow('distributors', created.id);
        void invalidate();
        close();
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

  const submit = (event: FormEvent) => {
    create$(event);
    const result = parseRequest(newDistributorSchema, form.values);
    if (!result.success) {
      setJumpTo(firstPath(result.fields.map((field) => field.path)));
      return;
    }
    // A pin outside every zone: the map's own red line says so; bring it into view.
    if (outside) setJumpTo('store.lat');
  };

  // After the render that shows the message, so it is measured with the message in place.
  useEffect(() => {
    if (!jumpTo || !formRef.current) return;
    goToError(formRef.current, jumpTo);
    setJumpTo(null);
  }, [jumpTo]);

  const cnicOrEmail = Boolean((values.cnic as string | undefined)?.trim() || (values.email as string | undefined)?.trim());

  return (
    <Drawer
      title={t('add.title')}
      width="lg"
      dirty={form.isDirty && !create.isSuccess}
      dismissible={!create.isPending}
      onClose={close}
      footer={{
        end: (
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            {t('add.submit')}
          </Button>
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
            <Field label={t('add.businessName')} error={requiredOr(form, 'businessName', values.businessName, t('add.required.businessName'))}>
              <TextInput
                name="businessName"
                autoComplete="organization"
                value={values.businessName ?? ''}
                onChange={(event) => onBusinessName(event.target.value)}
                onBlur={() => form.touch('businessName')}
              />
            </Field>
            <Field label={t('add.contactName')} error={requiredOr(form, 'name', values.name, t('add.required.contactName'))}>
              <TextInput
                name="name"
                autoComplete="off"
                value={values.name ?? ''}
                onChange={(event) => form.setValue('name', event.target.value)}
                onBlur={() => form.touch('name')}
              />
            </Field>
            <Field
              label={t('add.phone')}
              hint={t('add.phoneHint')}
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
            <Field label={t('add.code')} hint={t('add.codeHint')} error={requiredOr(form, 'code', values.code, t('add.required.code'))}>
              <TextInput
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={6}
                value={values.code ?? ''}
                onChange={(event) => {
                  setCodeEdited(true);
                  form.setValue('code', event.target.value.toUpperCase());
                }}
                onBlur={() => form.touch('code')}
              />
            </Field>
          </div>
          <AddMore label={t('add.addMore')} defaultOpen={cnicOrEmail || Boolean(form.errorFor('cnic') || form.errorFor('email'))}>
            <div className="sf-dist-form__grid">
              <Field label={t('add.cnic')} hint={t('add.cnicHint')} error={form.errorFor('cnic')}>
                <TextInput
                  name="cnic"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={15}
                  value={(values.cnic as string | undefined) ?? ''}
                  onChange={(event) => form.setValue('cnic', event.target.value)}
                  onBlur={() => form.touch('cnic')}
                />
              </Field>
              <Field label={t('add.email')} error={form.errorFor('email')}>
                <TextInput
                  name="email"
                  type="email"
                  autoComplete="off"
                  value={(values.email as string | undefined) ?? ''}
                  onChange={(event) => form.setValue('email', event.target.value)}
                  onBlur={() => form.touch('email')}
                />
              </Field>
            </div>
          </AddMore>
        </section>

        <section className="sf-dist-form__section" aria-labelledby={`${formId}-store`}>
          <h3 id={`${formId}-store`} className="sf-dist-form__heading">
            {t('add.store')}
          </h3>
          <div className="sf-dist-form__grid">
            <Field label={t('add.storeName')} error={requiredOr(form, 'store.name', store.name, t('add.required.storeName'))}>
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
            <Field
              label={t('add.storeAddress')}
              error={requiredOr(form, 'store.address', store.address, t('add.required.storeAddress'))}
            >
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
