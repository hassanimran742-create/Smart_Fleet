import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { confirmDialog } from '../components/Modal';

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  CONFIRMED: 'pill-primary',
  ASSIGNED: 'pill-primary',
  IN_TRANSIT: 'pill-primary',
};

const ACTIVE = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT'];
// Statuses for which "Assign driver" is still meaningful (not yet en-route).
const ASSIGNABLE = new Set(['PENDING', 'CONFIRMED', 'ASSIGNED']);

interface DriverRow {
  id: string;
  isOnline?: boolean;
  availability?: string;
  currentVehicleId?: string | null;
  user?: { name?: string; phone?: string };
}
interface StoreRow { id: string; name?: string; is_active?: boolean }

export function CurrentOrdersScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const [assignFor, setAssignFor] = useState<string | null>(null); // orderId being assigned
  const [pickDriver, setPickDriver] = useState('');
  const [pickStore, setPickStore] = useState('');

  const { data } = useQuery({
    queryKey: ['orders-current', status],
    queryFn: async () => {
      if (status) {
        return (await api.get(`/orders/all?status=${status}`)).data;
      }
      const all = await Promise.all(
        ACTIVE.map((s) => api.get(`/orders/all?status=${s}`).then((r) => r.data)),
      );
      return all.flat().sort((a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    refetchInterval: 15000,
  });

  const drivers = useQuery({
    queryKey: ['drivers-for-assign'],
    queryFn: async () => (await api.get<DriverRow[]>('/drivers')).data,
  });
  const stores = useQuery({
    queryKey: ['stores-for-assign'],
    queryFn: async () => (await api.get<StoreRow[]>('/stores')).data,
  });

  const confirmOrder = useMutation({
    mutationFn: (id: string) => api.patch(`/orders/${id}/status`, { status: 'CONFIRMED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders-current'] }),
  });
  const cancelOrder = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/orders/${id}/status`, { status: 'CANCELLED', reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders-current'] }),
  });
  const assignDriver = useMutation({
    mutationFn: ({ orderId, driverId, originStoreId }: { orderId: string; driverId: string; originStoreId?: string }) =>
      api.post(`/orders/${orderId}/assign-driver`, { driverId, originStoreId: originStoreId || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders-current'] });
      setAssignFor(null);
      setPickDriver('');
      setPickStore('');
    },
    onError: (e: any) => {
      alert(e?.response?.data?.message ?? 'Assignment failed');
    },
  });
  // Trigger auto-dispatch (the scoring algorithm) for an order. Useful when
  // the operator wants the system to pick the best driver/store, but only if
  // drivers are online + locations known + inventory present.
  const runDispatch = useMutation({
    mutationFn: (orderId: string) =>
      api.post('/dispatch/manual', { orderId }).then((r) => r.data),
    onSuccess: (res: any) => {
      if (res?.error) {
        alert(`Auto-dispatch could not find a driver: ${res.error}.\n\nCommon reasons:\n• No drivers online (driver app: toggle ON DUTY)\n• Online driver has no vehicle assigned\n• No store has the required cylinder stock\n\nUse "Assign driver…" to assign manually instead.`);
      } else if (res?.tripId) {
        qc.invalidateQueries({ queryKey: ['orders-current'] });
      }
    },
    onError: (e: any) => {
      alert(e?.response?.data?.message ?? 'Dispatch failed');
    },
  });

  function driverLabel(d: DriverRow) {
    const name = d.user?.name ?? '—';
    const phone = d.user?.phone ?? '';
    const flags: string[] = [];
    if (d.isOnline) flags.push('🟢 online');
    if (!d.currentVehicleId) flags.push('⚠ no vehicle');
    if (d.availability && d.availability !== 'AVAILABLE') flags.push(d.availability);
    return `${name} ${phone}${flags.length ? '  ·  ' + flags.join(', ') : ''}`;
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Active orders only. Use <strong>Assign driver…</strong> to pick a driver manually, or <strong>Auto-dispatch</strong> to let the system score the best one.
          Drivers can only see orders that have been assigned (a Trip exists for them).
        </p>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }}>
          <option value="">All active</option>
          {ACTIVE.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Status</th><th>Distributor</th><th>Client</th>
              <th>Driver</th><th>Created</th><th>Admin actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((o: any) => (
              <tr key={o.id}>
                <td><code>{o.id.slice(0, 8)}</code></td>
                <td><span className={`pill ${STATUS_TONE[o.status] ?? 'pill-neutral'}`}>{o.status}</span></td>
                <td>{o.distributor?.businessName}</td>
                <td>{o.client?.name}</td>
                <td>{o.trip?.driverId ? <code>{o.trip.driverId.slice(0, 8)}</code> : <span className="muted">—</span>}</td>
                <td className="muted">{new Date(o.createdAt).toLocaleString()}</td>
                <td style={{ minWidth: 280 }}>
                  {o.status === 'PENDING' && (
                    <>
                      <button
                        className="primary"
                        title="Confirm — used for partial-cylinder availability approvals"
                        onClick={() => { if (confirmDialog('Confirm this order?')) confirmOrder.mutate(o.id); }}
                      >Confirm</button>{' '}
                    </>
                  )}
                  {ASSIGNABLE.has(o.status) && (
                    <>
                      <button
                        onClick={() => { setAssignFor(o.id); setPickDriver(''); setPickStore(''); }}
                      >Assign driver…</button>{' '}
                      <button
                        title="Run scoring algorithm — needs online drivers + matching stock"
                        onClick={() => runDispatch.mutate(o.id)}
                      >Auto-dispatch</button>{' '}
                    </>
                  )}
                  <button
                    style={{ color: 'var(--danger)' }}
                    onClick={() => {
                      if (!confirmDialog('Cancel this order?')) return;
                      const reason = window.prompt('Cancellation reason') ?? '';
                      cancelOrder.mutate({ id: o.id, reason });
                    }}
                  >Cancel</button>
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No active orders.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {assignFor && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 18, 27, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setAssignFor(null); }}
        >
          <div className="card" style={{ width: 420, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Assign driver</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Order <code>{assignFor.slice(0, 8)}</code>. We'll create a trip with one pickup + one delivery stop.
            </p>

            <label>Driver</label>
            <select value={pickDriver} onChange={(e) => setPickDriver(e.target.value)}>
              <option value="">— pick a driver —</option>
              {(drivers.data ?? []).map((d) => (
                <option key={d.id} value={d.id} disabled={!d.currentVehicleId}>
                  {driverLabel(d)}
                </option>
              ))}
            </select>
            {(drivers.data ?? []).every((d) => !d.currentVehicleId) && (
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                ⚠ No driver has a vehicle assigned. Go to <em>Vehicles → Assign drivers</em> first.
              </p>
            )}

            <label style={{ marginTop: 12 }}>Origin store (optional)</label>
            <select value={pickStore} onChange={(e) => setPickStore(e.target.value)}>
              <option value="">— auto-pick first active store —</option>
              {(stores.data ?? []).filter((s) => s.is_active !== false).map((s) => (
                <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>
              ))}
            </select>

            <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAssignFor(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!pickDriver || assignDriver.isPending}
                onClick={() => assignDriver.mutate({ orderId: assignFor, driverId: pickDriver, originStoreId: pickStore })}
              >{assignDriver.isPending ? 'Assigning…' : 'Assign'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
