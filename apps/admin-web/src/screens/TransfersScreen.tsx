import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function TransfersScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['transfers'],
    queryFn: async () => (await api.get('/transfers')).data,
    refetchInterval: 30000,
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get('/stores')).data });

  const [form, setForm] = useState({ fromStoreId: '', toStoreId: '', cylinderIds: '' });
  const create = useMutation({
    mutationFn: () =>
      api.post('/transfers', {
        fromStoreId: form.fromStoreId,
        toStoreId: form.toStoreId,
        cylinderIds: form.cylinderIds
          .split(/[,\s\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfers'] });
      setForm({ fromStoreId: '', toStoreId: '', cylinderIds: '' });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/transfers/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
  });

  return (
    <>
      <h2>Inventory roll plan</h2>
      <p className="muted">
        Rebalance cylinders between stores so each zone has the right stock before orders peak.
      </p>

      <div className="card">
        <h3>Request a transfer</h3>
        <label>From store</label>
        <select value={form.fromStoreId} onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}>
          <option value="">— pick a store —</option>
          {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label>To store</label>
        <select value={form.toStoreId} onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}>
          <option value="">— pick a store —</option>
          {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label>Cylinder IDs (one per line, or comma-separated)</label>
        <textarea
          rows={4}
          value={form.cylinderIds}
          onChange={(e) => setForm({ ...form, cylinderIds: e.target.value })}
          placeholder="uuid1, uuid2, ..."
        />
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>
          Request
        </button>
      </div>

      <div className="card">
        <h3>Recent transfers</h3>
        <table>
          <thead><tr><th>From</th><th>To</th><th>Status</th><th>Cylinders</th><th></th></tr></thead>
          <tbody>
            {(data ?? []).map((t: any) => (
              <tr key={t.id}>
                <td>{t.fromStore?.name}</td>
                <td>{t.toStore?.name}</td>
                <td>{t.status}</td>
                <td>{t.lines?.length ?? 0}</td>
                <td>
                  {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                    <select
                      value={t.status}
                      onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value })}
                    >
                      <option value="REQUESTED">REQUESTED</option>
                      <option value="IN_TRANSIT">IN_TRANSIT</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
