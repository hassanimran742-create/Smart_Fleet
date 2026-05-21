import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

interface Store { id: string; name: string }
interface Distributor { id: string; businessName: string }
interface CylinderType { id: string; code: string; name: string }
interface CylinderTypeFull { id: string; code: string; name: string; weightKg: string; capacityUnits: number }
interface Accessory {
  id: string; code: string; name: string; category: string; unit: string;
  defaultPricePaisa: string; isActive: boolean;
}
interface AccessoryStockRow {
  id: string;
  storeId: string;
  accessoryId: string;
  quantity: number;
  unitPricePaisa: string | null;
  accessory: Accessory;
}
interface ByStoreRow {
  store_id: string;
  store_name: string;
  distributor_id: string;
  distributor_name: string;
  cylinder_type_code: string;
  state: 'FULL' | 'EMPTY';
  count: number;
}

const REASONS = ['RECEIPT', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'DAMAGE_LOSS'] as const;
const CATEGORIES = ['PIPE', 'CONNECTOR', 'REGULATOR', 'VALVE', 'BURNER', 'HOSE', 'ADAPTER', 'VAPORISER', 'OTHER'] as const;
type Category = typeof CATEGORIES[number];

type Tab = 'add' | 'view' | 'catalog';

function errMsg(e: any) {
  return (
    e?.response?.data?.message ??
    (Array.isArray(e?.response?.data?.message) ? e.response.data.message.join(', ') : null) ??
    e?.message ??
    'Failed'
  );
}

export function InventoryScreen() {
  const [tab, setTab] = useState<Tab>('add');

  return (
    <>
      <h2>Inventory</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {([
          ['add', '➕ Add inventory'],
          ['view', '📊 View / edit'],
          ['catalog', '🧰 Accessory catalog'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              borderBottom: tab === id ? '3px solid var(--primary)' : '3px solid transparent',
              fontWeight: tab === id ? 600 : 400,
              color: tab === id ? 'var(--primary)' : 'inherit',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'add' && <AddTab />}
      {tab === 'view' && <ViewTab />}
      {tab === 'catalog' && <CatalogTab />}
    </>
  );
}

function AddTab() {
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Store[]>('/stores')).data });
  const [storeId, setStoreId] = useState<string>('');

  return (
    <>
      <div className="card">
        <label>Pick the store to add stock at *</label>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">— pick a store —</option>
          {(stores.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {(stores.data ?? []).length === 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            No stores yet. Create one on the Stores page first.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Tip: to print/export QR labels for the cylinders you add, use the <strong>QR generator</strong>
          page — every cylinder gets a unique serial QR scannable in the driver/distributor apps.
        </p>
      </div>

      {storeId && (
        <>
          <AddCylindersCard storeId={storeId} qc={qc} />
          <AddAccessoriesCard storeId={storeId} qc={qc} />
        </>
      )}
    </>
  );
}

function ViewTab() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Store[]>('/stores')).data });
  const [storeId, setStoreId] = useState<string>('');

  return (
    <>
      <div className="card">
        <label>Filter by store (leave blank for all)</label>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">— all stores —</option>
          {(stores.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {storeId ? (
        <>
          <CylindersAtStore storeId={storeId} />
          <AccessoryStockAtStore storeId={storeId} />
        </>
      ) : (
        <AllStoresOverview />
      )}
    </>
  );
}

function AddCylindersCard({ storeId, qc }: { storeId: string; qc: any }) {
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<Distributor[]>('/distributors')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderTypeFull[]>('/cylinder-types')).data });

  const [form, setForm] = useState({ distributorId: '', cylinderTypeId: '', quantity: '' });
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: () => {
      const qty = Math.floor(Number(form.quantity));
      if (!form.distributorId) throw new Error('Pick a distributor');
      if (!form.cylinderTypeId) throw new Error('Pick a cylinder weight');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a positive quantity');
      if (qty > 5000) throw new Error('Maximum 5000 cylinders per registration');
      return api.post('/cylinders/bulk-register', {
        distributorId: form.distributorId,
        cylinderTypeId: form.cylinderTypeId,
        quantity: qty,
        initialCustodyType: 'STORE',
        initialCustodyId: storeId,
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['inventory-by-store-all'] });
      qc.invalidateQueries({ queryKey: ['inventory-by-store-filtered'] });
      const count = Array.isArray(r.data) ? r.data.length : 0;
      setResult(`${count} cylinder(s) registered at this store.`);
      setErr(null);
      setForm({ ...form, quantity: '' });
    },
    onError: (e: any) => {
      setErr(errMsg(e));
      setResult(null);
    },
  });

  return (
    <div className="card">
      <h3>Add cylinders</h3>
      <p className="muted">
        Bulk-register cylinders by quantity. Each one gets an auto-generated serial QR which you can print
        later from the QR generator page. They land FULL and held at this store, owned by the picked distributor.
      </p>
      <div className="flex" style={{ gap: 12 }}>
        <div style={{ flex: 2 }}>
          <label>Distributor *</label>
          <select value={form.distributorId} onChange={(e) => setForm({ ...form, distributorId: e.target.value })}>
            <option value="">— pick a distributor —</option>
            {(distributors.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.businessName}</option>)}
          </select>
        </div>
        <div style={{ flex: 2 }}>
          <label>Cylinder weight *</label>
          <select value={form.cylinderTypeId} onChange={(e) => setForm({ ...form, cylinderTypeId: e.target.value })}>
            <option value="">— pick a weight —</option>
            {(types.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {Number(t.weightKg).toString()} kg</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Quantity *</label>
          <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="e.g. 100" />
        </div>
      </div>
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {result && <p style={{ color: 'var(--ok)' }}>{result}</p>}
      <button className="primary" style={{ marginTop: 12 }} onClick={() => register.mutate()}>Register cylinders</button>
    </div>
  );
}

function AddAccessoriesCard({ storeId, qc }: { storeId: string; qc: any }) {
  const accessories = useQuery({
    queryKey: ['accessories'],
    queryFn: async () => (await api.get<Accessory[]>('/accessories')).data,
  });

  const [form, setForm] = useState({
    accessoryId: '',
    delta: '0',
    reason: 'RECEIPT' as typeof REASONS[number],
    note: '',
    unitPriceRs: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const adjust = useMutation({
    mutationFn: () => {
      const delta = Number(form.delta);
      if (!form.accessoryId || !Number.isFinite(delta) || delta === 0) {
        throw new Error('Pick an accessory and enter a non-zero quantity (+ to add, - to remove)');
      }
      return api.post('/accessories/stock/adjust', {
        storeId,
        accessoryId: form.accessoryId,
        delta,
        reason: form.reason,
        note: form.note || undefined,
        unitPricePaisa: form.unitPriceRs ? Math.round(Number(form.unitPriceRs) * 100) : undefined,
      });
    },
    onSuccess: () => {
      const n = Number(form.delta);
      qc.invalidateQueries({ queryKey: ['accessory-stock', storeId] });
      qc.invalidateQueries({ queryKey: ['accessory-movements', storeId] });
      setForm({ ...form, delta: '0', note: '', unitPriceRs: '' });
      setErr(null);
      setResult(`Stock updated (${n > 0 ? '+' : ''}${n}).`);
    },
    onError: (e: any) => { setErr(errMsg(e)); setResult(null); },
  });

  if ((accessories.data ?? []).length === 0) {
    return (
      <div className="card">
        <h3>Add accessory stock</h3>
        <p className="muted">No accessory types defined yet. Switch to the <strong>Accessory catalog</strong> tab to add some first.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Add or adjust accessory stock</h3>
      <p className="muted">
        Positive numbers add stock (e.g. receiving a shipment). Negative numbers reduce stock (sales, damage, transfer out).
      </p>
      <div className="flex" style={{ gap: 12 }}>
        <div style={{ flex: 2 }}>
          <label>Accessory *</label>
          <select value={form.accessoryId} onChange={(e) => setForm({ ...form, accessoryId: e.target.value })}>
            <option value="">— pick an accessory —</option>
            {(accessories.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.code}) · {a.unit}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Quantity delta * (+ / −)</label>
          <input type="number" value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} placeholder="+10 or -3" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Reason</label>
          <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as any })}>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Unit price PKR (override)</label>
          <input type="number" value={form.unitPriceRs} onChange={(e) => setForm({ ...form, unitPriceRs: e.target.value })} placeholder="optional" />
        </div>
      </div>
      <label>Note</label>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. invoice #4521 from supplier X" />
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {result && <p style={{ color: 'var(--ok)' }}>{result}</p>}
      <button className="primary" style={{ marginTop: 12 }} onClick={() => adjust.mutate()}>Apply</button>
    </div>
  );
}

function CylindersAtStore({ storeId }: { storeId: string }) {
  const cylinderInv = useQuery({
    queryKey: ['inventory-by-store-filtered', storeId],
    queryFn: async () => {
      const all = (await api.get<ByStoreRow[]>('/inventory/by-store')).data;
      return all.filter((r) => r.store_id === storeId);
    },
    refetchInterval: 30000,
  });

  const pivot: Record<string, Record<string, { full: number; empty: number }>> = {};
  for (const r of cylinderInv.data ?? []) {
    pivot[r.distributor_name] ??= {};
    pivot[r.distributor_name][r.cylinder_type_code] ??= { full: 0, empty: 0 };
    pivot[r.distributor_name][r.cylinder_type_code][r.state === 'FULL' ? 'full' : 'empty'] += r.count;
  }

  return (
    <div className="card">
      <h3>Cylinders at this store</h3>
      {Object.keys(pivot).length === 0 && <p className="muted">No cylinders yet at this store.</p>}
      {Object.keys(pivot).length > 0 && (
        <table>
          <thead><tr><th>Distributor</th><th>Type</th><th>Full</th><th>Empty</th></tr></thead>
          <tbody>
            {Object.entries(pivot).map(([d, types]) =>
              Object.entries(types).map(([t, c], i) => (
                <tr key={`${d}-${t}`}>
                  <td>{i === 0 ? d : ''}</td><td>{t}</td><td>{c.full}</td><td>{c.empty}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AccessoryStockAtStore({ storeId }: { storeId: string }) {
  const stock = useQuery({
    queryKey: ['accessory-stock', storeId],
    queryFn: async () => (await api.get<AccessoryStockRow[]>(`/accessories/stock/store/${storeId}`)).data,
    refetchInterval: 30000,
  });
  const movements = useQuery({
    queryKey: ['accessory-movements', storeId],
    queryFn: async () => (await api.get(`/accessories/movements/store/${storeId}`)).data,
  });

  return (
    <>
      <div className="card">
        <h3>Accessory stock at this store</h3>
        {(stock.data ?? []).length === 0 && <p className="muted">No accessory stock yet at this store.</p>}
        {(stock.data ?? []).length > 0 && (
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Quantity</th><th>Unit price (PKR)</th></tr></thead>
            <tbody>
              {(stock.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.accessory.code}</td>
                  <td>{r.accessory.name}</td>
                  <td>{r.accessory.category}</td>
                  <td>{r.accessory.unit}</td>
                  <td><strong>{r.quantity}</strong></td>
                  <td>
                    {r.unitPricePaisa != null
                      ? (Number(r.unitPricePaisa) / 100).toLocaleString()
                      : (Number(r.accessory.defaultPricePaisa) / 100).toLocaleString() + ' (default)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Recent accessory movements</h3>
        {(movements.data ?? []).length === 0 && <p className="muted">No movements yet.</p>}
        {(movements.data ?? []).length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Accessory</th><th>Δ</th><th>Reason</th><th>Note</th></tr></thead>
            <tbody>
              {(movements.data ?? []).slice(0, 50).map((m: any) => (
                <tr key={m.id}>
                  <td>{new Date(m.createdAt).toLocaleString()}</td>
                  <td>{m.accessory.name}</td>
                  <td style={{ color: m.delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                  <td>{m.reason}</td>
                  <td>{m.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AllStoresOverview() {
  const { data } = useQuery({
    queryKey: ['inventory-by-store-all'],
    queryFn: async () => (await api.get<ByStoreRow[]>('/inventory/by-store')).data,
    refetchInterval: 30000,
  });
  const grouped: Record<string, ByStoreRow[]> = {};
  for (const r of data ?? []) (grouped[r.store_name] ??= []).push(r);

  if ((data ?? []).length === 0) {
    return <div className="card"><p className="muted">No cylinder inventory across any store yet.</p></div>;
  }
  return (
    <>
      <h3>All stores — cylinder summary</h3>
      {Object.entries(grouped).map(([store, rows]) => {
        const pivot: Record<string, Record<string, { full: number; empty: number }>> = {};
        for (const r of rows) {
          pivot[r.distributor_name] ??= {};
          pivot[r.distributor_name][r.cylinder_type_code] ??= { full: 0, empty: 0 };
          pivot[r.distributor_name][r.cylinder_type_code][r.state === 'FULL' ? 'full' : 'empty'] += r.count;
        }
        return (
          <div className="card" key={store}>
            <h3>{store}</h3>
            <table>
              <thead><tr><th>Distributor</th><th>Type</th><th>Full</th><th>Empty</th></tr></thead>
              <tbody>
                {Object.entries(pivot).map(([d, types]) =>
                  Object.entries(types).map(([t, c], i) => (
                    <tr key={`${d}-${t}`}>
                      <td>{i === 0 ? d : ''}</td><td>{t}</td><td>{c.full}</td><td>{c.empty}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function CatalogTab() {
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
        <p className="muted" style={{ marginTop: 0 }}>
          Define the types of accessories (pipes, connectors, regulators, etc.) sold or installed alongside cylinders.
          Stock per store is managed on the Add / View tabs.
        </p>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
      </div>

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
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Add accessory type</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Default price</th><th>Active</th><th></th></tr>
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
