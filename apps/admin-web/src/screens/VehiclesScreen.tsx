import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

export function VehiclesScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const [showRetired, setShowRetired] = useState(false);

  const [form, setForm] = useState({ plateNo: '', capacityUnits: '20', homeZoneId: '' });
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  const create = useMutation({
    mutationFn: () => api.post('/vehicles', { ...form, capacityUnits: Number(form.capacityUnits) }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setForm({ plateNo: '', capacityUnits: '20', homeZoneId: '' });
    },
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
    },
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
        <label>Plate number</label>
        <input value={form.plateNo} onChange={(e) => setForm({ ...form, plateNo: e.target.value })} placeholder="LXX-1234" />
        <label>Capacity (in 11kg-cylinder units)</label>
        <input value={form.capacityUnits} onChange={(e) => setForm({ ...form, capacityUnits: e.target.value })} type="number" />
        <label>Home zone ID</label>
        <input value={form.homeZoneId} onChange={(e) => setForm({ ...form, homeZoneId: e.target.value })} placeholder="zone UUID" />
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Plate</th><th>Capacity</th><th>Status</th><th>Driver</th><th></th></tr></thead>
          <tbody>
            {rows.map((v: any) => (
              <tr key={v.id} style={{ opacity: v.status === 'RETIRED' ? 0.5 : 1 }}>
                <td>{v.plateNo}</td>
                <td>{v.capacityUnits}</td>
                <td>{v.status}</td>
                <td>{v.currentDriver ? v.currentDriver.id.slice(0, 8) : '—'}</td>
                <td>
                  <select value={v.status} onChange={(e) => setStatus.mutate({ id: v.id, status: e.target.value })}>
                    {['ACTIVE', 'MAINTENANCE', 'RETIRED'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>{' '}
                  <button onClick={() => { setEditing(v); setEditForm({ plateNo: v.plateNo, capacityUnits: String(v.capacityUnits), homeZoneId: v.homeZoneId }); }}>Edit</button>{' '}
                  {v.status !== 'RETIRED' && (
                    <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog(`Archive vehicle "${v.plateNo}"?`)) archive.mutate(v.id); }}>Archive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit vehicle" open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <label>Plate number</label>
            <input value={editForm.plateNo ?? ''} onChange={(e) => setEditForm({ ...editForm, plateNo: e.target.value })} />
            <label>Capacity (11kg-cylinder units)</label>
            <input type="number" value={editForm.capacityUnits ?? ''} onChange={(e) => setEditForm({ ...editForm, capacityUnits: e.target.value })} />
            <label>Home zone ID</label>
            <input value={editForm.homeZoneId ?? ''} onChange={(e) => setEditForm({ ...editForm, homeZoneId: e.target.value })} />
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
