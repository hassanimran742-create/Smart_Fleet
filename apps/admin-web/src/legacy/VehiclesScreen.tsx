import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Truck } from 'lucide-react';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { formatPhone } from '../i18n/format';
import { translateDynamic } from '../i18n';
import {
  AddMore,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  flashRow,
  InlineAlert,
  PageHeader,
  Select,
  StatusChip,
  Table,
  Tabs,
  TextInput,
  ToggleChip,
  useConfirm,
  useFlashedRow,
  useToast,
  type TableColumn,
} from '../ui';
import { sizeLabelOf, useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy Vans screen, kept inside the shell for Inc 1 (UX_ADMIN §2.11). Light pass (website spec W44):
 * the tabs start with the van list; "Add van" and Edit open drawers; capacity is "cylinders of 11.8 kg"
 * with one helper line, and the size check ("+ Check what fits") sits in Edit, labelled by size. No raw
 * size codes, no "slots". Giving a van to a driver acts at once, with a toast.
 */

const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;
const PLATE_REGEX = /^[A-Z]{2,3}[- ]?\d{2,4}$/i;

interface City {
  id: string;
  name: string;
}
interface Zone {
  id: string;
  city_id: string;
  name: string;
}
interface CylinderType {
  id: string;
  code: string;
  name: string;
  capacityUnits: number;
  weightKg: string;
}
interface Van {
  id: string;
  plateNo: string;
  capacityUnits: number;
  status: string;
  homeZoneId: string;
  homeZone?: { name: string; cityId?: string } | null;
  currentDriver?: { user?: { name?: string } } | null;
}
interface DriverRow {
  id: string;
  currentVehicleId: string | null;
  availability: string;
  user: { name: string; phone: string; status: string };
}

const VANS_KEY = ['vehicles'] as const;
type Tab = 'vans' | 'give';

/** "In service", "In the workshop", "Retired" (the website's `status:vehicle` words). */
function statusWords(status: string): string {
  return translateDynamic(`status:vehicle.${status}`) ?? status;
}

export function VehiclesScreen() {
  const lt = useLegacyT();
  const [tab, setTab] = useState<Tab>('vans');
  const [adding, setAdding] = useState(false);

  return (
    <div className="sf-legacy-page">
      <PageHeader
        title={lt('vans.title')}
        primaryAction={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {lt('vans.add')}
          </Button>
        }
      />
      <Tabs<Tab>
        label={lt('vans.title')}
        items={[
          { id: 'vans', label: lt('vans.tabs.vans') },
          { id: 'give', label: lt('vans.tabs.give') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'vans' ? <VansTab onAdd={() => setAdding(true)} /> : <GiveTab />}
      {adding ? <VanDrawer onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function VansTab({ onAdd }: { onAdd: () => void }) {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const flashed = useFlashedRow('vans');
  const query = useQuery({ queryKey: VANS_KEY, queryFn: async () => (await api.get<Van[]>('/vehicles')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data });
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<Van | null>(null);

  const base = (types.data ?? []).find((type) => type.capacityUnits === 1 && Number(type.weightKg) > 10) ?? null;
  const baseSize = base ? sizeLabelOf(base) : lt('vans.baseSize');
  const all = query.data ?? [];
  const hasRetired = all.some((v) => v.status === 'RETIRED');
  const rows = all.filter((v) => showRetired || v.status !== 'RETIRED');

  async function retire(v: Van) {
    const { ok } = await confirm({
      title: lt('vans.retire.title', { plate: v.plateNo }),
      body: lt('vans.retire.body'),
      tone: 'danger',
      confirmLabel: lt('vans.retire.confirm', { plate: v.plateNo }),
      action: () => api.delete(`/vehicles/${v.id}`),
    });
    if (!ok) return;
    toast.success(lt('vans.retire.toast', { plate: v.plateNo }));
    void qc.invalidateQueries({ queryKey: VANS_KEY });
  }

  const columns: TableColumn<Van>[] = [
    { id: 'plate', header: lt('vans.columns.plate'), sticky: true, cell: (v) => <span className="sf-legacy__strong">{v.plateNo}</span> },
    {
      id: 'capacity',
      header: lt('vans.columns.capacity'),
      cell: (v) => <span className="sf-legacy__nowrap">{lt('vans.capacityValue', { count: v.capacityUnits, size: baseSize })}</span>,
    },
    { id: 'status', header: lt('vans.columns.status'), cell: (v) => <StatusChip kind="vehicle" value={v.status} /> },
    {
      id: 'driver',
      header: lt('vans.columns.driver'),
      priority: 2,
      cell: (v) => v.currentDriver?.user?.name ?? <span className="sf-legacy__muted">—</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">{lt('vans.columns.actions')}</span>,
      align: 'end',
      cell: (v) => (
        <span className="sf-legacy__actions">
          <Button size="sm" icon={Pencil} onClick={() => setEditing(v)}>
            {lt('vans.edit')}
          </Button>
          {v.status !== 'RETIRED' ? (
            <Button size="sm" variant="ghost-danger" onClick={() => void retire(v)}>
              {lt('vans.retire.button')}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      {hasRetired ? (
        <FilterBar>
          <ToggleChip label={lt('vans.showRetired')} pressed={showRetired} onChange={setShowRetired} />
        </FilterBar>
      ) : null}
      <Table<Van>
        caption={lt('vans.title')}
        columns={columns}
        rows={rows}
        rowKey={(v) => v.id}
        rowTone={(v) => (v.status === 'RETIRED' ? 'neutral' : null)}
        highlightKey={flashed}
        state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
        empty={
          <EmptyState
            compact
            icon={Truck}
            title={lt('vans.empty')}
            action={
              <Button variant="primary" icon={Plus} onClick={onAdd}>
                {lt('vans.add')}
              </Button>
            }
          />
        }
        error={
          <ErrorState
            compact
            error={query.error}
            title={lt('vans.loadFailed')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        }
      />
      {editing ? <VanDrawer van={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** How many cylinders of each size still fit, from what is on the van now (Edit's "+ Check what fits"). */
function WhatFits({ places, types }: { places: number; types: readonly CylinderType[] }) {
  const lt = useLegacyT();
  const [load, setLoad] = useState<Record<string, string>>({});
  const used = types.reduce((sum, type) => sum + Number(load[type.id] || 0) * type.capacityUnits, 0);
  const left = Math.max(0, places - used);
  return (
    <div className="sf-legacy-fits">
      <div className="sf-legacy-form__grid">
        {types.map((type) => (
          <Field key={type.id} label={lt('vans.fits.onVan', { size: sizeLabelOf(type) })}>
            <TextInput
              type="number"
              min={0}
              inputMode="numeric"
              value={load[type.id] ?? ''}
              onChange={(event) => setLoad((current) => ({ ...current, [type.id]: event.target.value }))}
            />
          </Field>
        ))}
      </div>
      <p className="sf-legacy__strong">
        {lt('vans.fits.room')}{' '}
        {types
          .map((type) => lt('vans.fits.count', { count: Math.floor(left / Math.max(type.capacityUnits, 1)), size: sizeLabelOf(type) }))
          .join(' · ')}
      </p>
    </div>
  );
}

/** Add van, or Edit van (with its status and the size check). */
function VanDrawer({ van, onClose }: { van?: Van; onClose: () => void }) {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const toast = useToast();
  const formId = van ? 'sf-edit-van' : 'sf-add-van';
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data });
  const [plate, setPlate] = useState(van?.plateNo ?? '');
  const [capacity, setCapacity] = useState(van ? String(van.capacityUnits) : '20');
  const [cityId, setCityId] = useState(van?.homeZone?.cityId ?? '');
  const [zoneId, setZoneId] = useState(van?.homeZoneId ?? '');
  const [status, setStatus] = useState(van?.status ?? 'ACTIVE');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => (cityId ? (await api.get<Zone[]>(`/zones/city/${cityId}`)).data : []),
    enabled: Boolean(cityId),
  });

  const places = Number(capacity);
  const plateError = !plate.trim() ? lt('vans.form.plateMissing') : !PLATE_REGEX.test(plate.trim()) ? lt('vans.form.plateFormat') : null;
  const capacityError = !Number.isInteger(places) || places <= 0 ? lt('vans.form.capacityMissing') : null;
  const cityError = !cityId ? lt('vans.form.cityMissing') : null;
  const zoneError = !zoneId ? lt('vans.form.zoneMissing') : null;
  const sortedTypes = useMemo(() => [...(types.data ?? [])].sort((a, b) => Number(a.weightKg) - Number(b.weightKg)), [types.data]);
  const base = sortedTypes.find((type) => type.capacityUnits === 1 && Number(type.weightKg) > 10) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const body = { plateNo: plate.trim().toUpperCase(), capacityUnits: places, homeZoneId: zoneId };
      if (!van) return (await api.post<Van>('/vehicles', body)).data;
      await api.patch(`/vehicles/${van.id}`, body);
      if (status !== van.status) await api.patch(`/vehicles/${van.id}/status`, { status });
      return van;
    },
    onSuccess: (saved) => {
      toast.success(van ? lt('vans.savedToast', { plate: plate.trim().toUpperCase() }) : lt('vans.addedToast', { plate: plate.trim().toUpperCase() }));
      if (saved?.id) flashRow('vans', saved.id);
      void qc.invalidateQueries({ queryKey: VANS_KEY });
      onClose();
    },
    onError: (e) => setError(messageFor(e)),
  });

  const submit = () => {
    if (save.isPending) return;
    if (plateError || capacityError || cityError || zoneError) {
      setPressed(true);
      return;
    }
    setError(null);
    save.mutate();
  };

  const dirty = van
    ? plate !== van.plateNo || capacity !== String(van.capacityUnits) || zoneId !== van.homeZoneId || status !== van.status
    : Boolean(plate || cityId || zoneId || capacity !== '20');

  return (
    <Drawer
      title={van ? lt('vans.editTitle', { plate: van.plateNo }) : lt('vans.add')}
      dirty={dirty && !save.isSuccess}
      dismissible={!save.isPending}
      onClose={onClose}
      footer={{
        end: (
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {van ? lt('vans.save') : lt('vans.add')}
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
          submit();
        }}
      >
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
        <Field label={lt('vans.form.plate')} error={pressed ? plateError : null}>
          <TextInput value={plate} autoCapitalize="characters" onChange={(event) => setPlate(event.target.value.toUpperCase())} />
        </Field>
        <Field label={lt('vans.form.capacity')} hint={lt('vans.form.capacityHint')} error={pressed ? capacityError : null}>
          <TextInput
            type="number"
            min={1}
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            endAdornment={lt('vans.form.capacityUnit', { size: base ? sizeLabelOf(base) : lt('vans.baseSize') })}
          />
        </Field>
        <div className="sf-legacy-form__row">
          <Field label={lt('vans.form.city')} error={pressed ? cityError : null}>
            <Select
              value={cityId}
              placeholder={lt('vans.form.pickCity')}
              options={(cities.data ?? []).map((city) => ({ value: city.id, label: city.name }))}
              onChange={(event) => {
                setCityId(event.target.value);
                setZoneId('');
              }}
            />
          </Field>
          <Field label={lt('vans.form.zone')} error={pressed ? zoneError : null}>
            <Select
              value={zoneId}
              placeholder={lt('vans.form.pickZone')}
              disabled={!cityId}
              options={(zones.data ?? []).map((zone) => ({ value: zone.id, label: zone.name }))}
              onChange={(event) => setZoneId(event.target.value)}
            />
          </Field>
        </div>
        {van ? (
          <>
            <Field label={lt('vans.columns.status')}>
              <Select
                value={status}
                options={VEHICLE_STATUSES.map((value) => ({ value, label: statusWords(value) }))}
                onChange={(event) => setStatus(event.target.value)}
              />
            </Field>
            <AddMore label={lt('vans.fits.open')}>
              <WhatFits places={Number.isFinite(places) ? places : 0} types={sortedTypes} />
            </AddMore>
          </>
        ) : null}
      </form>
    </Drawer>
  );
}

/** Give vans to drivers: one dropdown per van, acting at once (a driver has at most one van). */
function GiveTab() {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const toast = useToast();
  const vans = useQuery({ queryKey: VANS_KEY, queryFn: async () => (await api.get<Van[]>('/vehicles')).data });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get<DriverRow[]>('/drivers')).data });

  const give = useMutation({
    mutationFn: ({ driverId, vehicleId }: { driverId: string; vehicleId: string | null; message: string }) =>
      api.patch(`/drivers/${driverId}/vehicle`, { vehicleId }).then((r) => r.data),
    onSuccess: (_data, variables) => {
      toast.success(variables.message);
      void qc.invalidateQueries({ queryKey: ['drivers'] });
      void qc.invalidateQueries({ queryKey: VANS_KEY });
    },
    onError: (e) => {
      toast.error(e);
      void qc.invalidateQueries({ queryKey: ['drivers'] });
    },
  });

  const activeVans = (vans.data ?? []).filter((v) => v.status !== 'RETIRED');
  const activeDrivers = (drivers.data ?? []).filter((d) => d.user.status !== 'SUSPENDED' && d.availability !== 'ON_LEAVE');
  const driverForVan = useMemo(() => {
    const map: Record<string, DriverRow> = {};
    for (const d of drivers.data ?? []) if (d.currentVehicleId) map[d.currentVehicleId] = d;
    return map;
  }, [drivers.data]);

  const change = (van: Van, nextId: string) => {
    const current = driverForVan[van.id];
    if (!nextId) {
      if (current) give.mutate({ driverId: current.id, vehicleId: null, message: lt('vans.give.takenToast', { plate: van.plateNo, name: current.user.name }) });
      return;
    }
    const next = activeDrivers.find((d) => d.id === nextId);
    if (!next) return;
    if (current && current.id !== nextId) give.mutate({ driverId: current.id, vehicleId: null, message: lt('vans.give.takenToast', { plate: van.plateNo, name: current.user.name }) });
    give.mutate({ driverId: nextId, vehicleId: van.id, message: lt('vans.give.toast', { plate: van.plateNo, name: next.user.name }) });
  };

  const columns: TableColumn<Van>[] = [
    {
      id: 'van',
      header: lt('vans.columns.plate'),
      sticky: true,
      cell: (v) => (
        <span className="sf-legacy__two-line">
          <span className="sf-legacy__strong">{v.plateNo}</span>
          <span className="sf-legacy__muted">{v.homeZone?.name ?? ''}</span>
        </span>
      ),
    },
    {
      id: 'driver',
      header: lt('vans.columns.driver'),
      cell: (v) => {
        const d = driverForVan[v.id];
        return d ? (
          <span className="sf-legacy__two-line">
            <span>{d.user.name}</span>
            <span className="sf-legacy__muted sf-legacy__nowrap">{formatPhone(d.user.phone)}</span>
          </span>
        ) : (
          <span className="sf-legacy__muted">{lt('vans.give.none')}</span>
        );
      },
    },
    {
      id: 'give',
      header: lt('vans.give.column'),
      cell: (v) => (
        <Field label={lt('vans.give.label', { plate: v.plateNo })} labelHidden className="sf-legacy__inline-field">
          <Select
            value={driverForVan[v.id]?.id ?? ''}
            disabled={v.status !== 'ACTIVE' || give.isPending}
            onChange={(event) => change(v, event.target.value)}
            placeholder={lt('vans.give.none')}
            options={activeDrivers.map((d) => ({
              value: d.id,
              label: d.currentVehicleId && d.currentVehicleId !== v.id ? lt('vans.give.hasVan', { name: d.user.name }) : d.user.name,
              disabled: Boolean(d.currentVehicleId && d.currentVehicleId !== v.id),
            }))}
          />
        </Field>
      ),
    },
  ];

  return (
    <Table<Van>
      caption={lt('vans.tabs.give')}
      columns={columns}
      rows={activeVans}
      rowKey={(v) => v.id}
      state={vans.isPending ? 'loading' : vans.isError && !vans.data ? 'error' : 'ready'}
      empty={<EmptyState compact icon={Truck} title={lt('vans.give.empty')} />}
      error={<ErrorState compact error={vans.error} title={lt('vans.loadFailed')} onRetry={() => void vans.refetch()} retrying={vans.isFetching} />}
    />
  );
}
