import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface StockRow {
  distributor_id: string;
  distributor_name: string;
  cylinder_type_id: string;
  cylinder_type_code: string;
  cylinder_type_name: string;
  state: 'FULL' | 'EMPTY';
  count: number;
}

export function TransfersScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['transfers'],
    queryFn: async () => (await api.get('/transfers')).data,
    refetchInterval: 30000,
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get('/stores')).data });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });

  const [form, setForm] = useState({
    fromStoreId: '',
    toStoreId: '',
    driverId: '',
    scheduledFor: '',
    notes: '',
    cylinderIds: '',
  });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createOk, setCreateOk] = useState<string | null>(null);

  // From-store stock summary — refetched whenever the source store changes
  const fromStock = useQuery<StockRow[]>({
    queryKey: ['transfer-stock', form.fromStoreId],
    queryFn: async () => form.fromStoreId
      ? (await api.get<StockRow[]>(`/transfers/stock/${form.fromStoreId}`)).data
      : [],
    enabled: !!form.fromStoreId,
  });

  // Pivot stock for display: distributor → type → { full, empty }
  const stockPivot: Record<string, Record<string, { full: number; empty: number }>> = {};
  for (const r of fromStock.data ?? []) {
    stockPivot[r.distributor_name] ??= {};
    stockPivot[r.distributor_name][r.cylinder_type_name] ??= { full: 0, empty: 0 };
    stockPivot[r.distributor_name][r.cylinder_type_name][r.state === 'FULL' ? 'full' : 'empty'] += r.count;
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.fromStoreId || !form.toStoreId) throw new Error('Pick both source and destination stores.');
      if (form.fromStoreId === form.toStoreId) throw new Error('Source and destination must be different.');
      const cylinderIds = form.cylinderIds.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
      if (cylinderIds.length === 0) throw new Error('Add at least one cylinder ID or QR.');
      return api.post('/transfers', {
        fromStoreId: form.fromStoreId,
        toStoreId: form.toStoreId,
        driverId: form.driverId || undefined,
        scheduledFor: form.scheduledFor || undefined,
        notes: form.notes || undefined,
        cylinderIds,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfers'] });
      setForm({ fromStoreId: '', toStoreId: '', driverId: '', scheduledFor: '', notes: '', cylinderIds: '' });
      setCreateErr(null);
      setCreateOk('Transfer scheduled. The driver will see it in their app.');
    },
    onError: (e: any) => {
      setCreateErr(e?.response?.data?.message ?? e?.message ?? 'Failed');
      setCreateOk(null);
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/transfers/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
  });

  const availableDrivers = (drivers.data ?? []).filter(
    (d: any) => d.user.status !== 'SUSPENDED' && d.availability !== 'ON_LEAVE',
  );

  return (
    <>
      <h2>Inventory roll plan</h2>
      <p className="muted">
        Rebalance cylinders between stores. Pick the source store to see exactly what's in stock, then
        assign a driver + date — they'll see it as a task in the driver app.
      </p>

      <div className="card">
        <h3>Schedule a transfer</h3>

        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>From store *</label>
            <select
              value={form.fromStoreId}
              onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}
            >
              <option value="">— pick a store —</option>
              {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>To store *</label>
            <select
              value={form.toStoreId}
              onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}
            >
              <option value="">— pick a store —</option>
              {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {form.fromStoreId && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-soft)', borderRadius: 8 }}>
            <strong>Current stock at source store</strong>
            {Object.keys(stockPivot).length === 0 ? (
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>No stock at this store yet.</p>
            ) : (
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Distributor</th><th>Type</th><th>Full</th><th>Empty</th></tr></thead>
                <tbody>
                  {Object.entries(stockPivot).map(([d, types]) =>
                    Object.entries(types).map(([t, c], i) => (
                      <tr key={`${d}-${t}`}>
                        <td>{i === 0 ? d : ''}</td>
                        <td>{t}</td>
                        <td><strong>{c.full}</strong></td>
                        <td>{c.empty}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="flex" style={{ gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Assign driver</label>
            <select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
              <option value="">— unassigned —</option>
              {availableDrivers.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.user.name} {d.currentVehicle?.plateNo ? `· ${d.currentVehicle.plateNo}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Scheduled date</label>
            <input
              type="date"
              value={form.scheduledFor}
              onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
            />
          </div>
        </div>

        <label style={{ marginTop: 12 }}>Cylinder IDs / QR codes (one per line or comma-separated) *</label>
        <textarea
          rows={4}
          value={form.cylinderIds}
          onChange={(e) => setForm({ ...form, cylinderIds: e.target.value })}
          placeholder="uuid-1234..., or scanned QR strings, one per line"
        />

        <label>Notes</label>
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder='e.g. "Pre-stock Lahore-East for the weekend rush"'
        />

        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        {createOk && <p style={{ color: 'var(--ok)' }}>{createOk}</p>}

        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Scheduling…' : 'Schedule transfer'}
        </button>
      </div>

      <div className="card">
        <h3>Scheduled & recent transfers</h3>
        <table>
          <thead>
            <tr>
              <th>From</th><th>To</th><th>Driver</th><th>Scheduled</th>
              <th>Status</th><th>Cylinders</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((t: any) => (
              <tr key={t.id}>
                <td>{t.fromStore?.name}</td>
                <td>{t.toStore?.name}</td>
                <td>{t.driver?.user?.name ?? <span className="muted">— unassigned —</span>}</td>
                <td>{t.scheduledFor ? new Date(t.scheduledFor).toLocaleDateString() : '—'}</td>
                <td>{t.status}</td>
                <td>{t.lines?.length ?? 0}</td>
                <td>
                  {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                    <select value={t.status} onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value })}>
                      <option value="REQUESTED">REQUESTED</option>
                      <option value="IN_TRANSIT">IN_TRANSIT</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No transfers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
