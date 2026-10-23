import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FillingOrderDto, RefillStage } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Modal } from '../components/Modal';
import { formatDateTime } from '../i18n/format';
import { StatusChip, useConfirm, useToast } from '../ui';

/**
 * Legacy refill screen, kept for Inc 1 (UX_ADMIN §2.11, ADR-16: refills carry no money). Cleaned up:
 * no "Place a filling order" form (only the distributor asks for a refill), no cost column, no cancel
 * (only the owning distributor cancels, before pickup), "Mark complete" with no money, and chips with the
 * refill's stage words (from the DTO's `stage`, without counts) instead of raw statuses. Rebuilt in Inc 3.
 */

/** What the office list sends: the refill DTO plus the names the old screen reads. */
type RefillRow = FillingOrderDto & {
  distributor?: { id: string; businessName: string; code: string };
  cylinderType?: { id: string; code: string; name: string };
};

const STAGE_FILTERS: { value: RefillStage | ''; label: string }[] = [
  { value: '', label: 'All refills' },
  { value: 'NEEDS_DRIVER', label: 'Needs a driver' },
  { value: 'DRIVER_ASSIGNED', label: 'Driver assigned' },
  { value: 'PICKING_UP', label: 'Picking up empties' },
  { value: 'PICKED_UP', label: 'Empties picked up' },
  { value: 'AT_STATION', label: 'At the station' },
  { value: 'COMING_BACK', label: 'Filled' },
  { value: 'BACK_AT_STORE', label: 'Back at store' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

interface DriverOption {
  id: string;
  availability: string;
  isOnline: boolean;
  user: { name: string; status: string };
  currentVehicle: { plateNo: string } | null;
}

export function FillingOrdersScreen() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [stageFilter, setStageFilter] = useState<RefillStage | ''>('');
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['filling-orders'],
    queryFn: async () => (await api.get<RefillRow[]>('/filling-orders')).data,
    refetchInterval: 15000,
  });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get<DriverOption[]>('/drivers')).data });

  const [assignFor, setAssignFor] = useState<RefillRow | null>(null);
  const [assignDriverId, setAssignDriverId] = useState('');
  const [assignErr, setAssignErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['filling-orders'] });

  const assign = useMutation({
    mutationFn: () => api.patch(`/filling-orders/${assignFor!.id}/assign`, { driverId: assignDriverId }),
    onSuccess: () => {
      void invalidate();
      toast.success('Driver assigned to the refill.');
      setAssignFor(null);
      setAssignDriverId('');
      setAssignErr(null);
    },
    onError: (e) => setAssignErr(messageFor(e)),
  });

  async function markComplete(o: RefillRow) {
    const what = `${o.requestedCount} × ${o.sizeLabel}`;
    const { ok } = await confirm({
      title: 'Mark this refill complete?',
      body: `${o.distributor?.businessName ?? 'The distributor'}'s refill (${what}) is back at the store. No money moves.`,
      confirmLabel: 'Mark complete',
      action: () => api.patch(`/filling-orders/${o.id}/complete`),
    });
    if (!ok) return;
    toast.success('Refill marked complete.');
    void invalidate();
  }

  const availableDrivers = (drivers.data ?? []).filter(
    (d) => d.availability === 'AVAILABLE' && d.user.status === 'ACTIVE' && d.currentVehicle !== null,
  );
  const rows = (data ?? []).filter((o) => !stageFilter || o.stage === stageFilter);

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Refill requests</h2>
        <select
          aria-label="Show refills"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as RefillStage | '')}
          style={{ width: 220 }}
        >
          {STAGE_FILTERS.map((s) => (
            <option key={s.value || 'all'} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">
        Distributors ask for refills in the shop app. A driver picks up the empties at the distributor's store, takes them to the
        refill station and brings them back. Refills carry no money.
      </p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Distributor</th>
              <th>Station</th>
              <th>Cylinders</th>
              <th>Driver</th>
              <th>Stage</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              // An older API without `allowedActions`: the office assigns a waiting refill and completes a returned one.
              const actions = o.allowedActions ?? (o.status === 'PENDING' ? ['ASSIGN'] : o.status === 'RETURNED' ? ['COMPLETE'] : []);
              return (
                <tr key={o.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(o.createdAt)}</td>
                  <td>{o.distributor?.businessName ?? '—'}</td>
                  <td>{o.fillingStation?.name ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {o.requestedCount} × {o.sizeLabel}
                    {o.filledCount != null && o.stage !== 'NEEDS_DRIVER' ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {o.filledCount} filled
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {o.assignedDriver ? (
                      <>
                        {o.assignedDriver.name}
                        {o.assignedVehicle ? <div className="muted">{o.assignedVehicle.plateNo}</div> : null}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <StatusChip kind="refillStage" value={o.stage} />
                  </td>
                  <td>
                    {actions.includes('ASSIGN') && (
                      <button
                        className="primary"
                        onClick={() => {
                          setAssignFor(o);
                          setAssignDriverId('');
                          setAssignErr(null);
                        }}
                      >
                        Assign driver
                      </button>
                    )}
                    {actions.includes('COMPLETE') && (
                      <button className="primary" onClick={() => void markComplete(o)}>
                        Mark complete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {isPending && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  Loading refills…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>
                  <p style={{ color: 'var(--danger-fg)' }}>{messageFor(error)}</p>
                  <button onClick={() => void refetch()}>Try again</button>
                </td>
              </tr>
            )}
            {!isPending && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  {stageFilter ? 'No refills at this stage.' : 'No refill requests yet. They show up here when a distributor asks for one.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal title="Assign a driver to the refill" open={!!assignFor} onClose={() => setAssignFor(null)} width={480}>
        {assignFor && (
          <>
            <p className="muted">
              <strong>
                {assignFor.requestedCount} × {assignFor.sizeLabel}
              </strong>{' '}
              for <strong>{assignFor.distributor?.businessName}</strong>, station <strong>{assignFor.fillingStation?.name}</strong>.
            </p>
            <label htmlFor="refill-driver">Driver (available drivers with a van)</label>
            <select id="refill-driver" value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)}>
              <option value="">Pick a driver</option>
              {availableDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.user.name} · {d.currentVehicle?.plateNo} · {d.isOnline ? 'on duty' : 'offline'}
                </option>
              ))}
            </select>
            {assignErr && <p style={{ color: 'var(--danger-fg)' }}>{assignErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setAssignFor(null)}>Go back</button>{' '}
              <button className="primary" disabled={!assignDriverId || assign.isPending} onClick={() => assign.mutate()}>
                {assign.isPending ? 'Assigning…' : 'Assign driver'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
