import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Modal } from '../components/Modal';
import { translateDynamic } from '../i18n';
import { formatDateTime, formatRs } from '../i18n/format';
import { actionInWords, Button, StatusChip, useConfirm, useToast } from '../ui';
import './legacy.css';

/**
 * Legacy Alerts screen, kept inside the shell for Inc 1 (UX_ADMIN §2.11). Touched for §2.11:
 * ConfirmDialog instead of browser pop-ups, no emoji, chips and plain words instead of raw values and id
 * fragments, money as "Rs 3,450", and every failure shown. The retired "credit exceeds" rule kind can't be
 * created any more (balances can't go negative; API_CONTRACT §7.2).
 */

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
  DISTRIBUTOR_BALANCE_LOW: 'The threshold is an amount in rupees. Raises an alert whenever the picked distributor (or any distributor, if left blank) has a balance below it.',
  DISTRIBUTOR_CREDIT_OVER: 'No longer used: a balance can never go below zero.',
  STORE_STOCK_LOW: 'The threshold is the smallest number of full cylinders expected. Pick the cylinder size, and optionally one store.',
  SPECIAL_CLIENT: 'Pick a customer. Raises an alert on every new order from that customer.',
};

/** Rule kinds that can still be created (DISTRIBUTOR_CREDIT_OVER is retired). */
const CREATABLE_KINDS: RuleKind[] = ['DISTRIBUTOR_BALANCE_LOW', 'STORE_STOCK_LOW', 'SPECIAL_CLIENT'];
const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'CRITICAL'];

/** "Info", "Warning", "Urgent" (the website's `status:severity` words). */
function severityWords(severity: string): string {
  return translateDynamic(`status:severity.${severity}`) ?? actionInWords(severity);
}

interface AlertRow {
  id: string;
  alertType: string;
  severity: string;
  status: string;
  title: string;
  body: string | null;
  createdAt: string;
}

export function AlertsScreen() {
  const [tab, setTab] = useState<Tab>('open');
  return (
    <>
      <h2>Alerts</h2>
      <div role="tablist" aria-label="Alert views" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {([
          ['open', 'Open alerts'],
          ['rules', 'Alert rules'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
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
  const toast = useToast();
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['alerts', filter],
    queryFn: async () => {
      const url = filter === 'OPEN' ? '/alerts?status=OPEN' : '/alerts';
      return (await api.get<AlertRow[]>(url)).data;
    },
    refetchInterval: 15000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['alerts'] });
    void qc.invalidateQueries({ queryKey: ['alerts-unread'] });
  };
  const ack = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`),
    onSuccess: refresh,
    onError: (e) => toast.error(e),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/resolve`),
    onSuccess: () => {
      toast.success('Alert marked as sorted.');
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const evalNow = useMutation({
    mutationFn: () => api.post('/alert-rules/evaluate'),
    onSuccess: () => {
      toast.success('Rules checked.');
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <button onClick={() => setFilter('OPEN')} className={filter === 'OPEN' ? 'primary' : ''}>Open</button>{' '}
          <button onClick={() => setFilter('ALL')} className={filter === 'ALL' ? 'primary' : ''}>All</button>
        </div>
        <Button icon={RotateCw} onClick={() => evalNow.mutate()} loading={evalNow.isPending}>
          Check the rules now
        </Button>
      </div>
      {isPending && (
        <div className="card"><p className="muted">Loading alerts…</p></div>
      )}
      {isError && (
        <div className="card">
          <p style={{ color: 'var(--danger-fg)' }}>{messageFor(error)}</p>
          <button onClick={() => void refetch()}>Try again</button>
        </div>
      )}
      {!isPending && !isError && (data ?? []).length === 0 && (
        <div className="card">
          <p className="muted">{filter === 'OPEN' ? 'No open alerts. New alerts show up here by themselves.' : 'No alerts yet.'}</p>
        </div>
      )}
      {(data ?? []).map((a) => (
        <div className="card" key={a.id}>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusChip kind="severity" value={a.severity} />
                <StatusChip kind="alert" value={a.status} />
                <span className="muted">{actionInWords(a.alertType)}</span>
              </div>
              <h3 style={{ margin: '4px 0' }}>{a.title}</h3>
              {a.body ? <p>{a.body}</p> : null}
              <p className="muted">{formatDateTime(a.createdAt)}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {a.status === 'OPEN' && (
                <button onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>Mark as seen</button>
              )}
              {a.status !== 'RESOLVED' && (
                <button className="primary" onClick={() => resolve.mutate(a.id)} disabled={resolve.isPending}>Mark as sorted</button>
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
  const confirm = useConfirm();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: async () => (await api.get<AlertRule[]>('/alert-rules')).data,
  });

  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<DistributorDto[]>('/distributors')).data });
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Array<{ id: string; name: string }>>('/stores')).data });
  const cylinderTypes = useQuery({
    queryKey: ['cylinder-types'],
    queryFn: async () => (await api.get<Array<{ id: string; name: string }>>('/cylinder-types')).data,
  });
  // The office reads one distributor's customers at a time (API_CONTRACT §7.4: `?distributorId=` is required).
  const [clientShopId, setClientShopId] = useState('');
  const clients = useQuery({
    queryKey: ['clients', clientShopId],
    queryFn: async () =>
      (await api.get<Array<{ id: string; name: string; phone?: string }>>('/clients', { params: { distributorId: clientShopId } })).data,
    enabled: Boolean(clientShopId),
  });

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
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error('The threshold must be 0 or more.');
      if (form.ruleKind === 'STORE_STOCK_LOW' && !form.cylinderTypeId) throw new Error('Pick a cylinder size for a stock rule.');
      if (form.ruleKind === 'SPECIAL_CLIENT' && !form.resourceId) throw new Error('Pick the customer.');

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
      toast.success('Rule added.');
      setShowNew(false);
      setForm({ ...form, name: '', notes: '' });
      setErr(null);
    },
    onError: (e: unknown) => setErr(e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e)),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/alert-rules/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
    onError: (e) => toast.error(e),
  });

  async function removeRule(r: AlertRule) {
    const { ok } = await confirm({
      title: `Delete the rule ${r.name}?`,
      body: 'It stops raising alerts. Alerts it already raised stay.',
      tone: 'danger',
      confirmLabel: 'Delete rule',
      action: () => api.delete(`/alert-rules/${r.id}`),
    });
    if (!ok) return;
    toast.success('Rule deleted.');
    void qc.invalidateQueries({ queryKey: ['alert-rules'] });
  }

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
        <button className="primary" onClick={() => setShowNew(true)}>New rule</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>What it watches</th><th>Threshold</th><th>Severity</th><th>Last raised</th><th>On</th><th aria-label="Actions"></th></tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No rules yet. Use New rule to add one.
              </td></tr>
            )}
            {(data ?? []).map((r) => {
              const usesRsRow = r.ruleKind === 'DISTRIBUTOR_BALANCE_LOW' || r.ruleKind === 'DISTRIBUTOR_CREDIT_OVER';
              const thresholdLabel = usesRsRow ? formatRs(r.threshold) : `${r.threshold}`;
              return (
                <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                  <td><strong>{r.name}</strong></td>
                  <td>{KIND_LABELS[r.ruleKind]}</td>
                  <td>{thresholdLabel}</td>
                  <td><StatusChip kind="severity" value={r.severity} /></td>
                  <td>{r.lastTriggeredAt ? formatDateTime(r.lastTriggeredAt) : '—'}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Rule ${r.name} on`}
                      checked={r.isActive}
                      disabled={r.ruleKind === 'DISTRIBUTOR_CREDIT_OVER' && !r.isActive}
                      onChange={(e) => toggleActive.mutate({ id: r.id, isActive: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button style={{ color: 'var(--danger-fg)' }} onClick={() => void removeRule(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal title="New alert rule" open={showNew} onClose={() => setShowNew(false)} width={620}>
        <label>Name *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="For example Lahore East stock floor" />

        <label>What should it watch?</label>
        <select value={form.ruleKind} onChange={(e) => setForm({ ...form, ruleKind: e.target.value as RuleKind, resourceId: '' })}>
          {CREATABLE_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{KIND_HELP[form.ruleKind]}</p>

        {usesRs ? (
          <>
            <label>Threshold (Rs)</label>
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
            <label>Distributor (leave blank for all)</label>
            <select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
              <option value="">Any distributor</option>
              {(distributors.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.businessName}</option>)}
            </select>
          </>
        )}

        {usesStore && (
          <>
            <label>Store (leave blank for any store)</label>
            <select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
              <option value="">Any store</option>
              {(stores.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label>Cylinder size *</label>
            <select value={form.cylinderTypeId} onChange={(e) => setForm({ ...form, cylinderTypeId: e.target.value })}>
              <option value="">Pick a size</option>
              {(cylinderTypes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        {usesClient && (
          <>
            <label>Distributor *</label>
            <select
              value={clientShopId}
              onChange={(e) => {
                setClientShopId(e.target.value);
                setForm({ ...form, resourceId: '' });
              }}
            >
              <option value="">Pick the customer's distributor</option>
              {(distributors.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.businessName}</option>)}
            </select>
            <label>Customer *</label>
            <select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })} disabled={!clientShopId}>
              <option value="">Pick a customer</option>
              {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}

        <label>Severity</label>
        <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
          {SEVERITIES.map((sev) => <option key={sev} value={sev}>{severityWords(sev)}</option>)}
        </select>

        <label>Notes</label>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="An optional note for the office" />

        {err && <p style={{ color: 'var(--danger-fg)' }}>{err}</p>}
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={() => setShowNew(false)}>Go back</button>{' '}
          <button className="primary" onClick={() => create.mutate()} disabled={create.isPending}>Create rule</button>
        </div>
      </Modal>
    </>
  );
}
