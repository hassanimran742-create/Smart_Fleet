import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ImagePlus, KeyRound, Pencil, Plus, SearchX, UserRound } from 'lucide-react';
import type { DriverAvailability, DriverOfficeDto } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { createDriverSchema, phoneInputSchema } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { uploadFile } from '../api/upload';
import { AppPasswordDialog } from '../features/distributors/AppPasswordDialog';
import { OSM_CREDIT, OSM_TILES } from '../features/distributors/StoreMapPicker';
import { MoreMenu, type MoreMenuItem } from '../features/orders/MoreMenu';
import { useDriversSocket } from '../hooks/useDriversSocket';
import { formatDateTime, formatDay, formatPhone } from '../i18n/format';
import {
  AddMore,
  AppChip,
  Button,
  DateInput,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  flashRow,
  InlineAlert,
  Modal,
  PageHeader,
  PhoneInput,
  SearchField,
  StatusChip,
  Table,
  TextInput,
  todayInKarachi,
  ToggleChip,
  useConfirm,
  useFlashedRow,
  useToast,
  useZodForm,
  type TableColumn,
} from '../ui';
import { useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy Drivers screen, kept inside the new shell for Inc 1 (UX_ADMIN §2.11). Light pass (website spec
 * W43): the list comes first, with a search and the "Show archived" chip; one status chip per driver
 * (account suspended, then on leave, then on duty or offline), then the app chip ("App: up to date" or "App:
 * needs update" against app.minVersion.driver, API_CONTRACT §8.5 step 10); "Edit" and "Password" as labelled
 * buttons and the rarer actions under More. "Add driver" and Edit open drawers; the licence, email and CNIC live
 * there (the CNIC only masked: API_CONTRACT §3.5, G11-12). Archive and reactivate keep the reasons the
 * API requires, and every pop-up is the app's own.
 */

type DriverRow = DriverOfficeDto & { leaveReason?: string | null };

const QUERY_KEY = ['drivers'] as const;

/** The add form: the shared create schema, with the phone checked as a Pakistani mobile first. */
const addDriverSchema = createDriverSchema.extend({
  phone: phoneInputSchema.refine((value) => normalizePkPhone(value) !== null, 'INVALID_PHONE'),
});

/** Digits a person may type for a phone: "0300 123" and "300123" both find "+92 300 1234567". */
function phoneDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^0092/, '').replace(/^92(?=\d{4,})/, '').replace(/^0+/, '');
}

function matches(driver: DriverRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${driver.user.name} ${driver.currentVehicle?.plateNo ?? ''}`.toLowerCase();
  if (words.every((word) => text.includes(word))) return true;
  const digits = phoneDigits(query);
  return digits.length >= 3 && phoneDigits(driver.user.phone).includes(digits);
}

/** The one chip of a driver, by priority: the account, then leave, then the app's connection. */
function DriverChip({ driver }: { driver: DriverRow }) {
  const lt = useLegacyT();
  if (driver.user.status !== 'ACTIVE') return <StatusChip kind="user" value={driver.user.status} />;
  if (driver.availability === 'ON_LEAVE') {
    return (
      <span className="sf-legacy__two-line">
        <StatusChip kind="driver" value="ON_LEAVE" />
        {driver.leaveEnd ? <span className="sf-legacy__muted">{lt('drivers.until', { date: formatDay(driver.leaveEnd) })}</span> : null}
      </span>
    );
  }
  if (driver.availability === 'OFF_DUTY') return <StatusChip kind="driver" value="OFF_DUTY" />;
  return <StatusChip kind="presence" value={driver.isOnline ? 'ONLINE' : 'OFFLINE'} />;
}

function Avatar({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className="sf-legacy__avatar" />
  ) : (
    <span className="sf-legacy__avatar sf-legacy__avatar--empty" aria-hidden>
      <UserRound size={16} />
    </span>
  );
}

export function DriversScreen() {
  const lt = useLegacyT();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const flashed = useFlashedRow('drivers');
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: async () => (await api.get<DriverRow[]>('/drivers')).data });
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [passwordFor, setPasswordFor] = useState<DriverRow | null>(null);
  const [leaveFor, setLeaveFor] = useState<DriverRow | null>(null);
  const [trackingFor, setTrackingFor] = useState<DriverRow | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const all = query.data ?? [];
  const hasArchived = all.some((d) => d.user.status === 'SUSPENDED');
  const rows = useMemo(() => {
    const visible = (query.data ?? []).filter((d) => showArchived || d.user.status !== 'SUSPENDED');
    return q ? visible.filter((d) => matches(d, q)) : visible;
  }, [query.data, showArchived, q]);

  const setAvailability = useMutation({
    mutationFn: (payload: { id: string; availability: DriverAvailability }) =>
      api.patch(`/drivers/${payload.id}/availability`, { availability: payload.availability }).then((r) => r.data),
    onSuccess: (_data, payload) => {
      flashRow('drivers', payload.id);
      void invalidate();
    },
    onError: (e) => toast.error(e),
  });

  async function archiveDriver(d: DriverRow) {
    const { ok } = await confirm({
      title: lt('drivers.archive.title', { name: d.user.name }),
      body: lt('drivers.archive.body'),
      tone: 'danger',
      confirmLabel: lt('drivers.archive.confirm', { name: d.user.name }),
      reason: { label: t('dialog.why'), required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => api.delete(`/drivers/${d.id}`, { data: { reason } }),
    });
    if (!ok) return;
    toast.success(lt('drivers.archive.toast', { name: d.user.name }));
    void invalidate();
  }

  async function reactivateDriver(d: DriverRow) {
    const { ok } = await confirm({
      title: lt('drivers.reactivate.title', { name: d.user.name }),
      body: lt('drivers.reactivate.body'),
      confirmLabel: lt('drivers.reactivate.confirm', { name: d.user.name }),
      reason: { label: t('dialog.why'), required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => api.patch(`/drivers/${d.id}/reactivate`, { reason }),
    });
    if (!ok) return;
    toast.success(lt('drivers.reactivate.toast', { name: d.user.name }));
    flashRow('drivers', d.id);
    void invalidate();
  }

  const moreItems = (d: DriverRow): MoreMenuItem[] => {
    const items: MoreMenuItem[] = [{ id: 'track', label: lt('drivers.actions.track'), onSelect: () => setTrackingFor(d) }];
    if (d.user.status !== 'SUSPENDED') {
      items.push(
        d.availability === 'ON_LEAVE'
          ? { id: 'available', label: lt('drivers.actions.available'), onSelect: () => setAvailability.mutate({ id: d.id, availability: 'AVAILABLE' }) }
          : { id: 'leave', label: lt('drivers.actions.leave'), onSelect: () => setLeaveFor(d) },
      );
    }
    items.push(
      d.user.status === 'SUSPENDED'
        ? { id: 'reactivate', label: lt('drivers.actions.reactivate'), dividerBefore: true, onSelect: () => void reactivateDriver(d) }
        : { id: 'archive', label: lt('drivers.actions.archive'), danger: true, dividerBefore: true, onSelect: () => void archiveDriver(d) },
    );
    return items;
  };

  const columns: TableColumn<DriverRow>[] = [
    {
      id: 'driver',
      header: lt('drivers.columns.driver'),
      sticky: true,
      cell: (d) => (
        <span className="sf-legacy__person">
          <Avatar url={d.user.profilePictureUrl} />
          <span className="sf-legacy__two-line">
            <span className="sf-legacy__strong">{d.user.name}</span>
            <span className="sf-legacy__muted sf-legacy__nowrap">{formatPhone(d.user.phone)}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: lt('drivers.columns.status'),
      cell: (d) => (
        <span className="sf-legacy__chips">
          <DriverChip driver={d} />
          <AppChip app={d.app} active={d.user.status === 'ACTIVE'} />
        </span>
      ),
    },
    {
      id: 'van',
      header: lt('drivers.columns.van'),
      priority: 2,
      // The plate stays on one line beside the wider Status cell (its app chip): "LEA-101", never "LEA-" / "101".
      cell: (d) =>
        d.currentVehicle ? (
          <span className="sf-legacy__nowrap">{d.currentVehicle.plateNo}</span>
        ) : (
          <span className="sf-legacy__muted">{lt('drivers.noVan')}</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{lt('drivers.columns.actions')}</span>,
      align: 'end',
      cell: (d) => (
        <span className="sf-legacy__actions">
          <Button size="sm" icon={Pencil} onClick={() => setEditing(d)} disabled={d.user.status === 'SUSPENDED'}>
            {lt('drivers.actions.edit')}
          </Button>
          <Button size="sm" icon={KeyRound} onClick={() => setPasswordFor(d)}>
            {lt('drivers.actions.password')}
          </Button>
          <MoreMenu size="sm" label={lt('more')} ariaLabel={lt('drivers.actions.moreLabel', { name: d.user.name })} items={moreItems(d)} />
        </span>
      ),
    },
  ];

  let empty;
  if (q) {
    empty = (
      <EmptyState
        compact
        icon={SearchX}
        title={lt('drivers.searchEmpty', { q })}
        action={<Button onClick={() => setQ('')}>{t('actions.clearSearch')}</Button>}
      />
    );
  } else {
    empty = (
      <EmptyState
        compact
        icon={UserRound}
        title={lt('drivers.empty')}
        action={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {lt('drivers.add')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="sf-legacy-page">
      <PageHeader
        title={lt('drivers.title')}
        primaryAction={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {lt('drivers.add')}
          </Button>
        }
      />
      {all.length > 0 ? (
        <FilterBar>
          <SearchField value={q} onChange={setQ} placeholder={lt('drivers.search')} />
          {hasArchived ? <ToggleChip label={lt('drivers.showArchived')} pressed={showArchived} onChange={setShowArchived} /> : null}
        </FilterBar>
      ) : null}
      <Table<DriverRow>
        caption={lt('drivers.title')}
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        rowTone={(d) => (d.user.status === 'SUSPENDED' ? 'neutral' : null)}
        highlightKey={flashed}
        state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
        empty={empty}
        error={
          <ErrorState
            compact
            error={query.error}
            title={lt('drivers.loadFailed')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        }
      />

      {adding ? <AddDriverDrawer onClose={() => setAdding(false)} /> : null}
      {editing ? <EditDriverDrawer driver={editing} onClose={() => setEditing(null)} /> : null}
      {passwordFor ? (
        <AppPasswordDialog
          userId={passwordFor.user.id}
          name={passwordFor.user.name}
          onClose={() => setPasswordFor(null)}
          onDone={() => void invalidate()}
        />
      ) : null}
      {leaveFor ? <LeaveDialog driver={leaveFor} onClose={() => setLeaveFor(null)} /> : null}
      {trackingFor ? <TrackDriverModal driver={trackingFor} onClose={() => setTrackingFor(null)} /> : null}
    </div>
  );
}

/** A photo for a driver's profile: "Attach a photo", then the picture with Replace and Remove. */
function PhotoField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const lt = useLegacyT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url || null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setPreview(URL.createObjectURL(file));
      const uploaded = await uploadFile(file);
      onChange(uploaded.url);
    } catch (failure) {
      setError(messageFor(failure));
      setPreview(url || null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Field label={lt('drivers.form.photo')} error={error}>
      <div className="sf-legacy__photo">
        {preview ? <img src={preview} alt="" className="sf-legacy__photo-preview" /> : null}
        <input
          ref={inputRef}
          className="sf-legacy__file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void pick(event)}
        />
        <Button icon={ImagePlus} loading={uploading} onClick={() => inputRef.current?.click()}>
          {preview ? lt('drivers.form.replacePhoto') : lt('drivers.form.attachPhoto')}
        </Button>
      </div>
    </Field>
  );
}

/** Add driver (W43): name, mobile number and licence; photo, email and CNIC behind "+ Add …". */
function AddDriverDrawer({ onClose }: { onClose: () => void }) {
  const lt = useLegacyT();
  const { t } = useTranslation(['errors', 'validation']);
  const qc = useQueryClient();
  const toast = useToast();
  const formId = 'sf-add-driver';
  const form = useZodForm(addDriverSchema, { name: '', phone: '', licenceNo: '', email: '', cnic: '', profilePictureUrl: '' });
  const values = form.values;

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<DriverRow>('/drivers', body).then((r) => r.data),
    onSuccess: (created) => {
      toast.success(lt('drivers.addToast', { name: created.user?.name ?? String(values.name ?? '') }));
      if (created.id) flashRow('drivers', created.id);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (error) => form.setServerError(error, { USER_PHONE_IN_USE: 'phone', USER_CNIC_IN_USE: 'cnic', CONFLICT_DUPLICATE: 'licenceNo' }),
  });

  const submit = form.handleSubmit((body) => {
    if (create.isPending) return;
    create.mutate({
      ...body,
      email: body.email || undefined,
      cnic: body.cnic || undefined,
      profilePictureUrl: body.profilePictureUrl || undefined,
    });
  });

  const required = (name: string, value: unknown, text: string, otherwise?: string) => {
    const error = form.errorFor(name);
    if (!error) return undefined;
    return typeof value === 'string' && value.trim() !== '' ? (otherwise ?? error) : text;
  };

  return (
    <Drawer
      title={lt('drivers.add')}
      dirty={form.isDirty && !create.isSuccess}
      dismissible={!create.isPending}
      onClose={onClose}
      footer={{
        end: (
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            {lt('drivers.add')}
          </Button>
        ),
      }}
    >
      <form id={formId} className="sf-legacy-form" onSubmit={submit} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field label={lt('drivers.form.name')} error={required('name', values.name, lt('drivers.form.nameMissing'))}>
          <TextInput
            name="name"
            value={values.name ?? ''}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.touch('name')}
          />
        </Field>
        <Field
          label={lt('drivers.form.phone')}
          error={required(
            'phone',
            values.phone,
            lt('drivers.form.phoneMissing'),
            normalizePkPhone(values.phone ?? '') === null ? t('errors:CLIENT_PHONE_INVALID') : undefined,
          )}
        >
          <PhoneInput
            name="phone"
            autoComplete="off"
            value={values.phone ?? ''}
            onChange={(value) => {
              if (value !== values.phone) form.setValue('phone', value);
            }}
            onBlur={() => form.touch('phone')}
          />
        </Field>
        <Field label={lt('drivers.form.licence')} error={required('licenceNo', values.licenceNo, lt('drivers.form.licenceMissing'))}>
          <TextInput
            name="licenceNo"
            value={values.licenceNo ?? ''}
            onChange={(event) => form.setValue('licenceNo', event.target.value)}
            onBlur={() => form.touch('licenceNo')}
          />
        </Field>
        <AddMore label={lt('drivers.form.addMore')}>
          <PhotoField url={(values.profilePictureUrl as string | undefined) ?? ''} onChange={(url) => form.setValue('profilePictureUrl', url)} />
          <Field label={lt('drivers.form.email')} error={form.errorFor('email')}>
            <TextInput
              name="email"
              type="email"
              value={(values.email as string | undefined) ?? ''}
              onChange={(event) => form.setValue('email', event.target.value)}
              onBlur={() => form.touch('email')}
            />
          </Field>
          <Field label={lt('drivers.form.cnic')} hint={lt('drivers.form.cnicHint')} error={form.errorFor('cnic')}>
            <TextInput
              name="cnic"
              inputMode="numeric"
              maxLength={15}
              value={(values.cnic as string | undefined) ?? ''}
              onChange={(event) => form.setValue('cnic', event.target.value)}
              onBlur={() => form.touch('cnic')}
            />
          </Field>
        </AddMore>
      </form>
    </Drawer>
  );
}

/** Edit driver (W43): name, email, licence and photo; the CNIC shows masked and can't change here. */
function EditDriverDrawer({ driver, onClose }: { driver: DriverRow; onClose: () => void }) {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const toast = useToast();
  const formId = 'sf-edit-driver';
  const [name, setName] = useState(driver.user.name);
  const [email, setEmail] = useState(driver.user.email ?? '');
  const [licenceNo, setLicenceNo] = useState(driver.licenceNo);
  const [photo, setPhoto] = useState(driver.user.profilePictureUrl ?? '');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    name !== driver.user.name || email !== (driver.user.email ?? '') || licenceNo !== driver.licenceNo || photo !== (driver.user.profilePictureUrl ?? '');

  const update = useMutation({
    mutationFn: () =>
      api
        .patch(`/drivers/${driver.id}/profile`, {
          name: name.trim(),
          email: email.trim() || null,
          licenceNo: licenceNo.trim(),
          profilePictureUrl: photo || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success(lt('drivers.editToast', { name: name.trim() }));
      flashRow('drivers', driver.id);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (e) => setError(messageFor(e)),
  });

  const save = () => {
    if (update.isPending) return;
    if (!name.trim() || !licenceNo.trim()) {
      setPressed(true);
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    setError(null);
    update.mutate();
  };

  return (
    <Drawer
      title={lt('drivers.editTitle', { name: driver.user.name })}
      subtitle={formatPhone(driver.user.phone)}
      dirty={dirty && !update.isSuccess}
      dismissible={!update.isPending}
      onClose={onClose}
      footer={{
        end: (
          <Button type="submit" form={formId} variant="primary" loading={update.isPending}>
            {lt('drivers.save')}
          </Button>
        ),
      }}
    >
      <form
        id={formId}
        className="sf-legacy-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
        <Field label={lt('drivers.form.name')} error={pressed && !name.trim() ? lt('drivers.form.nameMissing') : null}>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={lt('drivers.form.licence')} error={pressed && !licenceNo.trim() ? lt('drivers.form.licenceMissing') : null}>
          <TextInput value={licenceNo} onChange={(event) => setLicenceNo(event.target.value)} />
        </Field>
        <Field label={lt('drivers.form.email')} optional>
          <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <div className="sf-legacy-form__fact">
          <span className="sf-field__label">{lt('drivers.form.cnic')}</span>
          <span>{driver.cnicMasked ?? '—'}</span>
        </div>
        <PhotoField url={photo} onChange={setPhoto} />
      </form>
    </Drawer>
  );
}

/** Mark on leave: from a date, optionally until a date, with an optional reason. */
function LeaveDialog({ driver, onClose }: { driver: DriverRow; onClose: () => void }) {
  const lt = useLegacyT();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const [start, setStart] = useState(todayInKarachi());
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api
        .patch(`/drivers/${driver.id}/availability`, {
          availability: 'ON_LEAVE',
          leaveStart: start,
          leaveEnd: end || undefined,
          reason: reason.trim() || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success(lt('drivers.leave.toast', { name: driver.user.name }));
      flashRow('drivers', driver.id);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (e) => setError(messageFor(e)),
  });

  const confirm = () => {
    if (save.isPending) return;
    if (!start) {
      setPressed(true);
      return;
    }
    setError(null);
    save.mutate();
  };

  return (
    <Modal
      open
      size="sm"
      title={lt('drivers.leave.title', { name: driver.user.name })}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      dismissible={!save.isPending}
      initialFocusRef={goBackRef}
      footer={
        <>
          <Button ref={goBackRef} onClick={onClose} disabled={save.isPending}>
            {t('actions.goBack')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={confirm}>
            {lt('drivers.leave.confirm')}
          </Button>
        </>
      }
    >
      <div className="sf-legacy-form">
        <p className="sf-legacy__muted">{lt('drivers.leave.body')}</p>
        <div className="sf-legacy-form__row">
          <Field label={lt('drivers.leave.from')} error={pressed && !start ? lt('drivers.leave.fromMissing') : null}>
            <DateInput value={start} onChange={setStart} />
          </Field>
          <Field label={lt('drivers.leave.until')} optional>
            <DateInput value={end} min={start || undefined} onChange={setEnd} />
          </Field>
        </div>
        <Field label={t('dialog.why')} optional>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}

function RecenterOnChange({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], map.getZoom(), { duration: 0.6 });
  }, [lat, lng, map]);
  return null;
}

/** Track live: the driver's position on a small map, from the socket, else the last one saved. */
function TrackDriverModal({ driver, onClose }: { driver: DriverRow; onClose: () => void }) {
  const lt = useLegacyT();
  const { drivers: liveDrivers } = useDriversSocket();
  const detail = useQuery({
    queryKey: ['driver-detail', driver.id],
    queryFn: async () => (await api.get<DriverRow>(`/drivers/${driver.id}`)).data,
  });

  const live = liveDrivers[driver.id];
  const saved = detail.data?.currentLocation ?? null;
  const point = live
    ? { lat: live.lat, lng: live.lng, at: live.at as string | null }
    : saved
      ? { lat: saved.lat, lng: saved.lng, at: detail.data?.currentLocationUpdatedAt ?? null }
      : null;

  return (
    <Modal open size="md" title={lt('drivers.track.title', { name: driver.user.name })} onClose={onClose}>
      <div className="sf-legacy-form">
        <div className="sf-legacy__chips">
          <StatusChip kind="presence" value={driver.isOnline ? 'ONLINE' : 'OFFLINE'} />
          <span className="sf-legacy__muted">
            {driver.currentVehicle ? lt('drivers.track.van', { plate: driver.currentVehicle.plateNo }) : lt('drivers.noVan')}
          </span>
        </div>
        {point ? (
          <>
            <div className="sf-legacy__track-map">
              <MapContainer center={[point.lat, point.lng]} zoom={15} className="sf-legacy__track-canvas">
                <TileLayer url={OSM_TILES} attribution={OSM_CREDIT} />
                <RecenterOnChange lat={point.lat} lng={point.lng} />
                <CircleMarker center={[point.lat, point.lng]} radius={10} pathOptions={{ className: 'sf-map__pin' }} />
              </MapContainer>
            </div>
            {point.at ? <p className="sf-legacy__muted">{lt('drivers.track.at', { when: formatDateTime(point.at) })}</p> : null}
          </>
        ) : (
          <EmptyState compact title={lt('drivers.track.none')} />
        )}
      </div>
    </Modal>
  );
}
