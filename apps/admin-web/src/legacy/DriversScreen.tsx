import { useEffect, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Archive, CalendarOff, CircleCheck, MapPin, Pencil, RotateCcw } from 'lucide-react';
import type { DriverAvailability, DriverOfficeDto } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { uploadFile } from '../api/upload';
import { useDriversSocket } from '../hooks/useDriversSocket';
import { formatDateTime, formatDay, formatPhone } from '../i18n/format';
import { Modal } from '../components/Modal';
import { PasswordResetButton } from '../components/PasswordResetButton';
import { IconButton, StatusChip, useConfirm, useToast } from '../ui';
import './legacy.css';

/**
 * Legacy Drivers screen, kept inside the new shell for Inc 1 (UX_ADMIN §2.11). Touched in Inc 1 for:
 * the masked CNIC shown read-only (API_CONTRACT §3.5, G11-12; the CNIC itself never comes back), the
 * archive and reactivate reasons the API now requires, the new "Set app password" dialog, and the
 * §2.11 clean-up: ConfirmDialog instead of browser pop-ups, lucide icons with labels instead of emoji,
 * and status chips instead of raw values.
 */

const CNIC_REGEX = /^\d{5}-?\d{7}-?\d$/;

/** The office driver view, which carries the last known position (`currentLocation` as { lat, lng }). */
type DriverRow = DriverOfficeDto & {
  leaveReason?: string | null;
};

export function DriversScreen() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get<DriverRow[]>('/drivers')).data });
  const [showArchived, setShowArchived] = useState(false);

  // Create form
  const [form, setForm] = useState({ name: '', phone: '', email: '', cnic: '', licenceNo: '', profilePictureUrl: '' });
  const [picPreview, setPicPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Edit modal
  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [editPicPreview, setEditPicPreview] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; email: string; licenceNo: string; profilePictureUrl: string }>({
    name: '',
    email: '',
    licenceNo: '',
    profilePictureUrl: '',
  });
  const [editErr, setEditErr] = useState<string | null>(null);

  async function pickPicture(e: ChangeEvent<HTMLInputElement>, target: 'create' | 'edit') {
    const file = e.target.files?.[0];
    if (!file) return;
    const setErr = target === 'create' ? setCreateErr : setEditErr;
    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      if (target === 'create') setPicPreview(preview);
      else setEditPicPreview(preview);
      const { url } = await uploadFile(file);
      if (target === 'create') setForm((f) => ({ ...f, profilePictureUrl: url }));
      else setEditForm((f) => ({ ...f, profilePictureUrl: url }));
    } catch (error) {
      setErr(messageFor(error));
    } finally {
      setUploading(false);
    }
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['drivers'] });

  const create = useMutation({
    mutationFn: () => {
      if (!form.name.trim() || !form.phone.trim() || !form.licenceNo.trim()) throw new Error('Name, phone and licence are required.');
      if (!normalizePkPhone(form.phone)) throw new Error('Enter a mobile number like 0300 1234567.');
      if (form.cnic && !CNIC_REGEX.test(form.cnic.trim())) throw new Error('Enter the 13-digit CNIC, like 35202-1234567-1.');
      return api
        .post('/drivers', {
          name: form.name,
          phone: form.phone,
          licenceNo: form.licenceNo,
          email: form.email || undefined,
          cnic: form.cnic || undefined,
          profilePictureUrl: form.profilePictureUrl || undefined,
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      void invalidate();
      toast.success(`${form.name.trim()} added.`);
      setForm({ name: '', phone: '', email: '', cnic: '', licenceNo: '', profilePictureUrl: '' });
      setPicPreview(null);
      setCreateErr(null);
    },
    onError: (e: unknown) => setCreateErr(e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e)),
  });

  const update = useMutation({
    mutationFn: () =>
      api
        .patch(`/drivers/${editing!.id}/profile`, {
          name: editForm.name,
          email: editForm.email,
          licenceNo: editForm.licenceNo,
          profilePictureUrl: editForm.profilePictureUrl || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      void invalidate();
      toast.success('Driver saved.');
      setEditing(null);
      setEditPicPreview(null);
      setEditErr(null);
    },
    onError: (e) => setEditErr(messageFor(e)),
  });

  async function archiveDriver(d: DriverRow) {
    const { ok } = await confirm({
      title: `Archive driver ${d.user.name}?`,
      body: "They are signed out of the driver app and can't get new jobs until you reactivate them. Their van is released.",
      tone: 'danger',
      confirmLabel: `Archive ${d.user.name}`,
      reason: { label: 'Reason', hint: '5 to 300 characters. Saved in the activity log.', required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => api.delete(`/drivers/${d.id}`, { data: { reason } }),
    });
    if (!ok) return;
    toast.success(`${d.user.name} archived.`);
    void invalidate();
  }

  async function reactivateDriver(d: DriverRow) {
    const { ok } = await confirm({
      title: `Reactivate ${d.user.name}?`,
      body: 'They can sign in to the driver app again. Give them a van in Vans before assigning jobs.',
      confirmLabel: `Reactivate ${d.user.name}`,
      reason: { label: 'Reason', hint: '5 to 300 characters. Saved in the activity log.', required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => api.patch(`/drivers/${d.id}/reactivate`, { reason }),
    });
    if (!ok) return;
    toast.success(`${d.user.name} is active again.`);
    void invalidate();
  }

  const setAvailability = useMutation({
    mutationFn: (payload: { id: string; availability: DriverAvailability; leaveStart?: string; leaveEnd?: string; reason?: string }) =>
      api
        .patch(`/drivers/${payload.id}/availability`, {
          availability: payload.availability,
          leaveStart: payload.leaveStart,
          leaveEnd: payload.leaveEnd,
          reason: payload.reason,
        })
        .then((r) => r.data),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(e),
  });

  // Track modal state — opens a live mini-map for a specific driver
  const [trackingFor, setTrackingFor] = useState<DriverRow | null>(null);
  // Subscribe to the global driver socket; we filter to the focused driver inside the modal.
  const { drivers: liveDrivers, connected: liveConnected } = useDriversSocket();

  // Leave modal state
  const [leaveFor, setLeaveFor] = useState<DriverRow | null>(null);
  const [leaveForm, setLeaveForm] = useState<{ leaveStart: string; leaveEnd: string; reason: string }>({
    leaveStart: '',
    leaveEnd: '',
    reason: '',
  });
  const [leaveErr, setLeaveErr] = useState<string | null>(null);

  const rows = (data ?? []).filter((d) => showArchived || d.user.status !== 'SUSPENDED');

  function openEdit(d: DriverRow) {
    setEditing(d);
    setEditForm({
      name: d.user.name,
      email: d.user.email ?? '',
      licenceNo: d.licenceNo,
      profilePictureUrl: d.user.profilePictureUrl ?? '',
    });
    setEditPicPreview(d.user.profilePictureUrl ?? null);
    setEditErr(null);
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Drivers</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="card">
        <h3>Add driver</h3>
        <div className="flex" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div style={{ width: 140, textAlign: 'center' }}>
            <label>Profile picture</label>
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-2)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundImage: picPreview ? `url(${picPreview})` : 'none',
              }}
            />
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void pickPicture(e, 'create')} style={{ marginTop: 8 }} />
            {uploading && <p className="muted">Uploading…</p>}
          </div>
          <div style={{ flex: 1 }}>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>Mobile number *</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0300 1234567" inputMode="tel" />
            <label>Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>CNIC</label>
            <input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="35202-1234567-1" />
            <p className="muted" style={{ marginTop: 4 }}>After saving it shows only as *****-****567-1.</p>
            <label>Driving licence number *</label>
            <input value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} />
            {createErr && <p style={{ color: 'var(--danger-fg)' }}>{createErr}</p>}
            <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()} disabled={uploading || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add driver'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th aria-label="Photo"></th>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>CNIC</th>
              <th>Licence</th>
              <th>App</th>
              <th>Availability</th>
              <th>Van</th>
              <th>Account</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} style={{ opacity: d.user.status === 'SUSPENDED' ? 0.6 : 1 }}>
                <td>
                  {d.user.profilePictureUrl ? (
                    <img src={d.user.profilePictureUrl} alt="" style={{ width: 32, height: 32, borderRadius: 16, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--neutral-bg)' }} />
                  )}
                </td>
                <td>{d.user.name}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(d.user.phone)}</td>
                <td>{d.user.email ?? '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{d.cnicMasked ?? '—'}</td>
                <td>{d.licenceNo}</td>
                <td>
                  <StatusChip kind="presence" value={d.isOnline ? 'ONLINE' : 'OFFLINE'} />
                </td>
                <td>
                  <StatusChip kind="driver" value={d.availability} />
                  {d.availability === 'ON_LEAVE' && d.leaveEnd && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      until {formatDay(d.leaveEnd)}
                    </div>
                  )}
                </td>
                <td>
                  {d.currentVehicle ? (
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{d.currentVehicle.plateNo}</span>
                  ) : (
                    <span className="muted">No van</span>
                  )}
                </td>
                <td>
                  <StatusChip kind="user" value={d.user.status} />
                </td>
                <td>
                  <div className="sf-legacy-actions">
                    <IconButton icon={MapPin} label={`Track ${d.user.name} live`} onClick={() => setTrackingFor(d)} />
                    <IconButton
                      icon={Pencil}
                      label={`Edit ${d.user.name}`}
                      onClick={() => openEdit(d)}
                      disabled={d.user.status === 'SUSPENDED'}
                    />
                    <PasswordResetButton userId={d.user.id} userName={d.user.name} onDone={() => void invalidate()} />
                    {d.availability !== 'ON_LEAVE' && d.user.status !== 'SUSPENDED' && (
                      <IconButton
                        icon={CalendarOff}
                        label={`Mark ${d.user.name} on leave`}
                        onClick={() => {
                          setLeaveFor(d);
                          setLeaveForm({ leaveStart: new Date().toISOString().slice(0, 10), leaveEnd: '', reason: '' });
                          setLeaveErr(null);
                        }}
                      />
                    )}
                    {d.availability === 'ON_LEAVE' && (
                      <IconButton
                        icon={CircleCheck}
                        label={`Mark ${d.user.name} available`}
                        onClick={() => setAvailability.mutate({ id: d.id, availability: 'AVAILABLE' })}
                      />
                    )}
                    {d.user.status === 'SUSPENDED' ? (
                      <IconButton icon={RotateCcw} label={`Reactivate ${d.user.name}`} onClick={() => void reactivateDriver(d)} />
                    ) : (
                      <IconButton
                        icon={Archive}
                        variant="ghost-danger"
                        label={`Archive ${d.user.name}`}
                        onClick={() => void archiveDriver(d)}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No drivers yet. Add one above, then give them a van in Vans.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal title="Mark on leave" open={!!leaveFor} onClose={() => setLeaveFor(null)}>
        {leaveFor && (
          <>
            <p>
              Mark <strong>{leaveFor.user.name}</strong> as on leave. They can't be given new jobs until they are available again.
            </p>
            <label>Start date *</label>
            <input type="date" value={leaveForm.leaveStart} onChange={(e) => setLeaveForm({ ...leaveForm, leaveStart: e.target.value })} />
            <label>End date</label>
            <input type="date" value={leaveForm.leaveEnd} onChange={(e) => setLeaveForm({ ...leaveForm, leaveEnd: e.target.value })} />
            <label>Reason</label>
            <input
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              placeholder="For example annual leave, illness or family"
            />
            {leaveErr && <p style={{ color: 'var(--danger-fg)' }}>{leaveErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setLeaveFor(null)}>Go back</button>{' '}
              <button
                className="primary"
                disabled={setAvailability.isPending}
                onClick={() => {
                  if (!leaveForm.leaveStart) {
                    setLeaveErr('Pick the start date.');
                    return;
                  }
                  setAvailability.mutate(
                    {
                      id: leaveFor.id,
                      availability: 'ON_LEAVE',
                      leaveStart: leaveForm.leaveStart,
                      leaveEnd: leaveForm.leaveEnd || undefined,
                      reason: leaveForm.reason || undefined,
                    },
                    {
                      onSuccess: () => {
                        toast.success(`${leaveFor.user.name} is on leave.`);
                        setLeaveFor(null);
                      },
                      onError: (e) => setLeaveErr(messageFor(e)),
                    },
                  );
                }}
              >
                Mark on leave
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal title="Edit driver" open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <div className="flex" style={{ alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 120, textAlign: 'center' }}>
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 50,
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-2)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundImage: editPicPreview ? `url(${editPicPreview})` : 'none',
                  }}
                />
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void pickPicture(e, 'edit')} style={{ marginTop: 8 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                <label>Email</label>
                <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                <label>CNIC</label>
                <p style={{ fontFamily: 'var(--font-mono)', margin: '4px 0 0' }}>{editing.cnicMasked ?? 'Not given'}</p>
                <p className="muted" style={{ marginTop: 2 }}>Shown masked. It can't be changed here in the pilot.</p>
                <label>Licence number</label>
                <input value={editForm.licenceNo} onChange={(e) => setEditForm({ ...editForm, licenceNo: e.target.value })} />
                {editErr && <p style={{ color: 'var(--danger-fg)' }}>{editErr}</p>}
              </div>
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Go back</button>{' '}
              <button className="primary" onClick={() => update.mutate()} disabled={uploading || update.isPending}>
                {update.isPending ? 'Saving…' : 'Save driver'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <TrackDriverModal driver={trackingFor} liveDrivers={liveDrivers} liveConnected={liveConnected} onClose={() => setTrackingFor(null)} />
    </>
  );
}

/**
 * Live-location modal for one driver. Subscribes to the global socket
 * stream and re-renders whenever this driver's coords change.
 */
function TrackDriverModal({
  driver,
  liveDrivers,
  liveConnected,
  onClose,
}: {
  driver: DriverRow | null;
  liveDrivers: Record<string, { driverId: string; name?: string; lat: number; lng: number; at: string }>;
  liveConnected: boolean;
  onClose: () => void;
}) {
  // Last known position: prefer live socket data, fallback to a one-shot fetch.
  const detail = useQuery({
    queryKey: ['driver-detail', driver?.id],
    queryFn: async () => (await api.get<DriverRow>(`/drivers/${driver!.id}`)).data,
    enabled: !!driver,
  });

  const liveSnapshot = driver ? liveDrivers[driver.id] : undefined;
  const dbLocation = detail.data?.currentLocation ?? null;

  const point = liveSnapshot
    ? { lat: liveSnapshot.lat, lng: liveSnapshot.lng, at: liveSnapshot.at, source: 'live' as const }
    : dbLocation
      ? { lat: dbLocation.lat, lng: dbLocation.lng, at: detail.data?.currentLocationUpdatedAt ?? null, source: 'db' as const }
      : null;

  return (
    <Modal title={driver ? `Live position of ${driver.user.name}` : 'Live position'} open={!!driver} onClose={onClose} width={720}>
      {driver && (
        <>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div className="muted">
              {formatPhone(driver.user.phone)} · {driver.currentVehicle ? `van ${driver.currentVehicle.plateNo}` : 'no van'}
              {' · '}
              {liveConnected ? 'live updates on' : 'live updates off'}
            </div>
            <StatusChip kind="presence" value={driver.isOnline ? 'ONLINE' : 'OFFLINE'} />
          </div>

          {point ? (
            <>
              <div style={{ height: 360, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <MapContainer center={[point.lat, point.lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
                  <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <RecenterOnChange lat={point.lat} lng={point.lng} />
                  <CircleMarker center={[point.lat, point.lng]} radius={10} className="sf-map__pin" />
                </MapContainer>
              </div>

              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 13 }}>
                <div className="muted">
                  {point.source === 'live' ? 'Live position from the driver app' : 'Last position the driver app sent'}
                  {point.at && <> · {formatDateTime(point.at)}</>}
                </div>
              </div>
            </>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', background: 'var(--surface-2)', borderRadius: 8 }}>
              <p className="muted">No position yet.</p>
              <p className="muted" style={{ fontSize: 12 }}>
                The position shows here once the driver opens the app and goes on duty.
              </p>
            </div>
          )}

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <button className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function RecenterOnChange({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], map.getZoom(), { duration: 0.6 });
  }, [lat, lng, map]);
  return null;
}
