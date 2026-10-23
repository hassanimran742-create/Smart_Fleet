import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, RotateCw } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Modal } from '../components/Modal';
import { translateDynamic } from '../i18n';
import { formatDateTime, formatRs } from '../i18n/format';
import {
  actionInWords,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterChips,
  PageHeader,
  SkeletonText,
  StatusChip,
  Tabs,
  useConfirm,
  useToast,
} from '../ui';
import { useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy Alerts screen, kept inside the shell for Inc 1 (UX_ADMIN §2.11). Light pass (website spec W48):
 * the tabs read Open alerts · Rules, "Check now" checks the rules, Open · All are chips, and an empty
 * list is one line with the bell. The chips read Open (red), Seen (amber) and Sorted (green). The rule
 * table says "Limit" and "Urgency". The retired "credit exceeds" rule kind can't be created any more
 * (balances can't go negative; API_CONTRACT §7.2).
 */

type Tab = 'open' | 'rules';
type Show = 'OPEN' | 'ALL';

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
  DISTRIBUTOR_BALANCE_LOW: 'The limit is an amount in rupees. Raises an alert whenever the picked distributor (or any distributor, if left blank) has a balance below it.',
  DISTRIBUTOR_CREDIT_OVER: 'No longer used: a balance can never go below zero.',
  STORE_STOCK_LOW: 'The limit is the smallest number of full cylinders expected. Pick the cylinder size, and optionally one store.',
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
  const lt = useLegacyT();
  const [tab, setTab] = useState<Tab>('open');
  return (
    <div className="sf-legacy-page">
      <PageHeader title={lt('alerts.title')} />
      <Tabs<Tab>
        label={lt('alerts.title')}
        items={[
          { id: 'open', label: lt('alerts.tabs.open') },
          { id: 'rules', label: lt('alerts.tabs.rules') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'open' && <OpenAlertsTab />}
      {tab === 'rules' && <RulesTab />}
    </div>
  );
}

function OpenAlertsTab() {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const toast = useToast();
  const [show, setShow] = useState<Show>('OPEN');
  const query = useQuery({
    queryKey: ['alerts', show],
    queryFn: async () => (await api.get<AlertRow[]>(show === 'OPEN' ? '/alerts?status=OPEN' : '/alerts')).data,
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
      toast.success(lt('alerts.sortedToast'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const evalNow = useMutation({
    mutationFn: () => api.post('/alert-rules/evaluate'),
    onSuccess: () => {
      toast.success(lt('alerts.checkedToast'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const rows = query.data ?? [];

  return (
    <>
      <FilterBar className="sf-legacy__bar">
        <FilterChips<Show>
          label={lt('alerts.show')}
          options={[
            { value: 'OPEN', label: lt('alerts.filters.open') },
            { value: 'ALL', label: lt('alerts.filters.all') },
          ]}
          value={show}
          onChange={setShow}
        />
        <Button icon={RotateCw} onClick={() => evalNow.mutate()} loading={evalNow.isPending}>
          {lt('alerts.checkNow')}
        </Button>
      </FilterBar>
      {query.isPending ? <SkeletonText lines={4} /> : null}
      {query.isError && !query.data ? (
        <ErrorState error={query.error} title={lt('alerts.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : null}
      {query.isSuccess && rows.length === 0 ? (
        <EmptyState icon={Bell} title={show === 'OPEN' ? lt('alerts.emptyOpen') : lt('alerts.emptyAll')} />
      ) : null}
      {rows.map((a) => (
        <section className="sf-legacy-card" key={a.id}>
          <div className="sf-legacy-card__row">
            <div className="sf-legacy-alert">
              <div className="sf-legacy__chips">
                <StatusChip kind="alert" value={a.status} />
                <StatusChip kind="severity" value={a.severity} />
                <span className="sf-legacy__muted">{actionInWords(a.alertType)}</span>
              </div>
              <h3 className="sf-legacy-card__title">{a.title}</h3>
              {a.body ? <p>{a.body}</p> : null}
              <p className="sf-legacy__muted">{formatDateTime(a.createdAt)}</p>
            </div>
            <span className="sf-legacy__actions">
              {a.status === 'OPEN' ? (
                <Button size="sm" onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>
                  {lt('alerts.seen')}
                </Button>
              ) : null}
              {a.status !== 'RESOLVED' ? (
                <Button size="sm" onClick={() => resolve.mutate(a.id)} disabled={resolve.isPending}>
                  {lt('alerts.sorted')}
                </Button>
              ) : null}
            </span>
          </div>
        </section>
      ))}
    </>
  );
}

function RulesTab() {
  const lt = useLegacyT();
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
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error(lt('alerts.limitMissing'));
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
      <FilterBar className="sf-legacy__bar">
        <span />
        <Button variant="primary" onClick={() => setShowNew(true)}>
          {lt('alerts.newRule')}
        </Button>
      </FilterBar>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>What it watches</th><th>{lt('alerts.limit')}</th><th>{lt('alerts.urgency')}</th><th>Last raised</th><th>On</th><th aria-label="Actions"></th></tr>
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
            <label>{lt('alerts.limitRs')}</label>
            <input type="number" value={form.thresholdRs} onChange={(e) => setForm({ ...form, thresholdRs: e.target.value })} />
          </>
        ) : !usesClient && (
          <>
            <label>{lt('alerts.limitCylinders')}</label>
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

        <label>{lt('alerts.urgency')}</label>
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
