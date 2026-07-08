import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

interface Station {
  id: string;
  name: string;
  address: string;
  price_per_cylinder_paisa: string;
  is_active: boolean;
  lat: number;
  lng: number;
}

interface City { id: string; name: string }
interface Area { name: string; lat: number; lng: number }

export function FillingStationsScreen() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useQuery({
    queryKey: ['filling-stations', showArchived],
    queryFn: async () =>
      (await api.get<Station[]>(`/filling-stations${showArchived ? '?includeInactive=true' : ''}`)).data,
  });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });

  const [cityId, setCityId] = useState('');
  const [areaName, setAreaName] = useState('');
  const areas = useQuery({
    queryKey: ['areas', cityId],
    queryFn: async () => (cityId ? (await api.get<Area[]>(`/cities/${cityId}/areas`)).data : []),
    enabled: !!cityId,
  });

  const [form, setForm] = useState({ name: '', address: '', lat: '', lng: '', pricePkr: '300' });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Station | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  function pickArea(name: string) {
    setAreaName(name);
    const a = (areas.data ?? []).find((x) => x.name === name);
    if (a) {
      setForm((f) => ({
        ...f,
        lat: String(a.lat),
        lng: String(a.lng),
        address: f.address || `${a.name}, ${(cities.data ?? []).find((c) => c.id === cityId)?.name ?? ''}`,
      }));
    }
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.name || !form.lat || !form.lng) throw new Error('Name, latitude, and longitude are required');
      return api.post('/filling-stations', {
        name: form.name,
        address: form.address,
        lat: Number(form.lat),
        lng: Number(form.lng),
        pricePerCylinderPaisa: Math.round(Number(form.pricePkr || '0') * 100),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filling-stations'] });
      setForm({ name: '', address: '', lat: '', lng: '', pricePkr: '300' });
      setCityId(''); setAreaName(''); setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/filling-stations/${editing!.id}`, {
        name: editForm.name,
        address: editForm.address,
        lat: editForm.lat ? Number(editForm.lat) : undefined,
        lng: editForm.lng ? Number(editForm.lng) : undefined,
        pricePerCylinderPaisa:
          editForm.pricePkr !== undefined ? Math.round(Number(editForm.pricePkr) * 100) : undefined,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['filling-stations'] }); setEditing(null); },
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/filling-stations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filling-stations'] }),
  });

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Filling stations</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
      </div>
      <p className="muted">Pick a city → area to auto-fill coordinates, or type lat/lng directly.</p>

      <div className="card">
        <h3>Add filling station</h3>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>City</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setAreaName(''); }}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Area / zone (auto-fills coordinates)</label>
            <select value={areaName} onChange={(e) => pickArea(e.target.value)} disabled={!cityId}>
              <option value="">— pick an area —</option>
              {(areas.data ?? []).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <label>Name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. SNGPL Sihala Filling Plant" />
        <label>Address</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}><label>Latitude *</label><input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Longitude *</label><input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Price per cylinder (PKR)</label><input type="number" value={form.pricePkr} onChange={(e) => setForm({ ...form, pricePkr: e.target.value })} /></div>
        </div>

        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Add station</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Address</th><th>Lat/Lng</th><th>Price/cyl</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.5 }}>
                <td>{s.name}</td>
                <td className="muted">{s.address}</td>
                <td>{s.lat?.toFixed(4)}, {s.lng?.toFixed(4)}</td>
                <td><strong>Rs. {(Number(s.price_per_cylinder_paisa) / 100).toLocaleString()}</strong></td>
                <td>{s.is_active ? '✓' : '—'}</td>
                <td>
                  <button onClick={() => {
                    setEditing(s);
                    setEditForm({
                      name: s.name, address: s.address,
                      lat: String(s.lat), lng: String(s.lng),
                      pricePkr: String(Number(s.price_per_cylinder_paisa) / 100),
                    });
                  }}>✏️</button>{' '}
                  {s.is_active && (
                    <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog(`Archive "${s.name}"?`)) archive.mutate(s.id); }}>🗑️</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit filling station" open={!!editing} onClose={() => setEditing(null)} width={560}>
        {editing && (
          <>
            <label>Name</label>
            <input value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label>Address</label>
            <input value={editForm.address ?? ''} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}><label>Latitude</label><input value={editForm.lat ?? ''} onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Longitude</label><input value={editForm.lng ?? ''} onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })} /></div>
            </div>
            <label>Price per cylinder (PKR)</label>
            <input type="number" value={editForm.pricePkr ?? ''} onChange={(e) => setEditForm({ ...editForm, pricePkr: e.target.value })} />
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
