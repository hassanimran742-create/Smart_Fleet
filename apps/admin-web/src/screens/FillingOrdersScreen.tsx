import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  ASSIGNED: 'pill-primary',
  EMPTIES_PICKED: 'pill-primary',
  AT_STATION: 'pill-primary',
  FILLED: 'pill-primary',
  RETURNED: 'pill-primary',
  COMPLETED: 'pill-ok',
  CANCELLED: 'pill-neutral',
  FAILED: 'pill-danger',
};

export function FillingOrdersScreen() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data } = useQuery({
    queryKey: ['filling-orders', statusFilter],
    queryFn: async () =>
      (await api.get(`/filling-orders${statusFilter ? `?status=${statusFilter}` : ''}`)).data,
    refetchInterval: 15000,
  });
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get('/distributors')).data });
  const stations = useQuery({ queryKey: ['filling-stations'], queryFn: async () => (await api.get('/filling-stations')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get('/cylinder-types')).data });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });

  const [form, setForm] = useState({ distributorId: '', fillingStationId: '', cylinderTypeId: '', requestedCount: '20' });
  const [createErr, setCreateErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post('/filling-orders', {
      distributorId: form.distributorId,
      fillingStationId: form.fillingStationId,
      cylinderTypeId: form.cylinderTypeId,
      requestedCount: Number(form.requestedCount),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filling-orders'] });
      setForm({ distributorId: '', fillingStationId: '', cylinderTypeId: '', requestedCount: '20' });
      setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
  });

  const [assignFor, setAssignFor] = useState<any>(null);
  const [assignDriverId, setAssignDriverId] = useState('');

  const assign = useMutation({
    mutationFn: () => api.patch(`/filling-orders/${assignFor.id}/assign`, { driverId: assignDriverId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['filling-orders'] }); setAssignFor(null); setAssignDriverId(''); },
  });
  const complete = useMutation({
    mutationFn: (id: string) => api.patch(`/filling-orders/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filling-orders'] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.patch(`/filling-orders/${id}/cancel`, { reason: 'admin cancellation' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filling-orders'] }),
  });

  const availableDrivers = (drivers.data ?? []).filter((d: any) => d.availability === 'AVAILABLE');

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Filling orders</h2>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 200 }}>
          <option value="">All statuses</option>
          {['PENDING','ASSIGNED','EMPTIES_PICKED','AT_STATION','FILLED','RETURNED','COMPLETED','CANCELLED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <p className="muted">
        Refill runs: driver picks empties from the distributor's store, drives to the filling station, returns filled cylinders. Distributor pays per cylinder.
      </p>

      <div className="card">
        <h3>Place a filling order</h3>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Distributor *</label>
            <select value={form.distributorId} onChange={(e) => setForm({ ...form, distributorId: e.target.value })}>
              <option value="">— pick —</option>
              {(distributors.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.businessName} (Rs. {Number(d.advanceBalancePaisa)/100})</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Filling station *</label>
            <select value={form.fillingStationId} onChange={(e) => setForm({ ...form, fillingStationId: e.target.value })}>
              <option value="">— pick —</option>
              {(stations.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name} · Rs. {Number(s.price_per_cylinder_paisa)/100}/cyl</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Cylinder type *</label>
            <select value={form.cylinderTypeId} onChange={(e) => setForm({ ...form, cylinderTypeId: e.target.value })}>
              <option value="">— pick —</option>
              {(types.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ width: 140 }}>
            <label>Quantity *</label>
            <input type="number" value={form.requestedCount} onChange={(e) => setForm({ ...form, requestedCount: e.target.value })} />
          </div>
        </div>
        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create filling order</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Distributor</th><th>Station</th><th>Type</th><th>Qty (req/filled)</th>
              <th>Cost (PKR)</th><th>Driver</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((o: any) => (
              <tr key={o.id}>
                <td><code>{o.id.slice(0, 8)}</code></td>
                <td>{o.distributor?.businessName}</td>
                <td>{o.fillingStation?.name}</td>
                <td>{o.cylinderType?.code}</td>
                <td>{o.requestedCount}{o.filledCount != null ? ` / ${o.filledCount}` : ''}</td>
                <td>{(Number(o.totalCostPaisa) / 100).toLocaleString()}</td>
                <td>{o.assignedDriver?.user?.name ?? <span className="muted">—</span>}</td>
                <td><span className={`pill ${STATUS_TONE[o.status] ?? 'pill-neutral'}`}>{o.status}</span></td>
                <td>
                  {o.status === 'PENDING' && (
                    <button className="primary" onClick={() => setAssignFor(o)}>Assign</button>
                  )}{' '}
                  {o.status === 'RETURNED' && (
                    <button className="primary" onClick={() => complete.mutate(o.id)}>Complete + debit</button>
                  )}{' '}
                  {!['COMPLETED','CANCELLED','FAILED'].includes(o.status) && (
                    <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog('Cancel this filling order?')) cancel.mutate(o.id); }}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No filling orders yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal title="Assign driver" open={!!assignFor} onClose={() => setAssignFor(null)} width={480}>
        {assignFor && (
          <>
            <p className="muted">
              Order: <strong>{assignFor.requestedCount} × {assignFor.cylinderType?.code}</strong> for{' '}
              <strong>{assignFor.distributor?.businessName}</strong>, station <strong>{assignFor.fillingStation?.name}</strong>.
            </p>
            <label>Driver (only AVAILABLE drivers shown)</label>
            <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)}>
              <option value="">— pick a driver —</option>
              {availableDrivers.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.user?.name} · {d.currentVehicle?.plateNo ?? 'no vehicle'} · {d.isOnline ? 'online' : 'offline'}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setAssignFor(null)}>Cancel</button>{' '}
              <button className="primary" disabled={!assignDriverId} onClick={() => assign.mutate()}>Assign</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
