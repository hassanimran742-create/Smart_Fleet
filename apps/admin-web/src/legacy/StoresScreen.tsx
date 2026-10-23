import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { DistributorDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Modal } from '../components/Modal';
import { Chip, useConfirm, useToast } from '../ui';

/**
 * Legacy Stores screen: out of the navigation (UX_ADMIN §1.3, each store lives under its distributor)
 * and reachable only at `/stores`. Each distributor has exactly one store, edited from the distributor's
 * page (ADR-01). Touched for §2.11 and the Inc 1 API: the zone comes from the pin on the server (no zone
 * picker), the zone and owner show as names instead of id fragments, ConfirmDialog instead of browser
 * pop-ups, and every failure shown.
 */

interface City { id: string; name: string }
interface Area { name: string; lat: number; lng: number }
interface StoreRow {
  id: string;
  name: string;
  zone_id: string;
  address: string;
  lat: number;
  lng: number;
  is_active: boolean;
}

interface StoreForm {
  name: string;
  address: string;
  lat: string;
  lng: string;
}

const EMPTY: StoreForm = { name: '', address: '', lat: '', lng: '' };

function pointOf(form: StoreForm): { lat: number; lng: number } | null {
  const lat = Number(form.lat);
  const lng = Number(form.lng);
  if (!form.lat.trim() || !form.lng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function formError(e: unknown): string {
  return e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e);
}

export function StoresScreen() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<StoreRow[]>('/stores')).data });
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<DistributorDto[]>('/distributors')).data });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const [showArchived, setShowArchived] = useState(false);

  const [cityName, setCityName] = useState('');
  const [areaName, setAreaName] = useState('');
  const [form, setForm] = useState<StoreForm>(EMPTY);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<StoreRow | null>(null);
  const [editForm, setEditForm] = useState<StoreForm>(EMPTY);
  const [editErr, setEditErr] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ['areas', 'by-name', cityName],
    queryFn: async () => (cityName ? (await api.get<Area[]>(`/cities/${encodeURIComponent(cityName)}/areas`)).data : []),
    enabled: !!cityName,
  });

  /** The distributor (and its zone) of each store. */
  const owners = useMemo(() => {
    const map = new Map<string, DistributorDto>();
    for (const d of distributors.data ?? []) if (d.store) map.set(d.store.id, d);
    return map;
  }, [distributors.data]);

  function onPickArea(name: string) {
    setAreaName(name);
    const a = (areas.data ?? []).find((x) => x.name === name);
    if (a) setForm((f) => ({ ...f, lat: String(a.lat), lng: String(a.lng), address: f.address || `${a.name}, ${cityName}` }));
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['stores'] });

  const create = useMutation({
    mutationFn: () => {
      const point = pointOf(form);
      if (!form.name.trim() || !form.address.trim() || !point) throw new Error('Name, address, latitude and longitude are required.');
      return api.post('/stores', { name: form.name, address: form.address, lat: point.lat, lng: point.lng }).then((r) => r.data);
    },
    onSuccess: () => {
      void invalidate();
      toast.success('Store added.');
      setForm(EMPTY);
      setAreaName('');
      setErr(null);
    },
    onError: (e: unknown) => setErr(formError(e)),
  });

  const update = useMutation({
    mutationFn: () => {
      const point = pointOf(editForm);
      return api.patch(`/stores/${editing!.id}`, {
        name: editForm.name,
        address: editForm.address,
        ...(point ? { lat: point.lat, lng: point.lng } : {}),
      });
    },
    onSuccess: () => {
      void invalidate();
      void qc.invalidateQueries({ queryKey: ['distributors'] });
      toast.success('Store saved.');
      setEditing(null);
    },
    onError: (e: unknown) => setEditErr(formError(e)),
  });

  async function archiveStore(s: StoreRow) {
    const { ok } = await confirm({
      title: `Archive ${s.name}?`,
      body: "A distributor's own store can't be archived.",
      tone: 'danger',
      confirmLabel: `Archive ${s.name}`,
      action: () => api.delete(`/stores/${s.id}`),
    });
    if (!ok) return;
    toast.success(`${s.name} archived.`);
    void invalidate();
  }

  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/stores/${id}/reactivate`),
    onSuccess: () => {
      toast.success('Store reactivated.');
      void invalidate();
    },
    onError: (e) => toast.error(e),
  });

  const rows = (stores.data ?? []).filter((s) => showArchived || s.is_active);

  function openEdit(s: StoreRow) {
    setEditing(s);
    setEditForm({ name: s.name, address: s.address, lat: String(s.lat), lng: String(s.lng) });
    setEditErr(null);
  }

  return (
    <div className="legacy-old">
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Stores</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      <p className="muted">
        Each distributor has exactly one store, where its drivers load. Set it up and change it on the distributor's page in{' '}
        <Link to="/distributors">Distributors</Link>. The zone always comes from the store's location.
      </p>

      <div className="card">
        <h3>Add store</h3>
        <div className="flex" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="store-city">City</label>
            <select
              id="store-city"
              value={cityName}
              onChange={(e) => {
                setCityName(e.target.value);
                setAreaName('');
              }}
            >
              <option value="">Pick a city</option>
              {(cities.data ?? []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="store-area">Area (fills in the location)</label>
            <select id="store-area" value={areaName} onChange={(e) => onPickArea(e.target.value)} disabled={!cityName}>
              <option value="">Pick an area</option>
              {(areas.data ?? []).map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label>Store name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Address *</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Latitude *</label>
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} inputMode="decimal" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Longitude *</label>
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} inputMode="decimal" />
          </div>
        </div>
        {err && <p style={{ color: 'var(--danger-fg)' }}>{err}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add store'}
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Distributor</th>
              <th>Zone</th>
              <th>Address</th>
              <th>Location</th>
              <th>Status</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const owner = owners.get(s.id);
              return (
                <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.6 }}>
                  <td>{s.name}</td>
                  <td>
                    {owner ? (
                      <Link to="/distributors/$id" params={{ id: owner.id }}>
                        {owner.businessName}
                      </Link>
                    ) : (
                      <span className="muted">No distributor</span>
                    )}
                  </td>
                  <td>{owner?.store?.zone.name ?? '—'}</td>
                  <td>{s.address}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {s.lat?.toFixed(4)}, {s.lng?.toFixed(4)}
                  </td>
                  <td>{s.is_active ? <Chip tone="success">Active</Chip> : <Chip tone="neutral">Archived</Chip>}</td>
                  <td>
                    <button onClick={() => openEdit(s)}>Edit</button>{' '}
                    {s.is_active ? (
                      !owner && (
                        <button style={{ color: 'var(--danger-fg)' }} onClick={() => void archiveStore(s)}>
                          Archive
                        </button>
                      )
                    ) : (
                      <button onClick={() => reactivate.mutate(s.id)} disabled={reactivate.isPending}>
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {stores.isError && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>
                  <p style={{ color: 'var(--danger-fg)' }}>{messageFor(stores.error)}</p>
                  <button onClick={() => void stores.refetch()}>Try again</button>
                </td>
              </tr>
            )}
            {!stores.isPending && !stores.isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No stores yet. Add a distributor with its store in Distributors.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal title="Edit store" open={!!editing} onClose={() => setEditing(null)} width={560}>
        {editing && (
          <>
            <label>Name</label>
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label>Address</label>
            <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>Latitude</label>
                <input value={editForm.lat} onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })} inputMode="decimal" />
              </div>
              <div style={{ flex: 1 }}>
                <label>Longitude</label>
                <input value={editForm.lng} onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })} inputMode="decimal" />
              </div>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>The zone is worked out again from the location when you save.</p>
            {editErr && <p style={{ color: 'var(--danger-fg)' }}>{editErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Go back</button>{' '}
              <button className="primary" onClick={() => update.mutate()} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save store'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
