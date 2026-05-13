import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function AlertsScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const { data } = useQuery({
    queryKey: ['alerts', filter],
    queryFn: async () => {
      const url = filter === 'OPEN' ? '/alerts?status=OPEN' : '/alerts';
      return (await api.get(url)).data;
    },
    refetchInterval: 15000,
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const sevColor = (sev: string) =>
    ({ INFO: '#0f6cf0', WARNING: '#f59e0b', CRITICAL: '#d33a3a' }[sev] ?? '#888');

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Alerts</h2>
        <div>
          <button onClick={() => setFilter('OPEN')} className={filter === 'OPEN' ? 'primary' : ''}>Open</button>{' '}
          <button onClick={() => setFilter('ALL')} className={filter === 'ALL' ? 'primary' : ''}>All</button>
        </div>
      </div>
      {(data ?? []).length === 0 && (
        <div className="card"><p className="muted">No alerts.</p></div>
      )}
      {(data ?? []).map((a: any) => (
        <div className="card" key={a.id}>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong style={{ color: sevColor(a.severity) }}>● {a.severity}</strong>
              <span style={{ marginLeft: 8, color: '#888' }}>{a.alertType}</span>
              <h3 style={{ margin: '4px 0' }}>{a.title}</h3>
              <p>{a.body}</p>
              <p className="muted">
                {a.resourceType && a.resourceId && `Resource: ${a.resourceType} ${a.resourceId.slice(0, 8)} · `}
                {new Date(a.createdAt).toLocaleString()} · status: {a.status}
              </p>
            </div>
            <div>
              {a.status === 'OPEN' && (
                <button onClick={() => ack.mutate(a.id)} style={{ marginRight: 8 }}>Ack</button>
              )}
              {a.status !== 'RESOLVED' && (
                <button className="primary" onClick={() => resolve.mutate(a.id)}>Resolve</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
