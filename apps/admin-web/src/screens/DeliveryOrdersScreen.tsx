import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  CONFIRMED: 'pill-primary',
  ASSIGNED: 'pill-primary',
  IN_TRANSIT: 'pill-primary',
  DELIVERED: 'pill-ok',
  CANCELLED: 'pill-neutral',
  FAILED: 'pill-danger',
};

export function DeliveryOrdersScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const { data } = useQuery({
    queryKey: ['orders-all', status],
    queryFn: async () => (await api.get(`/orders/all${status ? `?status=${status}` : ''}`)).data,
    refetchInterval: 15000,
  });

  const setOrderStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders-all'] }),
  });

  return (
    <>
      <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }}>
          <option value="">All statuses</option>
          {['PENDING','CONFIRMED','ASSIGNED','IN_TRANSIT','DELIVERED','CANCELLED','FAILED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Status</th><th>Payment</th><th>Distributor</th>
              <th>Client</th><th>Fee (PKR)</th><th>Created</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((o: any) => (
              <tr key={o.id}>
                <td><code>{o.id.slice(0, 8)}</code></td>
                <td><span className={`pill ${STATUS_TONE[o.status] ?? 'pill-neutral'}`}>{o.status}</span></td>
                <td className="muted">{o.paymentStatus}</td>
                <td>{o.distributor?.businessName}</td>
                <td>{o.client?.name}</td>
                <td>{(Number(o.deliveryFeePaisa) / 100).toLocaleString()}</td>
                <td className="muted">{new Date(o.createdAt).toLocaleString()}</td>
                <td>
                  {!['DELIVERED','CANCELLED'].includes(o.status) && (
                    <select onChange={(e) => setOrderStatus.mutate({ id: o.id, status: e.target.value })} defaultValue="">
                      <option value="">change…</option>
                      <option>CONFIRMED</option>
                      <option>IN_TRANSIT</option>
                      <option>DELIVERED</option>
                      <option>CANCELLED</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No delivery orders yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
