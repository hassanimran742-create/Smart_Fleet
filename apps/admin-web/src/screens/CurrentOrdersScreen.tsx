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

export function CurrentOrdersScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('');

  const { data } = useQuery({
    queryKey: ['orders-current', status],
    queryFn: async () => {
      if (status) {
        return (await api.get(`/orders/all?status=${status}`)).data;
      }
      // No specific status filter — fetch every active status and merge
      const all = await Promise.all(
        ACTIVE.map((s) => api.get(`/orders/all?status=${s}`).then((r) => r.data)),
      );
      return all.flat().sort((a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    refetchInterval: 15000,
  });

  // CONFIRM via admin (special approval) — only allowed from PENDING
  const confirmOrder = useMutation({
    mutationFn: (id: string) => api.patch(`/orders/${id}/status`, { status: 'CONFIRMED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders-current'] }),
  });
  // CANCEL — admin only
  const cancelOrder = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/orders/${id}/status`, { status: 'CANCELLED', reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders-current'] }),
  });

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Active orders only. Driver marks IN_TRANSIT / DELIVERED in the mobile app. Admin manually CONFIRMS partial-availability cases and CANCELS orders.
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
                <td>
                  {o.status === 'PENDING' && (
                    <button
                      className="primary"
                      title="Confirm — used for partial-cylinder availability approvals"
                      onClick={() => { if (confirmDialog('Confirm this order?')) confirmOrder.mutate(o.id); }}
                    >Confirm</button>
                  )}{' '}
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
    </>
  );
}
