import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

type Tab = 'open' | 'rules';

type RuleKind = 'DISTRIBUTOR_BALANCE_LOW' | 'DISTRIBUTOR_CREDIT_OVER' | 'STORE_STOCK_LOW' | 'SPECIAL_CLIENT';
type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

interface AlertRule {
  id: string;
  name: string;
  ruleKind: RuleKind;
  threshold: string;
  resourceId: string | null;
  cylinderTypeId: string | null;
  severity: Severity;
  isActive: boolean;
  notes: string | null;
  lastTriggeredAt: string | null;
}

const KIND_LABELS: Record<RuleKind, string> = {
  DISTRIBUTOR_BALANCE_LOW: 'Distributor balance falls below…',
  DISTRIBUTOR_CREDIT_OVER: 'Distributor credit exceeds…',
  STORE_STOCK_LOW: 'Store stock drops below…',
  SPECIAL_CLIENT: 'Special client places an order',
};

const KIND_HELP: Record<RuleKind, string> = {
  DISTRIBUTOR_BALANCE_LOW: 'Threshold is the PKR amount. Raises an alert whenever the picked distributor (or any distributor, if blank) has an advance below this.',
  DISTRIBUTOR_CREDIT_OVER: 'Threshold is the PKR amount of negative balance you tolerate. Raises an alert when their debt is greater than this.',
  STORE_STOCK_LOW: 'Threshold is the minimum number of full cylinders expected. Pick the cylinder type. Optionally restrict to one store.',
  SPECIAL_CLIENT: 'Pick a client. Raises an info alert on every new order from that client.',
};

export function AlertsScreen() {
  const [tab, setTab] = useState<Tab>('open');
  return (
    <>
      <h2>Alerts</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {([
          ['open', '🔔 Open alerts'],
          ['rules', '⚙️ Alert rules'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              borderBottom: tab === id ? '3px solid var(--primary)' : '3px solid transparent',
              fontWeight: tab === id ? 600 : 400,
              color: tab === id ? 'var(--primary)' : 'inherit',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && <OpenAlertsTab />}
      {tab === 'rules' && <RulesTab />}
    </>
  );
}

function OpenAlertsTab() {
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
  const evalNow = useMutation({
    mutationFn: () => api.post('/alert-rules/evaluate'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const sevColor = (sev: string) =>
    ({ INFO: '#0f6cf0', WARNING: '#f59e0b', CRITICAL: '#d33a3a' }[sev] ?? '#888');

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <button onClick={() => setFilter('OPEN')} className={filter === 'OPEN' ? 'primary' : ''}>Open</button>{' '}
          <button onClick={() => setFilter('ALL')} className={filter === 'ALL' ? 'primary' : ''}>All</button>
        </div>
        <button onClick={() => evalNow.mutate()}>↻ Evaluate rules now</button>
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

function RulesTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: async () => (await api.get<AlertRule[]>('/alert-rules')).data,
  });

  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get('/distributors')).data });
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get('/stores')).data });
  const cylinderTypes = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get('/cylinder-types')).data });
  const clients = useQuery({ queryKey: ['clients'], queryFn: async () => (await api.get('/clients')).data });

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    ruleKind: RuleKind;
    thresholdRs: string;
    thresholdCount: string;
    resourceId: string;
    cylinderTypeId: string;
    severity: Severity;
    notes: string;
  }>({
    name: '',
    ruleKind: 'DISTRIBUTOR_BALANCE_LOW',
    thresholdRs: '1000',
    thresholdCount: '5',
    resourceId: '',
    cylinderTypeId: '',
    severity: 'WARNING',
    notes: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const usesRs = form.ruleKind === 'DISTRIBUTOR_BALANCE_LOW' || form.ruleKind === 'DISTRIBUTOR_CREDIT_OVER';
      const threshold = usesRs ? Math.round(Number(form.thresholdRs) * 100) : Math.floor(Number(form.thresholdCount));
      if (!form.name.trim()) throw new Error('Name the rule so you can recognise it later.');
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error('Threshold must be a non-negative number.');
      if (form.ruleKind === 'STORE_STOCK_LOW' && !form.cylinderTypeId) throw new Error('Pick a cylinder type for stock-low rules.');
      if (form.ruleKind === 'SPECIAL_CLIENT' && !form.resourceId) throw new Error('Pick a client for special-client rules.');

      return api.post('/alert-rules', {
        name: form.name,
        ruleKind: form.ruleKind,
        threshold,
        resourceId: form.resourceId || undefined,
        cylinderTypeId: form.cylinderTypeId || undefined,
        severity: form.severity,
        notes: form.notes || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alert-rules'] });
      setShowNew(false);
      setForm({ ...form, name: '', notes: '' });
      setErr(null);
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/alert-rules/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/alert-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  const usesRs = form.ruleKind === 'DISTRIBUTOR_BALANCE_LOW' || form.ruleKind === 'DISTRIBUTOR_CREDIT_OVER';
  const usesDistributor = usesRs;
  const usesStore = form.ruleKind === 'STORE_STOCK_LOW';
  const usesClient = form.ruleKind === 'SPECIAL_CLIENT';

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          Custom rules raise alerts on the Open tab whenever the condition is met.
        </p>
        <button className="primary" onClick={() => setShowNew(true)}>+ New rule</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>What it watches</th><th>Threshold</th><th>Severity</th><th>Last fired</th><th>Active</th><th></th></tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No rules yet. Click "+ New rule" to add one.
              </td></tr>
            )}
            {(data ?? []).map((r) => {
              const usesRsRow = r.ruleKind === 'DISTRIBUTOR_BALANCE_LOW' || r.ruleKind === 'DISTRIBUTOR_CREDIT_OVER';
              const thresholdLabel = usesRsRow
                ? `Rs ${(Number(r.threshold) / 100).toLocaleString()}`
                : `${r.threshold}`;
              return (
                <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                  <td><strong>{r.name}</strong></td>
                  <td>{KIND_LABELS[r.ruleKind]}</td>
                  <td>{thresholdLabel}</td>
                  <td>{r.severity}</td>
                  <td>{r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString() : '—'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      onChange={(e) => toggleActive.mutate({ id: r.id, isActive: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button
                      style={{ color: 'var(--danger)' }}
                      onClick={() => { if (confirmDialog(`Delete rule "${r.name}"?`)) remove.mutate(r.id); }}
                    >Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal title="New alert rule" open={showNew} onClose={() => setShowNew(false)} width={620}>
        <label>Name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='e.g. "Lahore-East stock floor"' />

        <label>What should it watch?</label>
        <select value={form.ruleKind} onChange={(e) => setForm({ ...form, ruleKind: e.target.value as RuleKind })}>
          {(Object.keys(KIND_LABELS) as RuleKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{KIND_HELP[form.ruleKind]}</p>

        {usesRs ? (
          <>
            <label>Threshold (PKR)</label>
            <input type="number" value={form.thresholdRs} onChange={(e) => setForm({ ...form, thresholdRs: e.target.value })} />
          </>
        ) : !usesClient && (
          <>
            <label>Threshold (cylinders)</label>
            <input type="number" value={form.thresholdCount} onChange={(e) => setForm({ ...form, thresholdCount: e.target.value })} />
          </>
        )}

        {usesDistributor && (
          <>
            <label>Distributor (blank = all)</label>
            <select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
              <option value="">— any distributor —</option>
              {(distributors.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.businessName}</option>)}
            </select>
          </>
        )}

        {usesStore && (
          <>
            <label>Store (blank = any active store)</label>
            <select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
              <option value="">— any store —</option>
              {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label>Cylinder type *</label>
            <select value={form.cylinderTypeId} onChange={(e) => setForm({ ...form, cylinderTypeId: e.target.value })}>
              <option value="">— pick a type —</option>
              {(cylinderTypes.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        {usesClient && (
          <>
            <label>Client *</label>
            <select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
              <option value="">— pick a client —</option>
              {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
            </select>
          </>
        )}

        <label>Severity</label>
        <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
          <option value="INFO">INFO</option>
          <option value="WARNING">WARNING</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>

        <label>Notes</label>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="optional internal note" />

        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={() => setShowNew(false)}>Cancel</button>{' '}
          <button className="primary" onClick={() => create.mutate()} disabled={create.isPending}>Create rule</button>
        </div>
      </Modal>
    </>
  );
}
