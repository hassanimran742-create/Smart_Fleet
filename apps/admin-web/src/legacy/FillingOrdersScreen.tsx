import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { FillingOrderDto, RefillStage } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { formatDateTime } from '../i18n/format';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  FilterChips,
  InlineAlert,
  Modal,
  PageHeader,
  Select,
  StaleBanner,
  StatusChip,
  Table,
  useConfirm,
  useToast,
  type TableColumn,
} from '../ui';
import { useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy refill screen, kept for Inc 1 (UX_ADMIN §2.11, ADR-16: refills carry no money) and rebuilt in
 * Inc 3. Light pass (website spec W41): the title "Refills" with one line, Active · Done · All as chips,
 * the refill status words of UX_PRINCIPLES §4.2 and a one-line empty state. No "Place a filling order"
 * form (only the distributor asks for a refill), no cost, no cancel (only the owning distributor cancels,
 * before pickup), and "Mark complete" moves no money.
 */

/** What the office list sends: the refill DTO plus the names the screen reads. */
type RefillRow = FillingOrderDto & {
  distributor?: { id: string; businessName: string; code: string };
};

type Show = 'active' | 'done' | 'all';

const FINISHED: readonly RefillStage[] = ['DONE', 'CANCELLED'];

interface DriverOption {
  id: string;
  availability: string;
  isOnline: boolean;
  user: { name: string; status: string };
  currentVehicle: { plateNo: string } | null;
}

/** The office may act on a refill: assign a waiting one, complete one that is back. */
function actionsOf(row: RefillRow): string[] {
  // An older API without `allowedActions`: the office assigns a waiting refill and completes a returned one.
  return row.allowedActions ?? (row.status === 'PENDING' ? ['ASSIGN'] : row.status === 'RETURNED' ? ['COMPLETE'] : []);
}

export function FillingOrdersScreen() {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [show, setShow] = useState<Show>('active');
  const [assignFor, setAssignFor] = useState<RefillRow | null>(null);
  const query = useQuery({
    queryKey: ['filling-orders'],
    queryFn: async () => (await api.get<RefillRow[]>('/filling-orders')).data,
    refetchInterval: 15000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['filling-orders'] });

  async function markComplete(row: RefillRow) {
    const { ok } = await confirm({
      title: lt('refills.complete.title'),
      facts: [
        { label: lt('refills.columns.refill'), value: row.distributor?.businessName ?? '—' },
        { label: lt('refills.columns.cylinders'), value: lt('refills.cylinders', { count: row.requestedCount, size: row.sizeLabel }) },
      ],
      body: lt('refills.complete.body'),
      confirmLabel: lt('refills.complete.confirm'),
      action: () => api.patch(`/filling-orders/${row.id}/complete`),
    });
    if (!ok) return;
    toast.success(lt('refills.complete.toast'));
    void invalidate();
  }

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const list = query.data ?? [];
    if (show === 'active') return list.filter((row) => !FINISHED.includes(row.stage));
    if (show === 'done') return list.filter((row) => FINISHED.includes(row.stage));
    return list;
  }, [query.data, show]);

  const columns: TableColumn<RefillRow>[] = [
      {
        id: 'refill',
        header: lt('refills.columns.refill'),
        sticky: true,
        cell: (row) => (
          <span className="sf-legacy__two-line">
            <span className="sf-legacy__strong">{row.distributor?.businessName ?? '—'}</span>
            <span className="sf-legacy__muted">{lt('refills.requested', { when: formatDateTime(row.createdAt) })}</span>
          </span>
        ),
      },
      { id: 'station', header: lt('refills.columns.station'), priority: 2, cell: (row) => row.fillingStation?.name ?? '—' },
      {
        id: 'cylinders',
        header: lt('refills.columns.cylinders'),
        cell: (row) => (
          <span className="sf-legacy__two-line">
            <span className="sf-legacy__nowrap">{lt('refills.cylinders', { count: row.requestedCount, size: row.sizeLabel })}</span>
            {row.filledCount != null && row.stage !== 'NEEDS_DRIVER' ? (
              <span className="sf-legacy__muted">{lt('refills.filled', { count: row.filledCount })}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'driver',
        header: lt('refills.columns.driver'),
        priority: 2,
        cell: (row) =>
          row.assignedDriver ? (
            <span className="sf-legacy__two-line">
              <span>{row.assignedDriver.name}</span>
              {row.assignedVehicle ? <span className="sf-legacy__muted">{row.assignedVehicle.plateNo}</span> : null}
            </span>
          ) : (
            <span className="sf-legacy__muted">—</span>
          ),
      },
      { id: 'status', header: lt('refills.columns.status'), cell: (row) => <StatusChip kind="refillStage" value={row.stage} /> },
      {
        id: 'action',
        header: <span className="sr-only">{lt('refills.columns.action')}</span>,
        align: 'end',
        cell: (row) => {
          const actions = actionsOf(row);
          if (actions.includes('ASSIGN')) {
            return (
              <Button size="sm" onClick={() => setAssignFor(row)}>
                {lt('refills.assign')}
              </Button>
            );
          }
          if (actions.includes('COMPLETE')) {
            return (
              <Button size="sm" onClick={() => void markComplete(row)}>
                {lt('refills.complete.button')}
              </Button>
            );
          }
          return null;
        },
      },
  ];

  const emptyTitle = all.length === 0 ? lt('refills.empty.all') : show === 'active' ? lt('refills.empty.active') : lt('refills.empty.done');

  return (
    <div className="sf-legacy-page">
      <PageHeader title={lt('refills.title')} subtitle={lt('refills.subtitle')} />
      <StaleBanner query={query} />
      <FilterBar>
        <FilterChips<Show>
          label={lt('refills.show')}
          options={[
            { value: 'active', label: lt('refills.filters.active') },
            { value: 'done', label: lt('refills.filters.done') },
            { value: 'all', label: lt('refills.filters.all') },
          ]}
          value={show}
          onChange={setShow}
        />
      </FilterBar>
      <Table<RefillRow>
        caption={lt('refills.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
        empty={<EmptyState compact icon={RefreshCw} title={emptyTitle} />}
        error={
          <ErrorState
            compact
            error={query.error}
            title={lt('refills.loadFailed')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        }
      />
      {assignFor ? (
        <AssignRefillDialog
          refill={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={() => {
            setAssignFor(null);
            void invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

/** Assign a driver with a van to a waiting refill (one tap on a name, then the button). */
function AssignRefillDialog({ refill, onClose, onDone }: { refill: RefillRow; onClose: () => void; onDone: () => void }) {
  const lt = useLegacyT();
  const { t } = useTranslation();
  const toast = useToast();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get<DriverOption[]>('/drivers')).data });
  const [driverId, setDriverId] = useState('');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = (drivers.data ?? []).filter(
    (d) => d.availability === 'AVAILABLE' && d.user.status === 'ACTIVE' && d.currentVehicle !== null,
  );

  const assign = useMutation({
    mutationFn: () => api.patch(`/filling-orders/${refill.id}/assign`, { driverId }),
    onSuccess: () => {
      toast.success(lt('refills.assignDialog.toast'));
      onDone();
    },
    onError: (e) => setError(messageFor(e)),
  });

  const confirm = () => {
    if (assign.isPending) return;
    if (!driverId) {
      setPressed(true);
      return;
    }
    setError(null);
    assign.mutate();
  };

  return (
    <Modal
      open
      size="sm"
      title={lt('refills.assignDialog.title')}
      onClose={() => {
        if (!assign.isPending) onClose();
      }}
      dismissible={!assign.isPending}
      initialFocusRef={goBackRef}
      footer={
        <>
          <Button ref={goBackRef} onClick={onClose} disabled={assign.isPending}>
            {t('actions.goBack')}
          </Button>
          <Button variant="primary" loading={assign.isPending} onClick={confirm}>
            {lt('refills.assign')}
          </Button>
        </>
      }
    >
      <div className="sf-legacy-form">
        <p className="sf-legacy__muted">
          {lt('refills.assignDialog.summary', {
            cylinders: lt('refills.cylinders', { count: refill.requestedCount, size: refill.sizeLabel }),
            distributor: refill.distributor?.businessName ?? '—',
            station: refill.fillingStation?.name ?? '—',
          })}
        </p>
        <Field label={lt('refills.columns.driver')} error={pressed && !driverId ? lt('refills.assignDialog.pickFirst') : null}>
          <Select
            value={driverId}
            placeholder={lt('refills.assignDialog.pick')}
            options={available.map((d) => ({
              value: d.id,
              label: lt('refills.assignDialog.option', {
                name: d.user.name,
                plate: d.currentVehicle?.plateNo ?? '',
                presence: d.isOnline ? lt('refills.assignDialog.onDuty') : lt('refills.assignDialog.offline'),
              }),
            }))}
            onChange={(event) => setDriverId(event.target.value)}
          />
        </Field>
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}
