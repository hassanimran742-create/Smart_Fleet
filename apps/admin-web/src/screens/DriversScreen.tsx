import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function DriversScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const [form, setForm] = useState({ phone: '', name: '', licenceNo: '' });

  const create = useMutation({
    mutationFn: () => api.post('/drivers', form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drivers'] }); setForm({ phone: '', name: '', licenceNo: '' }); },
  });

  const assignVehicle = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string | null }) =>
      api.patch(`/drivers/${id}/vehicle`, { vehicleId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });

  return (
    <>
      <h2>Drivers</h2>
      <div className="card">
        <h3>Add driver</h3>
        <label>Phone</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+923XXXXXXXXX" />
        <label>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Licence #</label>
        <input value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} />
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Licence</th><th>Online</th><th>Vehicle</th></tr></thead>
          <tbody>
            {(data ?? []).map((d: any) => (
              <tr key={d.id}>
                <td>{d.user?.name}</td>
                <td>{d.user?.phone}</td>
                <td>{d.licenceNo}</td>
                <td>{d.isOnline ? '🟢' : '⚪'}</td>
                <td>
                  <select
                    value={d.currentVehicleId ?? ''}
                    onChange={(e) => assignVehicle.mutate({ id: d.id, vehicleId: e.target.value || null })}
                  >
                    <option value="">— none —</option>
                    {(vehicles.data ?? []).map((v: any) => (
                      <option key={v.id} value={v.id}>{v.plateNo}</option>
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
