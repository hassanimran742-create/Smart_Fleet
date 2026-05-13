import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

const CATEGORIES = ['PIPE', 'CONNECTOR', 'REGULATOR', 'VALVE', 'BURNER', 'HOSE', 'ADAPTER', 'VAPORISER', 'OTHER'] as const;
type Category = typeof CATEGORIES[number];

interface Accessory {
  id: string;
  code: string;
  name: string;
  category: Category;
  unit: string;
  defaultPricePaisa: string;
  isActive: boolean;
}

export function AccessoriesScreen() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useQuery({
    queryKey: ['accessories', showArchived],
    queryFn: async () => (await api.get<Accessory[]>(`/accessories${showArchived ? '?includeInactive=true' : ''}`)).data,
  });

  const [form, setForm] = useState({ code: '', name: '', category: 'PIPE' as Category, unit: 'piece', defaultPriceRs: '0' });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Accessory | null>(null);
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
      if (!form.code.trim()) throw new Error('Code is required');
      if (!form.name.trim()) throw new Error('Name is required');
      if (!form.unit.trim()) throw new Error('Unit is required');
      return api.post('/accessories', {
        ...form,
        defaultPricePaisa: Math.round(Number(form.defaultPriceRs || '0') * 100),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessories'] });
      setForm({ code: '', name: '', category: 'PIPE', unit: 'piece', defaultPriceRs: '0' });
      setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(errMsg(e)),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/accessories/${editing!.id}`, {
        name: editForm.name,
        category: editForm.category,
        unit: editForm.unit,
        defaultPricePaisa: Math.round(Number(editForm.defaultPriceRs || '0') * 100),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessories'] });
      setEditing(null);
      setEditErr(null);
    },
    onError: (e: any) => setEditErr(errMsg(e)),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/accessories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accessories'] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/accessories/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accessories'] }),
  });

  function openEdit(a: Accessory) {
    setEditing(a);
    setEditForm({
      name: a.name,
      category: a.category,
      unit: a.unit,
      defaultPriceRs: String(Number(a.defaultPricePaisa) / 100),
    });
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Accessories catalog</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
      </div>
      <p className="muted">Define the types of accessories (pipes, connectors, regulators, etc.) sold or installed alongside cylinders. Stock per store is managed on the Inventory page.</p>

      <div className="card">
        <h3>Add accessory type</h3>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Code *</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. PIPE_HALF_INCH" />
          </div>
          <div style={{ flex: 2 }}>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='e.g. "1/2 inch LPG pipe"' />
          </div>
        </div>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Unit</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {['piece', 'meter', 'foot', 'kg', 'box', 'set'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Default price (PKR / unit)</label>
            <input type="number" value={form.defaultPriceRs} onChange={(e) => setForm({ ...form, defaultPriceRs: e.target.value })} />
          </div>
        </div>
        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Add accessory</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Default price</th><th>Active</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id} style={{ opacity: a.isActive ? 1 : 0.5 }}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{a.category}</td>
                <td>{a.unit}</td>
                <td>Rs. {(Number(a.defaultPricePaisa) / 100).toLocaleString()}</td>
                <td>{a.isActive ? '✓' : '—'}</td>
                <td>
                  <button onClick={() => openEdit(a)}>Edit</button>{' '}
                  {a.isActive ? (
                    <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog(`Archive "${a.name}"?`)) archive.mutate(a.id); }}>Archive</button>
                  ) : (
                    <button onClick={() => reactivate.mutate(a.id)}>Reactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit accessory" open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <label>Name</label>
            <input value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label>Category</label>
            <select value={editForm.category ?? 'PIPE'} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label>Unit</label>
            <select value={editForm.unit ?? 'piece'} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}>
              {['piece', 'meter', 'foot', 'kg', 'box', 'set'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <label>Default price (PKR / unit)</label>
            <input type="number" value={editForm.defaultPriceRs ?? ''} onChange={(e) => setEditForm({ ...editForm, defaultPriceRs: e.target.value })} />
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
