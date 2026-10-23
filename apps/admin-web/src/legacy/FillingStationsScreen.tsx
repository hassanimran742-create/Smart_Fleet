import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil } from 'lucide-react';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Modal } from '../components/Modal';
import { Chip, IconButton, useConfirm, useToast } from '../ui';
import './legacy.css';

/**
 * Legacy refill stations screen, kept for Inc 1 (UX_ADMIN §2.11, §4.2): name, address, location and
 * active. There is no price field: refills carry no money (ADR-16), and the API ignores a price.
 * Touched for §2.11: ConfirmDialog instead of browser pop-ups and labelled icons instead of emoji.
 */

interface Station {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
  lat: number;
  lng: number;
}

interface City {
  id: string;
  name: string;
}
interface Area {
  name: string;
  lat: number;
  lng: number;
}

interface StationForm {
  name: string;
  address: string;
  lat: string;
  lng: string;
}

const EMPTY_FORM: StationForm = { name: '', address: '', lat: '', lng: '' };

function coordinates(form: StationForm): { lat: number; lng: number } | null {
  const lat = Number(form.lat);
  const lng = Number(form.lng);
  if (!form.lat.trim() || !form.lng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function FillingStationsScreen() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useQuery({
    queryKey: ['filling-stations', showArchived],
    queryFn: async () => (await api.get<Station[]>(`/filling-stations${showArchived ? '?includeInactive=true' : ''}`)).data,
  });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });

  const [cityName, setCityName] = useState('');
  const [areaName, setAreaName] = useState('');
  const areas = useQuery({
    queryKey: ['areas', cityName],
    queryFn: async () => (cityName ? (await api.get<Area[]>(`/cities/${encodeURIComponent(cityName)}/areas`)).data : []),
    enabled: !!cityName,
  });

  const [form, setForm] = useState<StationForm>(EMPTY_FORM);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Station | null>(null);
  const [editForm, setEditForm] = useState<StationForm>(EMPTY_FORM);
  const [editErr, setEditErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['filling-stations'] });

  function pickArea(name: string) {
    setAreaName(name);
    const a = (areas.data ?? []).find((x) => x.name === name);
    if (a) {
      setForm((f) => ({
        ...f,
        lat: String(a.lat),
        lng: String(a.lng),
        address: f.address || `${a.name}, ${cityName}`,
      }));
    }
  }

  const create = useMutation({
    mutationFn: () => {
      const point = coordinates(form);
      if (!form.name.trim() || !form.address.trim() || !point) throw new Error('Name, address, latitude and longitude are required.');
      return api.post('/filling-stations', { name: form.name, address: form.address, lat: point.lat, lng: point.lng });
    },
    onSuccess: () => {
      void invalidate();
      toast.success(`${form.name.trim()} added.`);
      setForm(EMPTY_FORM);
      setCityName('');
      setAreaName('');
      setCreateErr(null);
    },
    onError: (e: unknown) => setCreateErr(e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e)),
  });

  const update = useMutation({
    mutationFn: () => {
      const point = coordinates(editForm);
      return api.patch(`/filling-stations/${editing!.id}`, {
        name: editForm.name,
        address: editForm.address,
        ...(point ? { lat: point.lat, lng: point.lng } : {}),
      });
    },
    onSuccess: () => {
      void invalidate();
      toast.success('Station saved.');
      setEditing(null);
      setEditErr(null);
    },
    onError: (e) => setEditErr(messageFor(e)),
  });

  async function archiveStation(s: Station) {
    const { ok } = await confirm({
      title: `Archive ${s.name}?`,
      body: "Distributors can't ask for refills at this station any more. Refills already on their way carry on.",
      tone: 'danger',
      confirmLabel: `Archive ${s.name}`,
      action: () => api.delete(`/filling-stations/${s.id}`),
    });
    if (!ok) return;
    toast.success(`${s.name} archived.`);
    void invalidate();
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Refill stations</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      <p className="muted">Pick a city and an area to fill in the location, or type the latitude and longitude.</p>

      <div className="card">
        <h3>Add refill station</h3>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="station-city">City</label>
            <select
              id="station-city"
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
            <label htmlFor="station-area">Area (fills in the location)</label>
            <select id="station-area" value={areaName} onChange={(e) => pickArea(e.target.value)} disabled={!cityName}>
              <option value="">Pick an area</option>
              {(areas.data ?? []).map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label>Name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="For example Lahore Filling Station" />
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

        {createErr && <p style={{ color: 'var(--danger-fg)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add station'}
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>Location</th>
              <th>Status</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.6 }}>
                <td>{s.name}</td>
                <td className="muted">{s.address}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {s.lat?.toFixed(4)}, {s.lng?.toFixed(4)}
                </td>
                <td>{s.is_active ? <Chip tone="success">Taking refills</Chip> : <Chip tone="neutral">Archived</Chip>}</td>
                <td>
                  <div className="sf-legacy-actions">
                    <IconButton
                      icon={Pencil}
                      label={`Edit ${s.name}`}
                      onClick={() => {
                        setEditing(s);
                        setEditErr(null);
                        setEditForm({ name: s.name, address: s.address, lat: String(s.lat), lng: String(s.lng) });
                      }}
                    />
                    {s.is_active && (
                      <IconButton icon={Archive} variant="ghost-danger" label={`Archive ${s.name}`} onClick={() => void archiveStation(s)} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No refill stations yet. Add the first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal title="Edit refill station" open={!!editing} onClose={() => setEditing(null)} width={560}>
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
            {editErr && <p style={{ color: 'var(--danger-fg)' }}>{editErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Go back</button>{' '}
              <button className="primary" onClick={() => update.mutate()} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save station'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
