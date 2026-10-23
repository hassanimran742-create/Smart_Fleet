import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Modal } from '../components/Modal';
import { translateDynamic } from '../i18n';
import { Chip, StatusChip, useConfirm, useToast } from '../ui';

/**
 * Legacy Vans screen, kept inside the shell for Inc 1 (UX_ADMIN §2.11). Touched for the §2.11 clean-up:
 * ConfirmDialog instead of browser pop-ups, no emoji, status chips and plain words instead of raw values
 * and id fragments, and every failure shown.
 */

const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;

/** "In service", "In the workshop", "Retired" (the website's `status:vehicle` words). */
function statusWords(status: string): string {
  return translateDynamic(`status:vehicle.${status}`) ?? status;
}

interface City { id: string; name: string }
interface Zone { id: string; city_id: string; name: string }
interface CylinderType { id: string; code: string; name: string; capacityUnits: number; weightKg: string }

const PLATE_REGEX = /^[A-Z]{2,3}[- ]?\d{2,4}$/i;

function CapacityBreakdown({ slots, types }: { slots: number; types: CylinderType[] }) {
  if (!slots || !types.length) return null;
  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--surface-soft)', borderRadius: 8, fontSize: 13 }}>
      <strong>Equivalent capacity</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 6 }}>
        {types.map((t) => (
          <div key={t.id}>
            <div className="muted" style={{ fontSize: 11 }}>{t.name}</div>
            <div><strong>{Math.floor(slots / Math.max(t.capacityUnits, 1))}</strong> cylinders</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 11 }}>
        Slots are 11kg-cylinder equivalents. 45kg = 4 slots, 15kg = 2, 11.8kg = 1, 6kg = 1.
        Capacity is fungible — you can mix any types as long as their total slots ≤ {slots}.
      </p>
    </div>
  );
}

function MixedCapacityCalculator({ slots, types }: { slots: number; types: CylinderType[] }) {
  const [load, setLoad] = useState<Record<string, string>>({});
  const usedSlots = types.reduce(
    (sum, t) => sum + (Number(load[t.id] || 0) * t.capacityUnits),
    0,
  );
  const remaining = Math.max(0, slots - usedSlots);
  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--warning-bg)', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)' }}>
      <strong>Mix calculator</strong>
      <p className="muted" style={{ marginTop: 4, marginBottom: 8, fontSize: 11 }}>
        Enter the current load of each type to see how many of any type can still fit.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        {types.map((t) => (
          <div key={t.id}>
            <label style={{ fontSize: 11 }}>{t.code}</label>
            <input
              type="number"
              min={0}
              value={load[t.id] ?? ''}
              onChange={(e) => setLoad((l) => ({ ...l, [t.id]: e.target.value }))}
              style={{ padding: '4px 8px', fontSize: 12 }}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>Used: <strong>{usedSlots}</strong> / {slots} slots</span>
        <span>Remaining: <strong style={{ color: remaining > 0 ? 'var(--success-fg)' : 'var(--danger-fg)' }}>{remaining}</strong> slots</span>
      </div>
      {remaining > 0 && (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          That fits:
          {types.map((t) => (
            <span key={t.id} style={{ display: 'inline-block', marginLeft: 8 }}>
              <strong>{Math.floor(remaining / Math.max(t.capacityUnits, 1))}</strong>× {t.code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A thrown form check keeps its words; anything from the API is shown by its error code. */
function errMsg(e: unknown): string {
  return e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e);
}

type Tab = 'create' | 'manage' | 'assign';

export function VehiclesScreen() {
  const [tab, setTab] = useState<Tab>('create');

  return (
    <>
      <h2>Vans</h2>
      <div className="tabs" role="tablist" aria-label="Van views" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {([
          ['create', 'Add van'],
          ['manage', 'View and edit'],
          ['assign', 'Give vans to drivers'],
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

      {tab === 'create' && <CreateTab />}
      {tab === 'manage' && <ManageTab />}
      {tab === 'assign' && <AssignTab />}
    </>
  );
}

function CreateTab() {
  const qc = useQueryClient();
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const cylinderTypes = useQuery({
    queryKey: ['cylinder-types'],
    queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data,
  });
  const [cityId, setCityId] = useState('');
  const [form, setForm] = useState({ plateNo: '', capacityUnits: '20', homeZoneId: '' });
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [createErr, setCreateErr] = useState<string | null>(null);

  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => cityId ? (await api.get<Zone[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.plateNo.trim()) errs.plateNo = 'Plate number is required.';
    else if (!PLATE_REGEX.test(form.plateNo.trim())) errs.plateNo = 'Use the format LXX-1234 (2–3 letters then digits).';
    if (!form.capacityUnits || !Number.isFinite(Number(form.capacityUnits)) || Number(form.capacityUnits) <= 0) {
      errs.capacityUnits = 'Capacity must be a positive number.';
    }
    if (!cityId) errs.cityId = 'Pick a city.';
    if (!form.homeZoneId) errs.homeZoneId = 'Pick a home zone.';
    setFieldErr(errs);
    return Object.keys(errs).length === 0;
  }

  const create = useMutation({
    mutationFn: () => api.post('/vehicles', {
      plateNo: form.plateNo.trim().toUpperCase(),
      capacityUnits: Number(form.capacityUnits),
      homeZoneId: form.homeZoneId,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setForm({ plateNo: '', capacityUnits: '20', homeZoneId: '' });
      setCityId('');
      setFieldErr({});
      setCreateErr(null);
    },
    onError: (e: unknown) => setCreateErr(errMsg(e)),
  });

  return (
    <div className="card">
      <h3>Add van</h3>

      <label>Plate number *</label>
      <input
        value={form.plateNo}
        onChange={(e) => { setForm({ ...form, plateNo: e.target.value }); setFieldErr((p) => ({ ...p, plateNo: '' })); }}
        placeholder="LXX-1234"
        style={fieldErr.plateNo ? { borderColor: 'var(--danger)' } : undefined}
      />
      {fieldErr.plateNo && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '4px 0 0' }}>{fieldErr.plateNo}</p>}

      <label style={{ marginTop: 12 }}>Capacity * (in 11kg-cylinder slots)</label>
      <input
        type="number"
        value={form.capacityUnits}
        onChange={(e) => { setForm({ ...form, capacityUnits: e.target.value }); setFieldErr((p) => ({ ...p, capacityUnits: '' })); }}
        style={fieldErr.capacityUnits ? { borderColor: 'var(--danger)' } : undefined}
      />
      {fieldErr.capacityUnits && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '4px 0 0' }}>{fieldErr.capacityUnits}</p>}
      <CapacityBreakdown slots={Number(form.capacityUnits) || 0} types={cylinderTypes.data ?? []} />
      <MixedCapacityCalculator slots={Number(form.capacityUnits) || 0} types={cylinderTypes.data ?? []} />

      <div className="flex" style={{ gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label>City *</label>
          <select
            value={cityId}
            onChange={(e) => { setCityId(e.target.value); setForm({ ...form, homeZoneId: '' }); setFieldErr((p) => ({ ...p, cityId: '', homeZoneId: '' })); }}
            style={fieldErr.cityId ? { borderColor: 'var(--danger)' } : undefined}
          >
            <option value="">Pick a city</option>
            {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {fieldErr.cityId && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '4px 0 0' }}>{fieldErr.cityId}</p>}
        </div>
        <div style={{ flex: 1 }}>
          <label>Home zone *</label>
          <select
            value={form.homeZoneId}
            onChange={(e) => { setForm({ ...form, homeZoneId: e.target.value }); setFieldErr((p) => ({ ...p, homeZoneId: '' })); }}
            disabled={!cityId}
            style={fieldErr.homeZoneId ? { borderColor: 'var(--danger)' } : undefined}
          >
            <option value="">Pick a zone</option>
            {(zones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          {fieldErr.homeZoneId && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '4px 0 0' }}>{fieldErr.homeZoneId}</p>}
          {cityId && (zones.data ?? []).length === 0 && (
            <p className="muted" style={{ marginTop: 4 }}>
              No zones in this city. Create one on the Zones page first.
            </p>
          )}
        </div>
      </div>

      {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
      <button
        className="primary"
        style={{ marginTop: 16 }}
        onClick={() => { if (validate()) create.mutate(); }}
        disabled={create.isPending}
      >
        {create.isPending ? 'Saving…' : 'Add van'}
      </button>
    </div>
  );
}

function ManageTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const cylinderTypes = useQuery({
    queryKey: ['cylinder-types'],
    queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data,
  });
  const [showRetired, setShowRetired] = useState(false);

  const [editing, setEditing] = useState<any>(null);
  const [editCityId, setEditCityId] = useState('');
  const [editForm, setEditForm] = useState<any>({});
  const [editErr, setEditErr] = useState<string | null>(null);
  const [loadFor, setLoadFor] = useState<{ id: string; plateNo: string } | null>(null);
  const editZones = useQuery({
    queryKey: ['zones', editCityId],
    queryFn: async () => editCityId ? (await api.get<Zone[]>(`/zones/city/${editCityId}`)).data : [],
    enabled: !!editCityId,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/vehicles/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
    onError: (e) => toast.error(e),
  });

  const update = useMutation({
    mutationFn: () => {
      if (!editForm.plateNo?.trim()) throw new Error('Plate number is required');
      if (!PLATE_REGEX.test(editForm.plateNo.trim())) throw new Error('Plate must match LXX-1234');
      if (!Number.isFinite(Number(editForm.capacityUnits)) || Number(editForm.capacityUnits) <= 0) {
        throw new Error('Capacity must be a positive number');
      }
      if (!editForm.homeZoneId) throw new Error('Pick a home zone');
      return api.patch(`/vehicles/${editing.id}`, {
        plateNo: editForm.plateNo.trim().toUpperCase(),
        capacityUnits: Number(editForm.capacityUnits),
        homeZoneId: editForm.homeZoneId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setEditing(null);
      setEditErr(null);
    },
    onError: (e: unknown) => setEditErr(errMsg(e)),
  });

  async function archiveVan(v: { id: string; plateNo: string }) {
    const { ok } = await confirm({
      title: `Retire van ${v.plateNo}?`,
      body: 'It is taken out of service and can no longer be given to a driver.',
      tone: 'danger',
      confirmLabel: `Retire ${v.plateNo}`,
      action: () => api.delete(`/vehicles/${v.id}`),
    });
    if (!ok) return;
    toast.success(`${v.plateNo} retired.`);
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  }

  const rows = (data ?? []).filter((v: any) => showRetired || v.status !== 'RETIRED');

  return (
    <>
      <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Plate</th><th>Capacity</th><th>Load</th><th>Zone</th><th>Status</th><th>Current driver</th><th aria-label="Actions"></th></tr></thead>
          <tbody>
            {rows.map((v: any) => (
              <tr key={v.id} style={{ opacity: v.status === 'RETIRED' ? 0.5 : 1 }}>
                <td>{v.plateNo}</td>
                <td>{v.capacityUnits} slots</td>
                <td><button onClick={() => setLoadFor({ id: v.id, plateNo: v.plateNo })}>View load</button></td>
                <td>{v.homeZone?.name ?? '—'}</td>
                <td><StatusChip kind="vehicle" value={v.status} /></td>
                <td>{v.currentDriver?.user?.name ?? '—'}</td>
                <td>
                  <select aria-label={`Status of ${v.plateNo}`} value={v.status} onChange={(e) => setStatus.mutate({ id: v.id, status: e.target.value })}>
                    {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{statusWords(s)}</option>)}
                  </select>{' '}
                  <button onClick={() => {
                    setEditing(v);
                    setEditForm({ plateNo: v.plateNo, capacityUnits: String(v.capacityUnits), homeZoneId: v.homeZoneId });
                    setEditCityId(v.homeZone?.cityId ?? '');
                    setEditErr(null);
                  }}>Edit</button>{' '}
                  {v.status !== 'RETIRED' && (
                    <button style={{ color: 'var(--danger-fg)' }} onClick={() => void archiveVan(v)}>Retire</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No vans yet. Add one on the Add van tab.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {loadFor && <VehicleLoadModal vehicle={loadFor} onClose={() => setLoadFor(null)} />}

      <Modal title="Edit van" open={!!editing} onClose={() => setEditing(null)} width={560}>
        {editing && (
          <>
            <label>Plate number</label>
            <input value={editForm.plateNo ?? ''} onChange={(e) => setEditForm({ ...editForm, plateNo: e.target.value })} />
            <label>Capacity (slots)</label>
            <input type="number" value={editForm.capacityUnits ?? ''} onChange={(e) => setEditForm({ ...editForm, capacityUnits: e.target.value })} />
            <CapacityBreakdown slots={Number(editForm.capacityUnits) || 0} types={cylinderTypes.data ?? []} />
            <div className="flex" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>City</label>
                <select value={editCityId} onChange={(e) => setEditCityId(e.target.value)}>
                  <option value="">Pick a city</option>
                  {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Home zone</label>
                <select value={editForm.homeZoneId ?? ''} onChange={(e) => setEditForm({ ...editForm, homeZoneId: e.target.value })} disabled={!editCityId}>
                  <option value="">Pick a zone</option>
                  {(editZones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            </div>
            {editErr && <p style={{ color: 'var(--danger-fg)' }}>{editErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Go back</button>{' '}
              <button className="primary" onClick={() => update.mutate()} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save van'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function AssignTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });

  const assign = useMutation({
    mutationFn: ({ driverId, vehicleId }: { driverId: string; vehicleId: string | null }) =>
      api.patch(`/drivers/${driverId}/vehicle`, { vehicleId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => {
      toast.error(e);
      qc.invalidateQueries({ queryKey: ['drivers'] });
    },
  });

  const activeVehicles = useMemo(
    () => (vehicles.data ?? []).filter((v: any) => v.status !== 'RETIRED'),
    [vehicles.data],
  );
  const activeDrivers = useMemo(
    () => (drivers.data ?? []).filter((d: any) => d.user.status !== 'SUSPENDED' && d.availability !== 'ON_LEAVE'),
    [drivers.data],
  );

  // Vehicle ID → currently-assigned driver (single, since drivers.currentVehicleId is unique)
  const driverForVehicle = useMemo(() => {
    const m: Record<string, any> = {};
    for (const d of drivers.data ?? []) {
      if (d.currentVehicleId) m[d.currentVehicleId] = d;
    }
    return m;
  }, [drivers.data]);

  return (
    <>
      <p className="muted" style={{ marginTop: -4 }}>
        Give each van to an available driver. A driver has at most one van; giving a driver a new van releases the old one.
      </p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Capacity</th>
              <th>Home zone</th>
              <th>Status</th>
              <th>Assigned driver</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {activeVehicles.map((v: any) => {
              const assignedDriver = driverForVehicle[v.id];
              return (
                <tr key={v.id}>
                  <td><strong>{v.plateNo}</strong></td>
                  <td>{v.capacityUnits} slots</td>
                  <td>{v.homeZone?.name ?? '—'}</td>
                  <td><StatusChip kind="vehicle" value={v.status} /></td>
                  <td>
                    {assignedDriver ? (
                      <span>
                        {assignedDriver.user.name}{' '}
                        <span className="muted" style={{ fontSize: 11 }}>({assignedDriver.user.phone})</span>
                      </span>
                    ) : (
                      <span className="muted">No driver</span>
                    )}
                  </td>
                  <td>
                    <select
                      aria-label={`Driver for ${v.plateNo}`}
                      value={assignedDriver?.id ?? ''}
                      disabled={v.status !== 'ACTIVE'}
                      onChange={(e) => {
                        const newDriverId = e.target.value;
                        if (!newDriverId) {
                          if (assignedDriver) assign.mutate({ driverId: assignedDriver.id, vehicleId: null });
                          return;
                        }
                        if (assignedDriver && assignedDriver.id !== newDriverId) {
                          assign.mutate({ driverId: assignedDriver.id, vehicleId: null });
                        }
                        assign.mutate({ driverId: newDriverId, vehicleId: v.id });
                      }}
                    >
                      <option value="">No driver</option>
                      {activeDrivers.map((d: any) => (
                        <option key={d.id} value={d.id} disabled={!!d.currentVehicleId && d.currentVehicleId !== v.id}>
                          {d.user.name}{' '}
                          {d.currentVehicleId && d.currentVehicleId !== v.id ? '(has another van)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
            {activeVehicles.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No vans in service.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface VehicleSummary {
  vehicleId: string;
  plateNo: string | null;
  totalFull: number;
  totalEmpty: number;
  byType: Array<{ cylinderTypeId: string; code: string; name: string; full: number; empty: number }>;
}

function VehicleLoadModal({ vehicle, onClose }: { vehicle: { id: string; plateNo: string }; onClose: () => void }) {
  const { data, isLoading } = useQuery<VehicleSummary>({
    queryKey: ['vehicle-summary', vehicle.id],
    queryFn: async () => (await api.get(`/inventory/vehicle/${vehicle.id}/summary`)).data,
    refetchInterval: 15000,
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,18,27,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: 460, maxWidth: '92vw' }}>
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Load on {vehicle.plateNo}</h3>
          <button onClick={onClose}>Close</button>
        </div>

        {isLoading ? (
          <p className="muted">Loading…</p>
        ) : !data || data.byType.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            This van has no cylinders on it right now.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
              <Chip tone="success">{data.totalFull} full</Chip>
              <Chip tone="warning">{data.totalEmpty} empty</Chip>
              <Chip tone="neutral">{data.totalFull + data.totalEmpty} in all</Chip>
            </div>
            <table>
              <thead><tr><th>Cylinder size</th><th style={{ textAlign: 'right' }}>Full</th><th style={{ textAlign: 'right' }}>Empty</th></tr></thead>
              <tbody>
                {data.byType.map((r) => (
                  <tr key={r.cylinderTypeId}>
                    <td>{r.name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success-fg)' }}>{r.full}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--warning-fg)' }}>{r.empty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
