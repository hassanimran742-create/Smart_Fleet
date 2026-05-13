import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { uploadFile } from '../api/upload';
import { Modal, confirmDialog } from '../components/Modal';

const CNIC_REGEX = /^\d{5}-?\d{7}-?\d$/;

type Availability = 'AVAILABLE' | 'ON_LEAVE' | 'OFF_DUTY';

interface DriverRow {
  id: string;
  licenceNo: string;
  isOnline: boolean;
  currentVehicleId: string | null;
  availability: Availability;
  leaveStart: string | null;
  leaveEnd: string | null;
  leaveReason: string | null;
  user: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    cnic?: string;
    profilePictureUrl?: string;
    status: string;
  };
}

export function DriversScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get<DriverRow[]>('/drivers')).data });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });
  const [showArchived, setShowArchived] = useState(false);

  // Create form
  const [form, setForm] = useState({ name: '', phone: '', email: '', cnic: '', licenceNo: '', profilePictureUrl: '' });
  const [picPreview, setPicPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Edit modal
  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [editPicPreview, setEditPicPreview] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editErr, setEditErr] = useState<string | null>(null);

  async function pickPicture(e: React.ChangeEvent<HTMLInputElement>, target: 'create' | 'edit') {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      const setter = target === 'create' ? setCreateErr : setEditErr;
      setter('Picture must be < 5 MB');
      return;
    }
    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      if (target === 'create') setPicPreview(preview); else setEditPicPreview(preview);
      const { url } = await uploadFile(file);
      if (target === 'create') setForm((f) => ({ ...f, profilePictureUrl: url }));
      else setEditForm((f: any) => ({ ...f, profilePictureUrl: url }));
    } catch (e: any) {
      const setter = target === 'create' ? setCreateErr : setEditErr;
      setter(e?.response?.data?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.name || !form.phone || !form.licenceNo) throw new Error('Name, phone, and licence are required');
      if (!/^\+923\d{9}$/.test(form.phone)) throw new Error('Phone must be +923XXXXXXXXX');
      if (form.cnic && !CNIC_REGEX.test(form.cnic)) throw new Error('CNIC must look like 12345-1234567-1');
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) throw new Error('Invalid email');
      return api.post('/drivers', form).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      setForm({ name: '', phone: '', email: '', cnic: '', licenceNo: '', profilePictureUrl: '' });
      setPicPreview(null);
      setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(e?.message ?? 'Failed'),
  });

  const update = useMutation({
    mutationFn: () => api.patch(`/drivers/${editing!.id}/profile`, editForm).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      setEditing(null);
      setEditPicPreview(null);
      setEditErr(null);
    },
    onError: (e: any) => setEditErr(e?.response?.data?.message ?? 'Failed'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/drivers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/drivers/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });

  const assignVehicle = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string | null }) =>
      api.patch(`/drivers/${id}/vehicle`, { vehicleId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });

  const setAvailability = useMutation({
    mutationFn: (payload: {
      id: string;
      availability: Availability;
      leaveStart?: string;
      leaveEnd?: string;
      reason?: string;
    }) =>
      api
        .patch(`/drivers/${payload.id}/availability`, {
          availability: payload.availability,
          leaveStart: payload.leaveStart,
          leaveEnd: payload.leaveEnd,
          reason: payload.reason,
        })
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });

  // Leave modal state
  const [leaveFor, setLeaveFor] = useState<DriverRow | null>(null);
  const [leaveForm, setLeaveForm] = useState<{ leaveStart: string; leaveEnd: string; reason: string }>(
    { leaveStart: '', leaveEnd: '', reason: '' },
  );
  const [leaveErr, setLeaveErr] = useState<string | null>(null);

  const rows = (data ?? []).filter((d) => showArchived || d.user.status !== 'SUSPENDED');

  function openEdit(d: DriverRow) {
    setEditing(d);
    setEditForm({
      name: d.user.name,
      email: d.user.email ?? '',
      cnic: d.user.cnic ?? '',
      licenceNo: d.licenceNo,
      profilePictureUrl: d.user.profilePictureUrl ?? '',
    });
    setEditPicPreview(d.user.profilePictureUrl ?? null);
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Drivers</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
      </div>

      <div className="card">
        <h3>Add driver</h3>
        <div className="flex" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div style={{ width: 140, textAlign: 'center' }}>
            <label>Profile picture</label>
            <div
              style={{
                width: 120, height: 120, borderRadius: 60, border: '1px solid var(--border)',
                backgroundColor: '#f3f4f6', backgroundSize: 'cover', backgroundPosition: 'center',
                backgroundImage: picPreview ? `url(${picPreview})` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12,
              }}
            >{!picPreview && '120 × 120'}</div>
            <input type="file" accept="image/*" onChange={(e) => pickPicture(e, 'create')} style={{ marginTop: 8 }} />
            {uploading && <p className="muted">Uploading…</p>}
          </div>
          <div style={{ flex: 1 }}>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>Phone (PK mobile) *</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+923XXXXXXXXX" />
            <label>Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>CNIC</label>
            <input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="12345-1234567-1" />
            <label>Driving licence # *</label>
            <input value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} />
            {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
            <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()} disabled={uploading}>
              Create driver
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th></th><th>Name</th><th>Phone</th><th>Email</th><th>CNIC</th><th>Licence</th>
              <th>Online</th><th>Availability</th><th>Vehicle</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const availColor =
                d.availability === 'AVAILABLE' ? '#1ea675'
                  : d.availability === 'ON_LEAVE' ? '#f59e0b'
                  : '#6b6f76';
              return (
                <tr key={d.id} style={{ opacity: d.user.status === 'SUSPENDED' ? 0.5 : 1 }}>
                  <td>
                    {d.user?.profilePictureUrl ? (
                      <img src={d.user.profilePictureUrl} alt={d.user.name} style={{ width: 32, height: 32, borderRadius: 16, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 16, background: '#e3e4e8' }} />
                    )}
                  </td>
                  <td>{d.user?.name}</td>
                  <td>{d.user?.phone}</td>
                  <td>{d.user?.email ?? '—'}</td>
                  <td>{d.user?.cnic ?? '—'}</td>
                  <td>{d.licenceNo}</td>
                  <td>{d.isOnline ? '🟢' : '⚪'}</td>
                  <td>
                    <span style={{ color: availColor, fontWeight: 600, fontSize: 12 }}>● {d.availability}</span>
                    {d.availability === 'ON_LEAVE' && d.leaveEnd && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        until {new Date(d.leaveEnd).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      value={d.currentVehicleId ?? ''}
                      onChange={(e) => assignVehicle.mutate({ id: d.id, vehicleId: e.target.value || null })}
                      disabled={d.user.status === 'SUSPENDED'}
                    >
                      <option value="">— none —</option>
                      {(vehicles.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.plateNo}</option>)}
                    </select>
                  </td>
                  <td style={{ fontSize: 12 }}>{d.user.status}</td>
                  <td>
                    <button onClick={() => openEdit(d)} disabled={d.user.status === 'SUSPENDED'}>Edit</button>{' '}
                    {d.availability !== 'ON_LEAVE' && d.user.status !== 'SUSPENDED' && (
                      <button onClick={() => {
                        setLeaveFor(d);
                        setLeaveForm({ leaveStart: new Date().toISOString().slice(0, 10), leaveEnd: '', reason: '' });
                        setLeaveErr(null);
                      }}>Mark on leave</button>
                    )}{' '}
                    {d.availability === 'ON_LEAVE' && (
                      <button onClick={() => setAvailability.mutate({ id: d.id, availability: 'AVAILABLE' })}>Mark available</button>
                    )}{' '}
                    {d.user.status === 'SUSPENDED' ? (
                      <button onClick={() => reactivate.mutate(d.id)}>Reactivate</button>
                    ) : (
                      <button
                        style={{ color: 'var(--danger)' }}
                        onClick={() => { if (confirmDialog(`Archive driver "${d.user.name}"?`)) archive.mutate(d.id); }}
                      >Archive</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal title="Mark on leave" open={!!leaveFor} onClose={() => setLeaveFor(null)}>
        {leaveFor && (
          <>
            <p>Mark <strong>{leaveFor.user.name}</strong> as ON_LEAVE. They won't be dispatched and any open shift will be closed.</p>
            <label>Start date *</label>
            <input type="date" value={leaveForm.leaveStart} onChange={(e) => setLeaveForm({ ...leaveForm, leaveStart: e.target.value })} />
            <label>End date</label>
            <input type="date" value={leaveForm.leaveEnd} onChange={(e) => setLeaveForm({ ...leaveForm, leaveEnd: e.target.value })} />
            <label>Reason</label>
            <input value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="e.g. annual leave, illness, family" />
            {leaveErr && <p style={{ color: 'var(--danger)' }}>{leaveErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setLeaveFor(null)}>Cancel</button>{' '}
              <button
                className="primary"
                onClick={() => {
                  if (!leaveForm.leaveStart) {
                    setLeaveErr('Start date is required');
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
                    { onSuccess: () => setLeaveFor(null) },
                  );
                }}
              >Confirm leave</button>
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
                    width: 100, height: 100, borderRadius: 50, border: '1px solid var(--border)',
                    backgroundColor: '#f3f4f6', backgroundSize: 'cover', backgroundPosition: 'center',
                    backgroundImage: editPicPreview ? `url(${editPicPreview})` : 'none',
                  }}
                />
                <input type="file" accept="image/*" onChange={(e) => pickPicture(e, 'edit')} style={{ marginTop: 8 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Name</label>
                <input value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                <label>Email</label>
                <input value={editForm.email ?? ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                <label>CNIC</label>
                <input value={editForm.cnic ?? ''} onChange={(e) => setEditForm({ ...editForm, cnic: e.target.value })} />
                <label>Licence #</label>
                <input value={editForm.licenceNo ?? ''} onChange={(e) => setEditForm({ ...editForm, licenceNo: e.target.value })} />
                {editErr && <p style={{ color: 'var(--danger)' }}>{editErr}</p>}
              </div>
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Cancel</button>{' '}
              <button className="primary" onClick={() => update.mutate()} disabled={uploading}>Save</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
