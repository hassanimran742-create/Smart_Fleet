import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { uploadFile } from '../api/upload';

const CNIC_REGEX = /^\d{5}-?\d{7}-?\d$/;

export function DriversScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: async () => (await api.get('/vehicles')).data });

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    cnic: '',
    licenceNo: '',
    profilePictureUrl: '',
  });
  const [picPreview, setPicPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pickPicture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErr('Picture must be < 5 MB');
      return;
    }
    setErr(null);
    setUploading(true);
    try {
      setPicPreview(URL.createObjectURL(file));
      const { url } = await uploadFile(file);
      setForm((f) => ({ ...f, profilePictureUrl: url }));
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const create = useMutation({
    mutationFn: () => {
      if (!form.name || !form.phone || !form.licenceNo) {
        throw new Error('Name, phone, and licence number are required');
      }
      if (!/^\+923\d{9}$/.test(form.phone)) {
        throw new Error('Phone must be in form +923XXXXXXXXX');
      }
      if (form.cnic && !CNIC_REGEX.test(form.cnic)) {
        throw new Error('CNIC must look like 12345-1234567-1');
      }
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        throw new Error('Invalid email');
      }
      return api.post('/drivers', form).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      setForm({ name: '', phone: '', email: '', cnic: '', licenceNo: '', profilePictureUrl: '' });
      setPicPreview(null);
      setErr(null);
    },
    onError: (e: any) => setErr(e?.message ?? 'Failed'),
  });

  const assignVehicle = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string | null }) =>
      api.patch(`/drivers/${id}/vehicle`, { vehicleId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });

  return (
    <>
      <h2>Drivers</h2>

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
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#9ca3af', fontSize: 12,
              }}
            >
              {!picPreview && '120 × 120'}
            </div>
            <input type="file" accept="image/*" onChange={pickPicture} style={{ marginTop: 8 }} />
            {uploading && <p className="muted">Uploading…</p>}
          </div>
          <div style={{ flex: 1 }}>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Driver full name" />
            <label>Phone (PK mobile) *</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+923XXXXXXXXX" />
            <label>Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="driver@email.com" />
            <label>CNIC</label>
            <input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="12345-1234567-1" />
            <label>Driving licence # *</label>
            <input value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} />
            {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
            <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()} disabled={uploading}>
              Create driver
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th></th><th>Name</th><th>Phone</th><th>Email</th><th>CNIC</th><th>Licence</th><th>Online</th><th>Vehicle</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((d: any) => (
              <tr key={d.id}>
                <td>
                  {d.user?.profilePictureUrl ? (
                    <img
                      src={d.user.profilePictureUrl}
                      alt={d.user?.name}
                      style={{ width: 32, height: 32, borderRadius: 16, objectFit: 'cover' }}
                    />
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
                  <select
                    value={d.currentVehicleId ?? ''}
                    onChange={(e) => assignVehicle.mutate({ id: d.id, vehicleId: e.target.value || null })}
                  >
                    <option value="">— none —</option>
                    {(vehicles.data ?? []).map((v: any) => (
                      <option key={v.id} value={v.id}>{v.plateNo}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
