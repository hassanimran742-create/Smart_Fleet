import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

interface City { id: string; name: string }
interface Area { name: string; lat: number; lng: number }
interface Zone { id: string; city_id: string; name: string }
interface StoreRow {
  id: string; name: string; zone_id: string; address: string;
  lat: number; lng: number; is_active: boolean;
}

export function StoresScreen() {
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<StoreRow[]>('/stores')).data });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const [showArchived, setShowArchived] = useState(false);

  const [cityId, setCityId] = useState<string>('');
  const [areaName, setAreaName] = useState<string>('');
  const [form, setForm] = useState({ name: '', zoneId: '', address: '', lat: '', lng: '' });
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<StoreRow | null>(null);
  const [editCityId, setEditCityId] = useState<string>('');
  const [editForm, setEditForm] = useState<any>({});
  const [editErr, setEditErr] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ['areas', cityId],
    queryFn: async () => cityId ? (await api.get<Area[]>(`/cities/${cityId}/areas`)).data : [],
    enabled: !!cityId,
  });

  const editAreas = useQuery({
    queryKey: ['areas', editCityId],
    queryFn: async () => editCityId ? (await api.get<Area[]>(`/cities/${editCityId}/areas`)).data : [],
    enabled: !!editCityId,
  });

  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => cityId ? (await api.get<Zone[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  const editZones = useQuery({
    queryKey: ['zones', editCityId],
    queryFn: async () => editCityId ? (await api.get<Zone[]>(`/zones/city/${editCityId}`)).data : [],
    enabled: !!editCityId,
  });

  function onPickArea(name: string) {
    setAreaName(name);
    const a = (areas.data ?? []).find((x) => x.name === name);
    if (a) setForm((f) => ({ ...f, lat: String(a.lat), lng: String(a.lng), address: f.address || a.name }));
  }
  function onEditPickArea(name: string) {
    const a = (editAreas.data ?? []).find((x) => x.name === name);
    if (a) setEditForm((f: any) => ({ ...f, lat: String(a.lat), lng: String(a.lng) }));
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.name || !form.zoneId || !form.lat || !form.lng) throw new Error('Name, zone, lat, lng are required');
      return api.post('/stores', { ...form, lat: Number(form.lat), lng: Number(form.lng) }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      setForm({ name: '', zoneId: '', address: '', lat: '', lng: '' });
      setAreaName('');
      setErr(null);
    },
    onError: (e: any) => setErr(e?.message ?? 'Failed'),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/stores/${editing!.id}`, {
        name: editForm.name,
        address: editForm.address,
        zoneId: editForm.zoneId,
        lat: editForm.lat ? Number(editForm.lat) : undefined,
        lng: editForm.lng ? Number(editForm.lng) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      setEditing(null);
    },
    onError: (e: any) => setEditErr(e?.message ?? 'Failed'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/stores/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/stores/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  });

  const rows = (stores.data ?? []).filter((s) => showArchived || s.is_active);

  function openEdit(s: StoreRow) {
    setEditing(s);
    setEditForm({ name: s.name, address: s.address, zoneId: s.zone_id, lat: String(s.lat), lng: String(s.lng) });
    // Figure out which city this zone belongs to (cheaper: leave empty so user picks)
    setEditCityId('');
    setEditErr(null);
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Stores</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
      </div>

      <div className="card">
        <h3>Add store</h3>
        <div className="flex" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>City *</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setAreaName(''); setForm((f) => ({ ...f, zoneId: '' })); }}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Area / sector</label>
            <select value={areaName} onChange={(e) => onPickArea(e.target.value)} disabled={!cityId}>
              <option value="">— pick an area —</option>
              {(areas.data ?? []).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Zone *</label>
            <select value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value })} disabled={!cityId}>
              <option value="">— pick a zone —</option>
              {(zones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
        </div>

        <label>Store name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Address</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={areaName} />
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}><label>Latitude *</label><input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Longitude *</label><input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></div>
        </div>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create store</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Zone</th><th>Address</th><th>Lat / Lng</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.5 }}>
                <td>{s.name}</td>
                <td>{s.zone_id?.slice(0, 8) ?? '—'}</td>
                <td>{s.address}</td>
                <td>{s.lat?.toFixed(4)}, {s.lng?.toFixed(4)}</td>
                <td>{s.is_active ? '✓' : '—'}</td>
                <td>
                  <button onClick={() => openEdit(s)}>Edit</button>{' '}
                  {s.is_active ? (
                    <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog(`Archive store "${s.name}"?`)) archive.mutate(s.id); }}>Archive</button>
                  ) : (
                    <button onClick={() => reactivate.mutate(s.id)}>Reactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit store" open={!!editing} onClose={() => setEditing(null)} width={640}>
        {editing && (
          <>
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>City (to filter zones/areas)</label>
                <select value={editCityId} onChange={(e) => setEditCityId(e.target.value)}>
                  <option value="">— pick a city —</option>
                  {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Area (auto-fill lat/lng)</label>
                <select onChange={(e) => onEditPickArea(e.target.value)} disabled={!editCityId}>
                  <option value="">— pick an area —</option>
                  {(editAreas.data ?? []).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Zone</label>
                <select value={editForm.zoneId ?? ''} onChange={(e) => setEditForm({ ...editForm, zoneId: e.target.value })} disabled={!editCityId}>
                  <option value="">— keep current —</option>
                  {(editZones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            </div>
            <label>Name</label>
            <input value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label>Address</label>
            <input value={editForm.address ?? ''} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}><label>Latitude</label><input value={editForm.lat ?? ''} onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Longitude</label><input value={editForm.lng ?? ''} onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })} /></div>
            </div>
            {editErr && <p style={{ color: 'var(--danger)' }}>{editErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Cancel</button>{' '}
              <button className="primary" onClick={() => update.mutate()}>Save</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
