import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useState } from 'react';

export function StoresScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get('/stores')).data });
  const [form, setForm] = useState({ name: '', zoneId: '', address: '', lat: '', lng: '' });

  const create = useMutation({
    mutationFn: () =>
      api
        .post('/stores', { ...form, lat: Number(form.lat), lng: Number(form.lng) })
        .then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stores'] }); setForm({ name: '', zoneId: '', address: '', lat: '', lng: '' }); },
  });

  return (
    <>
      <h2>Stores</h2>
      <div className="card">
        <h3>Add store</h3>
        <label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Zone ID</label><input value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value })} />
        <label>Address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <div className="flex">
          <div style={{ flex: 1 }}><label>Latitude</label><input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Longitude</label><input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></div>
        </div>
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Zone</th><th>Address</th><th>Lat/Lng</th></tr></thead>
          <tbody>
            {(data ?? []).map((s: any) => (
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
