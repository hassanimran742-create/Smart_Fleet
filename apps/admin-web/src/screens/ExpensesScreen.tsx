import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

const CATEGORIES = ['FOOD', 'UTILITIES', 'LABOUR', 'FUEL', 'MAINTENANCE', 'RENT', 'OFFICE', 'TRAVEL', 'EQUIPMENT', 'OTHER'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_TONE: Record<string, string> = {
  FOOD: 'pill-primary',
  UTILITIES: 'pill-primary',
  LABOUR: 'pill-warn',
  FUEL: 'pill-warn',
  MAINTENANCE: 'pill-warn',
  RENT: 'pill-danger',
  OFFICE: 'pill-neutral',
  TRAVEL: 'pill-primary',
  EQUIPMENT: 'pill-neutral',
  OTHER: 'pill-neutral',
};

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export function ExpensesScreen() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>('');
  const [since, setSince] = useState(defaultSince(30));
  const [until, setUntil] = useState(new Date().toISOString().slice(0, 10));

  const queryParams = new URLSearchParams();
  if (category) queryParams.set('category', category);
  if (since) queryParams.set('since', new Date(since).toISOString());
  if (until) queryParams.set('until', new Date(until + 'T23:59:59').toISOString());

  const list = useQuery({
    queryKey: ['expenses', category, since, until],
    queryFn: async () => (await api.get(`/expenses?${queryParams.toString()}`)).data,
  });
  const summary = useQuery({
    queryKey: ['expenses-summary', since, until],
    queryFn: async () =>
      (await api.get(
        `/expenses/summary?since=${new Date(since).toISOString()}&until=${new Date(until + 'T23:59:59').toISOString()}`,
      )).data,
  });

  const [form, setForm] = useState({
    category: 'FOOD' as Category,
    description: '',
    amountPkr: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    vendor: '',
    notes: '',
  });
  const [createErr, setCreateErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      if (!form.description.trim()) throw new Error('Description is required');
      if (!form.amountPkr || Number(form.amountPkr) <= 0) throw new Error('Amount must be > 0');
      return api.post('/expenses', {
        category: form.category,
        description: form.description.trim(),
        amountPaisa: Math.round(Number(form.amountPkr) * 100),
        expenseDate: form.expenseDate,
        vendor: form.vendor || undefined,
        notes: form.notes || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-summary'] });
      setForm({ category: 'FOOD', description: '', amountPkr: '', expenseDate: new Date().toISOString().slice(0, 10), vendor: '', notes: '' });
      setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
  });

  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/expenses/${editing.id}`, {
        category: editForm.category,
        description: editForm.description,
        amountPaisa: editForm.amountPkr !== undefined ? Math.round(Number(editForm.amountPkr) * 100) : undefined,
        expenseDate: editForm.expenseDate,
        vendor: editForm.vendor,
        notes: editForm.notes,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); setEditing(null); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['expenses-summary'] }); },
  });

  const totalPkr = summary.data ? Number(summary.data.total) / 100 : 0;
  const byCat = (summary.data?.byCategory ?? []).map((c: any) => ({
    ...c,
    totalPkr: Number(c.totalPaisa) / 100,
  }));

  return (
    <>
      <h2>Expenses</h2>
      <p className="muted">Super-admin only. Track operational costs by category: food, utilities, labour, fuel, maintenance, rent, etc.</p>

      <div className="card">
        <div className="flex" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ margin: 0 }}>From</label>
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label style={{ margin: 0 }}>To</label>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <div>
            <label style={{ margin: 0 }}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="kpi">
        <div className="card">
          <div className="label">Total in window</div>
          <div className="value" style={{ color: 'var(--danger)' }}>Rs. {totalPkr.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Expense entries</div>
          <div className="value">{summary.data?.count ?? 0}</div>
        </div>
        {byCat.slice(0, 3).map((c: any) => (
          <div className="card" key={c.category}>
            <div className="label">{c.category}</div>
            <div className="value">Rs. {c.totalPkr.toLocaleString()}</div>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>{c.count} entries</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Add expense</h3>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Category *</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <label>Description *</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Lunch for team meeting" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Amount (PKR) *</label>
            <input type="number" value={form.amountPkr} onChange={(e) => setForm({ ...form, amountPkr: e.target.value })} />
          </div>
          <div style={{ width: 160 }}>
            <label>Date</label>
            <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
          </div>
        </div>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Vendor / payee</label>
            <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </div>
          <div style={{ flex: 2 }}>
            <label>Notes</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Add expense</button>
      </div>

      <div className="card">
        <h3>Recent expenses</h3>
        <table>
          <thead>
            <tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Amount (PKR)</th><th></th></tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((e: any) => (
              <tr key={e.id}>
                <td className="muted">{new Date(e.expenseDate).toLocaleDateString()}</td>
                <td><span className={`pill ${CATEGORY_TONE[e.category] ?? 'pill-neutral'}`}>{e.category}</span></td>
                <td>{e.description}</td>
                <td className="muted">{e.vendor ?? '—'}</td>
                <td><strong>{(Number(e.amountPaisa) / 100).toLocaleString()}</strong></td>
                <td>
                  <button onClick={() => {
                    setEditing(e);
                    setEditForm({
                      category: e.category, description: e.description,
                      amountPkr: String(Number(e.amountPaisa) / 100),
                      expenseDate: e.expenseDate.slice(0, 10),
                      vendor: e.vendor ?? '', notes: e.notes ?? '',
                    });
                  }}>✏️</button>{' '}
                  <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog('Delete this expense?')) remove.mutate(e.id); }}>🗑️</button>
                </td>
              </tr>
            ))}
            {(list.data ?? []).length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No expenses in this window.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal title="Edit expense" open={!!editing} onClose={() => setEditing(null)} width={560}>
        {editing && (
          <>
            <label>Category</label>
            <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label>Description</label>
            <input value={editForm.description ?? ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}><label>Amount (PKR)</label><input type="number" value={editForm.amountPkr ?? ''} onChange={(e) => setEditForm({ ...editForm, amountPkr: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Date</label><input type="date" value={editForm.expenseDate ?? ''} onChange={(e) => setEditForm({ ...editForm, expenseDate: e.target.value })} /></div>
            </div>
            <label>Vendor</label>
            <input value={editForm.vendor ?? ''} onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })} />
            <label>Notes</label>
            <input value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
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
