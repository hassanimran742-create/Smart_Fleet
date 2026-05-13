import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function VehiclesScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const [form, setForm] = useState({ plateNo: '', capacityUnits: '20', homeZoneId: '' });

  const create = useMutation({
    mutationFn: () =>
      api
        .post('/vehicles', { ...form, capacityUnits: Number(form.capacityUnits) })
        .then((r) => r.data),
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

  return (
    <>
      <h2>Vehicles</h2>
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
            {(data ?? []).map((v: any) => (
              <tr key={v.id}>
                <td>{v.plateNo}</td>
                <td>{v.capacityUnits}</td>
                <td>{v.status}</td>
                <td>{v.currentDriver ? v.currentDriver.id.slice(0, 8) : '—'}</td>
                <td>
                  <select value={v.status} onChange={(e) => setStatus.mutate({ id: v.id, status: e.target.value })}>
                    {['ACTIVE', 'MAINTENANCE', 'RETIRED'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
