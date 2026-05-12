import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useState } from 'react';

export function DistributorsScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get('/distributors')).data });
  const [form, setForm] = useState({ phone: '', name: '', businessName: '' });

  const create = useMutation({
    mutationFn: () => api.post('/distributors', form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['distributors'] }); setForm({ phone: '', name: '', businessName: '' }); },
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/distributors/${id}/approve`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distributors'] }),
  });

  return (
    <>
      <h2>Distributors</h2>
      <div className="card">
        <h3>Add distributor partner</h3>
        <label>Phone</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <label>Contact name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Business name</label>
        <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Business</th><th>Phone</th><th>Status</th><th>Balance</th><th></th></tr></thead>
          <tbody>
            {(data ?? []).map((d: any) => (
              <tr key={d.id}>
                <td>{d.businessName}</td>
                <td>{d.user?.phone}</td>
                <td>{d.status}</td>
                <td>{Number(d.advanceBalancePaisa) / 100} PKR</td>
                <td>{d.status === 'PENDING' && <button className="primary" onClick={() => approve.mutate(d.id)}>Approve</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
