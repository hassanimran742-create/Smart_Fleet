import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

interface City { id: string; name: string }
interface Zone { id: string; city_id: string; name: string }

function errMsg(e: any): string {
  return (
    e?.response?.data?.message ??
    (Array.isArray(e?.response?.data?.message) ? e.response.data.message.join(', ') : null) ??
    e?.message ??
    'Failed'
  );
}

export function VehiclesScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const [showRetired, setShowRetired] = useState(false);

  const [cityId, setCityId] = useState('');
  const [form, setForm] = useState({ plateNo: '', capacityUnits: '20', homeZoneId: '' });
  const [createErr, setCreateErr] = useState<string | null>(null);

  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => cityId ? (await api.get<Zone[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  const [editing, setEditing] = useState<any>(null);
  const [editCityId, setEditCityId] = useState('');
  const [editForm, setEditForm] = useState<any>({});
  const [editErr, setEditErr] = useState<string | null>(null);
  const editZones = useQuery({
    queryKey: ['zones', editCityId],
    queryFn: async () => editCityId ? (await api.get<Zone[]>(`/zones/city/${editCityId}`)).data : [],
    enabled: !!editCityId,
  });

  const create = useMutation({
    mutationFn: () => {
      if (!form.plateNo) throw new Error('Plate number is required');
      if (!form.homeZoneId) throw new Error('Pick a city and zone');
      if (!Number.isFinite(Number(form.capacityUnits)) || Number(form.capacityUnits) <= 0) {
        throw new Error('Capacity must be a positive number');
      }
      return api.post('/vehicles', { ...form, capacityUnits: Number(form.capacityUnits) }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setForm({ plateNo: '', capacityUnits: '20', homeZoneId: '' });
      setCityId('');
      setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(errMsg(e)),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/vehicles/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/vehicles/${editing.id}`, {
        plateNo: editForm.plateNo,
        capacityUnits: Number(editForm.capacityUnits),
        homeZoneId: editForm.homeZoneId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setEditing(null);
      setEditErr(null);
    },
    onError: (e: any) => setEditErr(errMsg(e)),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  });

  const rows = (data ?? []).filter((v: any) => showRetired || v.status !== 'RETIRED');

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Vehicles</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          show retired
        </label>
      </div>

      <div className="card">
        <h3>Add vehicle</h3>
        <label>Plate number *</label>
        <input value={form.plateNo} onChange={(e) => setForm({ ...form, plateNo: e.target.value })} placeholder="LXX-1234" />

        <label>Capacity * (in 11kg-cylinder units)</label>
        <input type="number" value={form.capacityUnits} onChange={(e) => setForm({ ...form, capacityUnits: e.target.value })} />

        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>City *</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setForm({ ...form, homeZoneId: '' }); }}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Home zone *</label>
            <select value={form.homeZoneId} onChange={(e) => setForm({ ...form, homeZoneId: e.target.value })} disabled={!cityId}>
              <option value="">— pick a zone —</option>
              {(zones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            {cityId && (zones.data ?? []).length === 0 && (
              <p className="muted" style={{ marginTop: 4 }}>
                No zones in this city. Create one on the Zones page first.
              </p>
            )}
          </div>
        </div>

        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Plate</th><th>Capacity</th><th>Zone</th><th>Status</th><th>Driver</th><th></th></tr></thead>
          <tbody>
            {rows.map((v: any) => (
              <tr key={v.id} style={{ opacity: v.status === 'RETIRED' ? 0.5 : 1 }}>
                <td>{v.plateNo}</td>
                <td>{v.capacityUnits}</td>
                <td>{v.homeZone?.name ?? v.homeZoneId.slice(0, 8)}</td>
                <td>{v.status}</td>
                <td>{v.currentDriver ? v.currentDriver.id.slice(0, 8) : '—'}</td>
                <td>
                  <select value={v.status} onChange={(e) => setStatus.mutate({ id: v.id, status: e.target.value })}>
                    {['ACTIVE', 'MAINTENANCE', 'RETIRED'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>{' '}
                  <button onClick={() => {
                    setEditing(v);
                    setEditForm({ plateNo: v.plateNo, capacityUnits: String(v.capacityUnits), homeZoneId: v.homeZoneId });
                    setEditCityId(v.homeZone?.cityId ?? '');
                    setEditErr(null);
                  }}>Edit</button>{' '}
                  {v.status !== 'RETIRED' && (
                    <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog(`Archive vehicle "${v.plateNo}"?`)) archive.mutate(v.id); }}>Archive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit vehicle" open={!!editing} onClose={() => setEditing(null)} width={560}>
        {editing && (
          <>
            <label>Plate number</label>
            <input value={editForm.plateNo ?? ''} onChange={(e) => setEditForm({ ...editForm, plateNo: e.target.value })} />
            <label>Capacity</label>
            <input type="number" value={editForm.capacityUnits ?? ''} onChange={(e) => setEditForm({ ...editForm, capacityUnits: e.target.value })} />
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>City</label>
                <select value={editCityId} onChange={(e) => setEditCityId(e.target.value)}>
                  <option value="">— pick a city —</option>
                  {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Home zone</label>
                <select value={editForm.homeZoneId ?? ''} onChange={(e) => setEditForm({ ...editForm, homeZoneId: e.target.value })} disabled={!editCityId}>
                  <option value="">— pick a zone —</option>
                  {(editZones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
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
