import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

export function DistributorsScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get('/distributors')).data });
  const [showSuspended, setShowSuspended] = useState(false);

  const [form, setForm] = useState({ phone: '', name: '', businessName: '' });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editErr, setEditErr] = useState<string | null>(null);

  function errMsg(e: any) {
    return (
      e?.response?.data?.message ??
      (Array.isArray(e?.response?.data?.message) ? e.response.data.message.join(', ') : null) ??
      e?.message ??
      'Failed'
    );
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.phone) throw new Error('Phone is required');
      if (!/^\+923\d{9}$/.test(form.phone)) throw new Error('Phone must be in form +923XXXXXXXXX');
      if (!form.name) throw new Error('Contact name is required');
      if (!form.businessName) throw new Error('Business name is required');
      return api.post('/distributors', form).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['distributors'] });
      setForm({ phone: '', name: '', businessName: '' });
      setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(errMsg(e)),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/distributors/${id}/approve`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distributors'] }),
  });
  const suspend = useMutation({
    mutationFn: (id: string) => api.patch(`/distributors/${id}/suspend`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distributors'] }),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/distributors/${editing.id}`, {
        businessName: editForm.businessName,
        name: editForm.contactName,
        email: editForm.email,
        phone: editForm.phone,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['distributors'] }); setEditing(null); setEditErr(null); },
    onError: (e: any) => setEditErr(errMsg(e)),
  });

  const rows = (data ?? []).filter((d: any) => showSuspended || d.status !== 'SUSPENDED');

  function openEdit(d: any) {
    setEditing(d);
    setEditForm({
      businessName: d.businessName,
      contactName: d.user?.name,
      email: d.user?.email ?? '',
      phone: d.user?.phone,
    });
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Distributors</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showSuspended} onChange={(e) => setShowSuspended(e.target.checked)} />
          show suspended
        </label>
      </div>

      <div className="card">
        <h3>Add distributor partner</h3>
        <label>Phone</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+923XXXXXXXXX" />
        <label>Contact name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Business name</label>
        <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Business</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th><th>Balance</th><th></th></tr></thead>
          <tbody>
            {rows.map((d: any) => (
              <tr key={d.id} style={{ opacity: d.status === 'SUSPENDED' ? 0.5 : 1 }}>
                <td>{d.businessName}</td>
                <td>{d.user?.name}</td>
                <td>{d.user?.phone}</td>
                <td>{d.user?.email ?? '—'}</td>
                <td>{d.status}</td>
                <td>{Number(d.advanceBalancePaisa) / 100} PKR</td>
                <td>
                  <button onClick={() => openEdit(d)}>Edit</button>{' '}
                  {d.status === 'PENDING' && <button className="primary" onClick={() => approve.mutate(d.id)}>Approve</button>}
                  {d.status === 'ACTIVE' && (
                    <button
                      style={{ color: 'var(--danger)' }}
                      onClick={() => { if (confirmDialog(`Suspend distributor "${d.businessName}"?`)) suspend.mutate(d.id); }}
                    >Suspend</button>
                  )}
                  {d.status === 'SUSPENDED' && <button onClick={() => approve.mutate(d.id)}>Reinstate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit distributor" open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <label>Business name</label>
            <input value={editForm.businessName ?? ''} onChange={(e) => setEditForm({ ...editForm, businessName: e.target.value })} />
            <label>Contact name</label>
            <input value={editForm.contactName ?? ''} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} />
            <label>Phone</label>
            <input value={editForm.phone ?? ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <label>Email</label>
            <input value={editForm.email ?? ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
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
