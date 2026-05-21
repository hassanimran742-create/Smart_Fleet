import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

const STATUS_TONE: Record<string, string> = {
  DELIVERED: 'pill-ok',
  CANCELLED: 'pill-neutral',
  FAILED: 'pill-danger',
};

const TERMINAL = ['DELIVERED', 'CANCELLED', 'FAILED'];

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export function PreviousOrdersScreen() {
  const [since, setSince] = useState(defaultSince(30));
  const [until, setUntil] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>('');

  const { data } = useQuery({
    queryKey: ['orders-previous', status],
    queryFn: async () => {
      if (status) return (await api.get(`/orders/all?status=${status}`)).data;
      const all = await Promise.all(
        TERMINAL.map((s) => api.get(`/orders/all?status=${s}`).then((r) => r.data)),
      );
      return all.flat();
    },
  });

  const filtered = useMemo(() => {
    const sinceMs = new Date(since).getTime();
    const untilMs = new Date(until + 'T23:59:59').getTime();
    return ((data ?? []) as any[])
      .filter((o) => {
        const at = new Date(o.updatedAt ?? o.createdAt).getTime();
        return at >= sinceMs && at <= untilMs;
      })
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
  }, [data, since, until]);

  return (
    <>
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
            <label style={{ margin: 0 }}>Outcome</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All outcomes</option>
              {TERMINAL.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <span className="muted">{filtered.length} order(s) in range</span>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Status</th><th>Distributor</th><th>Client</th>
              <th>Fee (PKR)</th><th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o: any) => (
              <tr key={o.id}>
                <td><code>{o.id.slice(0, 8)}</code></td>
                <td><span className={`pill ${STATUS_TONE[o.status] ?? 'pill-neutral'}`}>{o.status}</span></td>
                <td>{o.distributor?.businessName}</td>
                <td>{o.client?.name}</td>
                <td>{(Number(o.deliveryFeePaisa) / 100).toLocaleString()}</td>
                <td className="muted">{new Date(o.updatedAt ?? o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No orders in this date range.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
