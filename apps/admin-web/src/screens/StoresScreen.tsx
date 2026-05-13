import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';

interface City { id: string; name: string }
interface Area { name: string; lat: number; lng: number }
interface Zone { id: string; city_id: string; name: string }

export function StoresScreen() {
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get('/stores')).data });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });

  const [cityId, setCityId] = useState<string>('');
  const [areaName, setAreaName] = useState<string>('');

  const areas = useQuery({
    queryKey: ['areas', cityId],
    queryFn: async () => cityId ? (await api.get<Area[]>(`/cities/${cityId}/areas`)).data : [],
    enabled: !!cityId,
  });

  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => cityId ? (await api.get<Zone[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  const [form, setForm] = useState({ name: '', zoneId: '', address: '', lat: '', lng: '' });
  const [err, setErr] = useState<string | null>(null);

  function onPickArea(name: string) {
    setAreaName(name);
    const a = (areas.data ?? []).find((x) => x.name === name);
    if (a) setForm((f) => ({ ...f, lat: String(a.lat), lng: String(a.lng), address: f.address || a.name }));
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.name || !form.zoneId || !form.lat || !form.lng) {
        throw new Error('Name, zone, latitude, and longitude are required');
      }
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

  return (
    <>
      <h2>Stores</h2>

      <div className="card">
        <h3>Add store</h3>
        <div className="flex" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>City *</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setAreaName(''); setForm((f) => ({ ...f, zoneId: '' })); }}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c: City) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Area / sector</label>
            <select
              value={areaName}
              onChange={(e) => onPickArea(e.target.value)}
              disabled={!cityId}
            >
              <option value="">— pick an area —</option>
              {(areas.data ?? []).map((a: Area) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Zone *</label>
            <select
              value={form.zoneId}
              onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
              disabled={!cityId}
            >
              <option value="">— pick a zone —</option>
              {(zones.data ?? []).map((z: Zone) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            {(zones.data ?? []).length === 0 && cityId && (
              <p className="muted" style={{ marginTop: 4 }}>
                No zones for this city yet. Create one on the Zones page first.
              </p>
            )}
          </div>
        </div>

        <label>Store name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Smart_Fleet F-7 store" />

        <label>Address</label>
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder={areaName || 'Street, area, city'}
        />

        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Latitude *</label>
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="e.g. 33.7177" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Longitude *</label>
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="e.g. 73.0535" />
          </div>
        </div>
        <p className="muted">Selecting an area auto-fills latitude/longitude with that area's centre. You can fine-tune the numbers.</p>

        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create store</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Zone</th><th>Address</th><th>Lat / Lng</th></tr></thead>
          <tbody>
            {(stores.data ?? []).map((s: any) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.zone_id?.slice(0, 8) ?? '—'}</td>
                <td>{s.address}</td>
                <td>{s.lat?.toFixed(4)}, {s.lng?.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
