import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Payment {
  id: string;
  amountPaisa: string | number;
  provider: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
  proofUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  distributor?: {
    businessName?: string;
    user?: { name?: string; phone?: string };
  };
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  SUCCESS: 'pill-ok',
  FAILED: 'pill-danger',
  REFUNDED: 'pill-neutral',
};

const rs = (paisa: string | number) => `Rs. ${(Number(paisa) / 100).toLocaleString()}`;

export function PaymentsScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('PENDING');
  const [proofView, setProofView] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['payments', status],
    queryFn: async () => {
      const url = status ? `/payments?status=${status}` : '/payments';
      return (await api.get<Payment[]>(url)).data;
    },
    refetchInterval: 20000,
  });

  const verify = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/payments/${id}/verify`, { approve }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payments'] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Verify failed'),
  });

  const rows = data ?? [];

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Payments</h2>
          <p className="muted" style={{ margin: 0 }}>
            Bank-transfer top-ups. Verify a payment to credit the distributor's advance balance. Tap the proof to view the slip.
          </p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="PENDING">Pending (to verify)</option>
          <option value="SUCCESS">Approved</option>
          <option value="FAILED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Distributor</th><th>Amount</th><th>Method</th>
              <th>Proof</th><th>Status</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="muted">{new Date(p.createdAt).toLocaleString()}</td>
                <td>
                  {p.distributor?.businessName ?? '—'}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.distributor?.user?.name} {p.distributor?.user?.phone}
                  </div>
                </td>
                <td><strong>{rs(p.amountPaisa)}</strong></td>
                <td>{p.provider === 'BANK_MANUAL' ? 'Bank transfer' : p.provider}</td>
                <td>
                  {p.proofUrl ? (
                    <button onClick={() => setProofView(p.proofUrl!)}>View slip</button>
                  ) : (
                    <span className="muted">no proof yet</span>
                  )}
                </td>
                <td><span className={`pill ${STATUS_TONE[p.status] ?? 'pill-neutral'}`}>{p.status}</span></td>
                <td style={{ minWidth: 180 }}>
                  {p.status === 'PENDING' ? (
                    <>
                      <button
                        className="primary"
                        disabled={verify.isPending}
                        onClick={() => {
                          if (!window.confirm(`Approve ${rs(p.amountPaisa)} for ${p.distributor?.businessName}? This credits their balance.`)) return;
                          verify.mutate({ id: p.id, approve: true });
                        }}
                      >Approve</button>{' '}
                      <button
                        style={{ color: 'var(--danger)' }}
                        disabled={verify.isPending}
                        onClick={() => {
                          if (!window.confirm('Reject this payment? No balance is credited.')) return;
                          verify.mutate({ id: p.id, approve: false });
                        }}
                      >Reject</button>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No payments in this view.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {proofView && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 18, 27, 0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 24,
          }}
          onClick={() => setProofView(null)}
        >
          <div style={{ maxWidth: '90vw', maxHeight: '90vh', textAlign: 'center' }}>
            <img
              src={proofView}
              alt="Payment proof"
              style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 8, background: 'white' }}
              onClick={(e) => e.stopPropagation()}
            />
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setProofView(null)}>Close</button>{' '}
              <a href={proofView} target="_blank" rel="noreferrer">
                <button>Open in new tab</button>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
