import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory, Pencil, Plus } from 'lucide-react';
import { haversineKm } from '@smartfleet/shared-utils';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { useAllAreas, type CityArea } from '../features/distributors/api';
import { StoreMapPicker } from '../features/distributors/LazyMaps';
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
 * Legacy refill stations screen, kept for Inc 1 (UX_ADMIN §2.11, §4.2). Light pass (website spec W46):
 * the list comes first, showing each station's area instead of its coordinates, with labelled "Edit" and
 * "Archive…"; "Add station" opens a drawer whose location is a pin on the store map (the latitude and
 * longitude boxes wait behind "Type coordinates"). There is no price field: refills carry no money
 * (ADR-16), and the API ignores a price.
 */

interface Station {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
  lat: number;
  lng: number;
}

const STATIONS_KEY = ['filling-stations', 'all'] as const;
/** A station farther than this from every reference area shows no area. */
const AREA_MAX_KM = 15;

/** The reference area nearest to a point ("DHA Phase 1 · Lahore"), or null. */
function nearestArea(point: { lat: number; lng: number }, areas: readonly CityArea[]): CityArea | null {
  let best: CityArea | null = null;
  let bestKm = AREA_MAX_KM;
  for (const area of areas) {
    const km = haversineKm(point, area);
    if (km < bestKm) {
      best = area;
      bestKm = km;
    }
  }
  return best;
}

export function FillingStationsScreen() {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const flashed = useFlashedRow('stations');
  const { areas } = useAllAreas();
  const query = useQuery({
    queryKey: STATIONS_KEY,
    queryFn: async () => (await api.get<Station[]>('/filling-stations', { params: { includeInactive: true } })).data,
  });
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);

  const all = query.data ?? [];
  const hasArchived = all.some((s) => !s.is_active);
  const rows = all.filter((s) => showArchived || s.is_active);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['filling-stations'] });

  async function archive(s: Station) {
    const { ok } = await confirm({
      title: lt('stations.archive.title', { name: s.name }),
      body: lt('stations.archive.body'),
      tone: 'danger',
      confirmLabel: lt('stations.archive.confirm', { name: s.name }),
      action: () => api.delete(`/filling-stations/${s.id}`),
    });
    if (!ok) return;
    toast.success(lt('stations.archive.toast', { name: s.name }));
    void invalidate();
  }

  const columns: TableColumn<Station>[] = [
    { id: 'name', header: lt('stations.columns.name'), sticky: true, cell: (s) => <span className="sf-legacy__strong">{s.name}</span> },
    { id: 'address', header: lt('stations.columns.address'), priority: 2, cell: (s) => <span className="sf-legacy__muted">{s.address}</span> },
    {
      id: 'area',
      header: lt('stations.columns.area'),
      cell: (s) => {
        const area = nearestArea(s, areas);
        return area ? lt('stations.areaValue', { area: area.name, city: area.city }) : <span className="sf-legacy__muted">—</span>;
      },
    },
    {
      id: 'status',
      header: lt('stations.columns.status'),
      cell: (s) => (s.is_active ? <Chip tone="success">{lt('stations.active')}</Chip> : <Chip tone="neutral">{lt('stations.archived')}</Chip>),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{lt('stations.columns.actions')}</span>,
      align: 'end',
      cell: (s) => (
        <span className="sf-legacy__actions">
          <Button size="sm" icon={Pencil} onClick={() => setEditing(s)}>
            {lt('stations.edit')}
          </Button>
          {s.is_active ? (
            <Button size="sm" variant="ghost-danger" onClick={() => void archive(s)}>
              {lt('stations.archive.button')}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="sf-legacy-page">
      <PageHeader
        title={lt('stations.title')}
        primaryAction={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {lt('stations.add')}
          </Button>
        }
      />
      {hasArchived ? (
        <FilterBar>
          <ToggleChip label={lt('stations.showArchived')} pressed={showArchived} onChange={setShowArchived} />
        </FilterBar>
      ) : null}
      <Table<Station>
        caption={lt('stations.title')}
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        rowTone={(s) => (s.is_active ? null : 'neutral')}
        highlightKey={flashed}
        state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
        empty={
          <EmptyState
            compact
            icon={Factory}
            title={lt('stations.empty')}
            action={
              <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                {lt('stations.add')}
              </Button>
            }
          />
        }
        error={
          <ErrorState compact error={query.error} title={lt('stations.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        }
      />
      {adding ? <StationDrawer onClose={() => setAdding(false)} onSaved={() => void invalidate()} /> : null}
      {editing ? <StationDrawer station={editing} onClose={() => setEditing(null)} onSaved={() => void invalidate()} /> : null}
    </div>
  );
}

function coordinate(text: string, limit: number): number | null {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/** Add station, or Edit station: name, address and the pin (the coordinates behind "Type coordinates"). */
function StationDrawer({ station, onClose, onSaved }: { station?: Station; onClose: () => void; onSaved: () => void }) {
  const lt = useLegacyT();
  const toast = useToast();
  const formId = station ? 'sf-edit-station' : 'sf-add-station';
  const [name, setName] = useState(station?.name ?? '');
  const [address, setAddress] = useState(station?.address ?? '');
  const [lat, setLat] = useState(station ? String(station.lat) : '');
  const [lng, setLng] = useState(station ? String(station.lng) : '');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const point = useMemo(() => {
    const a = coordinate(lat, 90);
    const b = coordinate(lng, 180);
    return a === null || b === null ? null : { lat: a, lng: b };
  }, [lat, lng]);
  const nameError = !name.trim() ? lt('stations.form.nameMissing') : null;
  const addressError = !address.trim() ? lt('stations.form.addressMissing') : null;
  const pinError = !point ? lt('stations.form.pinMissing') : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), address: address.trim(), lat: point?.lat, lng: point?.lng };
      if (station) {
        await api.patch(`/filling-stations/${station.id}`, body);
        return station.id;
      }
      return (await api.post<{ id?: string }>('/filling-stations', body)).data?.id ?? null;
    },
    onSuccess: (id) => {
      toast.success(station ? lt('stations.savedToast', { name: name.trim() }) : lt('stations.addedToast', { name: name.trim() }));
      if (id) flashRow('stations', id);
      onSaved();
      onClose();
    },
    onError: (e) => setError(messageFor(e)),
  });

  const submit = () => {
    if (save.isPending) return;
    if (nameError || addressError || pinError) {
      setPressed(true);
      return;
    }
    setError(null);
    save.mutate();
  };

  const dirty = station
    ? name !== station.name || address !== station.address || lat !== String(station.lat) || lng !== String(station.lng)
    : Boolean(name || address || lat || lng);

  return (
    <Drawer
      title={station ? lt('stations.editTitle', { name: station.name }) : lt('stations.add')}
      width="lg"
      dirty={dirty && !save.isSuccess}
      dismissible={!save.isPending}
      onClose={onClose}
      footer={{
        end: (
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {station ? lt('stations.save') : lt('stations.add')}
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
        <div className="sf-legacy-form__row">
          <Field label={lt('stations.form.name')} error={pressed ? nameError : null}>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={lt('stations.form.address')} error={pressed ? addressError : null}>
            <TextInput value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
        </div>
        <div className="sf-legacy-form__map">
          <p className="sf-field__label">{lt('stations.form.location')}</p>
          <p className="sf-field__hint">{lt('stations.form.mapHint')}</p>
          <StoreMapPicker
            value={point}
            onChange={(pin) => {
              setLat(pin.lat.toFixed(6));
              setLng(pin.lng.toFixed(6));
            }}
            zone={{ status: 'none' }}
            error={pressed ? pinError : null}
            showStores={false}
            disabled={save.isPending}
          />
        </div>
        <AddMore label={lt('stations.form.typeCoordinates')}>
          <div className="sf-legacy-form__row">
            <Field label={lt('stations.form.lat')}>
              <TextInput inputMode="decimal" value={lat} onChange={(event) => setLat(event.target.value)} />
            </Field>
            <Field label={lt('stations.form.lng')}>
              <TextInput inputMode="decimal" value={lng} onChange={(event) => setLng(event.target.value)} />
            </Field>
          </div>
        </AddMore>
      </form>
    </Drawer>
  );
}
