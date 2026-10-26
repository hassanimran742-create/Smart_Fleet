import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, Pencil, Plus } from 'lucide-react';
import type { ZoneListRow } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { useAllAreas, useCities } from '../features/distributors/api';
import { DEFAULT_MAP_CENTER, FitToZones, OSM_CREDIT, OSM_TILES, ZoneLayer, zonesBounds } from '../features/distributors/StoreMapPicker';
import {
  AddMore,
  Button,
  Chip,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  flashRow,
  InlineAlert,
  PageHeader,
  SearchSelect,
  Select,
  Table,
  TextInput,
  ToggleChip,
  useConfirm,
  useFlashedRow,
  useToast,
  type TableColumn,
} from '../ui';
import { useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy Zones screen, kept inside the shell for Inc 1 (UX_ADMIN §2.11; zones are normally loaded by the
 * tech team). Light pass (website spec W45): the zones are listed (name, city, status), with a map of
 * their outlines; "Add zone" opens a drawer with the city, the name and the areas it covers, picked from
 * one search box. The square size around each area waits behind "Advanced", in km. The API is
 * unchanged: the shape is still the union of a box around each picked area.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The box half-side the shape builder has always used: 0.012° (about 1.3 km). */
const DEFAULT_HALF_DEG = 0.012;
const DEFAULT_KM = '1.3';
/** 0.01° of latitude is about 1.1 km. */
const KM_PER_DEG = 110;
const ZONES_KEY = ['zones', 'all-cities'] as const;

type ZoneRow = ZoneListRow & { cityName: string };

function multiBoxAround(areas: { lat: number; lng: number }[], half: number): GeoJSON.MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: areas.map((a) => [
      [
        [a.lng - half, a.lat - half],
        [a.lng + half, a.lat - half],
        [a.lng + half, a.lat + half],
        [a.lng - half, a.lat + half],
        [a.lng - half, a.lat - half],
      ],
    ]),
  };
}

/** The half-side in degrees for a size typed in km; the old default when it wasn't changed. */
function halfDegOf(km: string): number {
  if (km.trim() === DEFAULT_KM) return DEFAULT_HALF_DEG;
  const value = Number(km);
  return Number.isFinite(value) && value > 0 ? value / KM_PER_DEG : DEFAULT_HALF_DEG;
}

/** Every zone of every saved city, archived ones included (the office may see them). */
function useAllZones() {
  const cities = useCities();
  const saved = (cities.data ?? []).filter((city) => UUID.test(city.id));
  return useQuery({
    queryKey: [...ZONES_KEY, saved.map((city) => city.id)],
    queryFn: async () => {
      const lists = await Promise.all(
        saved.map(async (city) =>
          (await api.get<ZoneListRow[]>(`/zones/city/${city.id}`, { params: { includeArchived: true } })).data.map((zone) => ({
            ...zone,
            cityName: city.name,
          })),
        ),
      );
      return lists.flat().sort((a, b) => a.cityName.localeCompare(b.cityName) || a.name.localeCompare(b.name));
    },
    enabled: cities.isSuccess,
  });
}

export function ZonesScreen() {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const flashed = useFlashedRow('zones');
  const zones = useAllZones();
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ZoneRow | null>(null);

  const all = zones.data ?? [];
  const hasArchived = all.some((zone) => !zone.is_active);
  const rows = all.filter((zone) => showArchived || zone.is_active);
  const active = useMemo(() => (zones.data ?? []).filter((zone) => zone.is_active), [zones.data]);
  const bounds = useMemo(() => zonesBounds(active), [active]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['zones'] });
  };

  async function archive(zone: ZoneRow) {
    const { ok } = await confirm({
      title: lt('zones.archive.title', { name: zone.name }),
      body: lt('zones.archive.body'),
      tone: 'danger',
      confirmLabel: lt('zones.archive.confirm', { name: zone.name }),
      action: () => api.delete(`/zones/${zone.id}`),
    });
    if (!ok) return;
    toast.success(lt('zones.archive.toast', { name: zone.name }));
    invalidate();
  }

  const reactivate = useMutation({
    mutationFn: (zone: ZoneRow) => api.patch(`/zones/${zone.id}/reactivate`).then(() => zone),
    onSuccess: (zone) => {
      toast.success(lt('zones.reactivateToast', { name: zone.name }));
      flashRow('zones', zone.id);
      invalidate();
    },
    onError: (e) => toast.error(e),
  });

  const columns: TableColumn<ZoneRow>[] = [
    { id: 'name', header: lt('zones.columns.zone'), sticky: true, cell: (zone) => <span className="sf-legacy__strong">{zone.name}</span> },
    { id: 'city', header: lt('zones.columns.city'), cell: (zone) => zone.cityName },
    {
      id: 'status',
      header: lt('zones.columns.status'),
      cell: (zone) => (zone.is_active ? <Chip tone="success">{lt('zones.active')}</Chip> : <Chip tone="neutral">{lt('zones.archived')}</Chip>),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{lt('zones.columns.actions')}</span>,
      align: 'end',
      cell: (zone) => (
        <span className="sf-legacy__actions">
          <Button size="sm" icon={Pencil} onClick={() => setEditing(zone)}>
            {lt('zones.edit')}
          </Button>
          {zone.is_active ? (
            <Button size="sm" variant="ghost-danger" onClick={() => void archive(zone)}>
              {lt('zones.archive.button')}
            </Button>
          ) : (
            <Button size="sm" loading={reactivate.isPending && reactivate.variables?.id === zone.id} onClick={() => reactivate.mutate(zone)}>
              {lt('zones.reactivate')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="sf-legacy-page">
      <PageHeader
        title={lt('zones.title')}
        primaryAction={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {lt('zones.add')}
          </Button>
        }
      />
      {hasArchived ? (
        <FilterBar>
          <ToggleChip label={lt('zones.showArchived')} pressed={showArchived} onChange={setShowArchived} />
        </FilterBar>
      ) : null}
      <Table<ZoneRow>
        caption={lt('zones.title')}
        columns={columns}
        rows={rows}
        rowKey={(zone) => zone.id}
        rowTone={(zone) => (zone.is_active ? null : 'neutral')}
        highlightKey={flashed}
        state={zones.isPending ? 'loading' : zones.isError && !zones.data ? 'error' : 'ready'}
        empty={<EmptyState compact icon={MapIcon} title={lt('zones.empty')} />}
        error={
          <ErrorState compact error={zones.error} title={lt('zones.loadFailed')} onRetry={() => void zones.refetch()} retrying={zones.isFetching} />
        }
      />
      {active.length > 0 ? (
        <div className="sf-legacy__map" role="img" aria-label={lt('zones.mapLabel')}>
          <MapContainer center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]} zoom={11} className="sf-legacy__map-canvas">
            <TileLayer url={OSM_TILES} attribution={OSM_CREDIT} />
            <ZoneLayer zones={active} />
            <FitToZones bounds={bounds} enabled />
          </MapContainer>
        </div>
      ) : null}
      {adding ? <ZoneDrawer onClose={() => setAdding(false)} onSaved={invalidate} /> : null}
      {editing ? <ZoneDrawer zone={editing} onClose={() => setEditing(null)} onSaved={invalidate} /> : null}
    </div>
  );
}

/** Add zone, or Edit zone (a new name, or new areas to redraw it; no areas keeps its shape). */
function ZoneDrawer({ zone, onClose, onSaved }: { zone?: ZoneRow; onClose: () => void; onSaved: () => void }) {
  const lt = useLegacyT();
  const toast = useToast();
  const cities = useCities();
  const { areas, loading: areasLoading } = useAllAreas();
  const formId = zone ? 'sf-edit-zone' : 'sf-add-zone';
  const [cityId, setCityId] = useState(zone?.city_id ?? '');
  const [name, setName] = useState(zone?.name ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [km, setKm] = useState(DEFAULT_KM);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = (cities.data ?? []).filter((city) => UUID.test(city.id));
  const options = useMemo(
    () => areas.map((area) => ({ value: `${area.city}|${area.name}`, label: lt('zones.form.areaOption', { area: area.name, city: area.city }) })),
    [areas, lt],
  );
  const pickedAreas = areas.filter((area) => picked.includes(`${area.city}|${area.name}`));

  const cityError = !zone && !cityId ? lt('zones.form.cityMissing') : null;
  const nameError = !name.trim() ? lt('zones.form.nameMissing') : null;
  const areasError = !zone && picked.length === 0 ? lt('zones.form.areasMissing') : null;

  const save = useMutation({
    mutationFn: async () => {
      const polygon = pickedAreas.length > 0 ? multiBoxAround(pickedAreas, halfDegOf(km)) : undefined;
      if (zone) {
        await api.patch(`/zones/${zone.id}`, { name: name.trim(), ...(polygon ? { polygonGeoJson: polygon } : {}) });
        return zone.id;
      }
      const created = (await api.post<{ id: string }>('/zones', { cityId, name: name.trim(), polygonGeoJson: polygon })).data;
      return created.id;
    },
    onSuccess: (id) => {
      toast.success(zone ? lt('zones.savedToast', { name: name.trim() }) : lt('zones.addedToast', { name: name.trim() }));
      if (id) flashRow('zones', id);
      onSaved();
      onClose();
    },
    onError: (e) => setError(messageFor(e)),
  });

  const submit = () => {
    if (save.isPending) return;
    if (cityError || nameError || areasError) {
      setPressed(true);
      return;
    }
    setError(null);
    save.mutate();
  };

  const dirty = zone ? name !== zone.name || picked.length > 0 : Boolean(cityId || name || picked.length);

  return (
    <Drawer
      title={zone ? lt('zones.editTitle', { name: zone.name }) : lt('zones.add')}
      subtitle={zone ? zone.cityName : undefined}
      dirty={dirty && !save.isSuccess}
      dismissible={!save.isPending}
      onClose={onClose}
      footer={{
        end: (
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {zone ? lt('zones.save') : lt('zones.add')}
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
        {zone ? null : (
          <Field label={lt('zones.form.city')} error={pressed ? cityError : null}>
            <Select
              value={cityId}
              placeholder={lt('zones.form.pickCity')}
              options={saved.map((city) => ({ value: city.id, label: city.name }))}
              onChange={(event) => setCityId(event.target.value)}
            />
          </Field>
        )}
        <Field label={lt('zones.form.name')} error={pressed ? nameError : null}>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field
          label={lt('zones.form.areas')}
          hint={zone ? lt('zones.form.redrawHint') : undefined}
          error={pressed ? areasError : null}
        >
          <SearchSelect
            multiple
            options={options}
            value={picked}
            onChange={setPicked}
            placeholder={lt('zones.form.findArea')}
            loading={areasLoading}
          />
        </Field>
        <AddMore label={lt('zones.form.advanced')}>
          <Field label={lt('zones.form.size')}>
            <TextInput type="number" min={0.1} step={0.1} inputMode="decimal" value={km} onChange={(event) => setKm(event.target.value)} />
          </Field>
        </AddMore>
      </form>
    </Drawer>
  );
}
