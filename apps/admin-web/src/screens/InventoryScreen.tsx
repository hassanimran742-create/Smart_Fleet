import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Store { id: string; name: string }
interface Distributor { id: string; businessName: string }
interface CylinderType { id: string; code: string; name: string }
interface Accessory {
  id: string; code: string; name: string; category: string; unit: string;
  defaultPricePaisa: string;
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

export function InventoryScreen() {
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Store[]>('/stores')).data });
  const [storeId, setStoreId] = useState<string>('');

  return (
    <>
      <h2>Inventory</h2>
      <div className="card">
        <label>Pick a store</label>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">— pick a store —</option>
          {(stores.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {(stores.data ?? []).length === 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            No stores yet. Create one on the Stores page first.
          </p>
        )}
      </div>

      {storeId ? (
        <>
          <CylindersSection storeId={storeId} qc={qc} />
          <AccessoriesSection storeId={storeId} qc={qc} />
        </>
      ) : (
        <AllStoresOverview />
      )}
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

interface CylinderTypeFull { id: string; code: string; name: string; weightKg: string; capacityUnits: number }

function CylindersSection({ storeId, qc }: { storeId: string; qc: any }) {
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<Distributor[]>('/distributors')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderTypeFull[]>('/cylinder-types')).data });

  const cylinderInv = useQuery({
    queryKey: ['inventory-by-store-filtered', storeId],
    queryFn: async () => {
      const all = (await api.get<ByStoreRow[]>('/inventory/by-store')).data;
      return all.filter((r) => r.store_id === storeId);
    },
    refetchInterval: 30000,
  });

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
      qc.invalidateQueries({ queryKey: ['inventory-by-store-filtered'] });
      qc.invalidateQueries({ queryKey: ['inventory-by-store-all'] });
      const count = Array.isArray(r.data) ? r.data.length : 0;
      setResult(`${count} cylinder(s) registered at this store.`);
      setErr(null);
      setForm({ ...form, quantity: '' });
    },
    onError: (e: any) => {
      setErr(e?.response?.data?.message ?? e?.message ?? 'Failed');
      setResult(null);
    },
  });

  const pivot: Record<string, Record<string, { full: number; empty: number }>> = {};
  for (const r of cylinderInv.data ?? []) {
    pivot[r.distributor_name] ??= {};
    pivot[r.distributor_name][r.cylinder_type_code] ??= { full: 0, empty: 0 };
    pivot[r.distributor_name][r.cylinder_type_code][r.state === 'FULL' ? 'full' : 'empty'] += r.count;
  }

  return (
    <>
      <div className="card">
        <h3>Add cylinders to this store</h3>
        <p className="muted">
          Bulk-register cylinders by quantity. Each one gets an auto-generated serial QR (e.g.{' '}
          <code>LPG_11_8KG-7G4F9C2A</code>) which you can print as a sticker later. They land FULL and held at this store, owned by the picked distributor.
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
                <option key={t.id} value={t.id}>
                  {t.name} · {Number(t.weightKg).toString()} kg
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Quantity *</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="e.g. 100"
            />
          </div>
        </div>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        {result && <p style={{ color: 'var(--ok)' }}>{result}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => register.mutate()}>
          Register cylinders
        </button>
      </div>

      <div className="card">
        <h3>Cylinders currently at this store</h3>
        {Object.keys(pivot).length === 0 && <p className="muted">No cylinders yet at this store.</p>}
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
    </>
  );
}

function AccessoriesSection({ storeId, qc }: { storeId: string; qc: any }) {
  const accessories = useQuery({
    queryKey: ['accessories'],
    queryFn: async () => (await api.get<Accessory[]>('/accessories')).data,
  });
  const stock = useQuery({
    queryKey: ['accessory-stock', storeId],
    queryFn: async () => (await api.get<AccessoryStockRow[]>(`/accessories/stock/store/${storeId}`)).data,
    refetchInterval: 30000,
  });
  const movements = useQuery({
    queryKey: ['accessory-movements', storeId],
    queryFn: async () => (await api.get(`/accessories/movements/store/${storeId}`)).data,
  });

  const [form, setForm] = useState({
    accessoryId: '',
    delta: '0',
    reason: 'RECEIPT' as typeof REASONS[number],
    note: '',
    unitPriceRs: '',
  });
  const [err, setErr] = useState<string | null>(null);

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
      qc.invalidateQueries({ queryKey: ['accessory-stock', storeId] });
      qc.invalidateQueries({ queryKey: ['accessory-movements', storeId] });
      setForm({ ...form, delta: '0', note: '', unitPriceRs: '' });
      setErr(null);
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
  });

  return (
    <>
      <div className="card">
        <h3>Add or adjust accessory stock</h3>
        <p className="muted">
          Pick an accessory and enter a quantity. Positive numbers add stock (e.g. receiving a shipment). Negative numbers reduce stock (sales, damage, transfer out).
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
        <button className="primary" style={{ marginTop: 12 }} onClick={() => adjust.mutate()}>Apply</button>
      </div>

      <div className="card">
        <h3>Accessory stock at this store</h3>
        {(stock.data ?? []).length === 0 && <p className="muted">No accessory stock yet at this store.</p>}
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
      </div>

      <div className="card">
        <h3>Recent accessory movements</h3>
        {(movements.data ?? []).length === 0 && <p className="muted">No movements yet.</p>}
        <table>
          <thead><tr><th>When</th><th>Accessory</th><th>Δ</th><th>Reason</th><th>Note</th></tr></thead>
          <tbody>
            {(movements.data ?? []).slice(0, 50).map((m: any) => (
              <tr key={m.id}>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td>{m.accessory.name}</td>
                <td style={{ color: m.delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                  {m.delta > 0 ? '+' : ''}{m.delta}
                </td>
                <td>{m.reason}</td>
                <td>{m.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
