import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

interface City { id: string; name: string }
interface Zone { id: string; name: string; cityId?: string }
interface Store { id: string; name: string; zone_id: string }

export function DistributorsScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get('/distributors')).data });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Store[]>('/stores')).data });
  const [showSuspended, setShowSuspended] = useState(false);

  const [cityId, setCityId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [form, setForm] = useState({ phone: '', name: '', businessName: '', cnic: '', email: '', homeStoreId: '' });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editErr, setEditErr] = useState<string | null>(null);

  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => cityId ? (await api.get<Zone[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  // Stores in the picked zone — "area" maps to zone in our schema.
  const storesInZone = (stores.data ?? []).filter((s: any) => s.zone_id === zoneId);

  const CNIC_REGEX = /^\d{5}-?\d{7}-?\d$/;

  // Live duplicate detection — flag matching CNIC / phone against existing.
  const dupByCnic = form.cnic && (data ?? []).find((d: any) => d.user?.cnic === form.cnic);
  const dupByPhone = form.phone && (data ?? []).find((d: any) => d.user?.phone === form.phone);

  // Autocomplete: filter existing on business name as user types
  const businessSuggestions = form.businessName.trim().length >= 2
    ? (data ?? []).filter((d: any) =>
        d.businessName?.toLowerCase().includes(form.businessName.toLowerCase()),
      ).slice(0, 5)
    : [];

  function validateField(name: string, value: string): string | null {
    if (name === 'phone' && value && !/^\+923\d{9}$/.test(value)) return 'Phone must be +923XXXXXXXXX';
    if (name === 'cnic' && value && !CNIC_REGEX.test(value)) return 'CNIC must be 12345-1234567-1';
    if (name === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email';
    return null;
  }

  function setField(name: string, value: string) {
    setForm((f) => ({ ...f, [name]: value }));
    const e = validateField(name, value);
    setFieldErr((p) => ({ ...p, [name]: e ?? '' }));
  }

  function errMsg(e: any) {
    return (
      e?.response?.data?.message ??
      (Array.isArray(e?.response?.data?.message) ? e.response.data.message.join(', ') : null) ??
      e?.message ??
      'Failed'
    );
  }

  const create = useMutation({
    mutationFn: () => {
      // Aggregate inline errors
      const errs: Record<string, string> = {};
      if (!form.phone) errs.phone = 'Phone is required';
      else { const e = validateField('phone', form.phone); if (e) errs.phone = e; }
      if (!form.name) errs.name = 'Contact name is required';
      if (!form.businessName) errs.businessName = 'Business name is required';
      if (form.cnic) { const e = validateField('cnic', form.cnic); if (e) errs.cnic = e; }
      if (form.email) { const e = validateField('email', form.email); if (e) errs.email = e; }
      if (dupByCnic) errs.cnic = `Already exists: ${dupByCnic.businessName}`;
      if (dupByPhone) errs.phone = `Already exists: ${dupByPhone.businessName}`;
      if (Object.keys(errs).length > 0) {
        setFieldErr(errs);
        throw new Error('Fix the highlighted fields');
      }
      return api.post('/distributors', form).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['distributors'] });
      setForm({ phone: '', name: '', businessName: '', cnic: '', email: '', homeStoreId: '' });
      setCityId('');
      setZoneId('');
      setCreateErr(null);
      setFieldErr({});
    },
    onError: (e: any) => setCreateErr(errMsg(e)),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/distributors/${id}/approve`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distributors'] }),
  });
  const suspend = useMutation({
    mutationFn: (id: string) => api.patch(`/distributors/${id}/suspend`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distributors'] }),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/distributors/${editing.id}`, {
        businessName: editForm.businessName,
        name: editForm.contactName,
        email: editForm.email,
        phone: editForm.phone,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['distributors'] }); setEditing(null); setEditErr(null); },
    onError: (e: any) => setEditErr(errMsg(e)),
  });

  const rows = (data ?? []).filter((d: any) => showSuspended || d.status !== 'SUSPENDED');

  function openEdit(d: any) {
    setEditing(d);
    setEditForm({
      businessName: d.businessName,
      contactName: d.user?.name,
      email: d.user?.email ?? '',
      phone: d.user?.phone,
    });
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Distributors</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showSuspended} onChange={(e) => setShowSuspended(e.target.checked)} />
          show suspended
        </label>
      </div>

      <div className="card">
        <h3>Add distributor partner</h3>

        <label>Phone *</label>
        <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+923XXXXXXXXX" />
        {fieldErr.phone && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{fieldErr.phone}</p>}

        <label>Contact name *</label>
        <input value={form.name} onChange={(e) => setField('name', e.target.value)} />
        {fieldErr.name && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{fieldErr.name}</p>}

        <label>Business name *</label>
        <div style={{ position: 'relative' }}>
          <input
            value={form.businessName}
            onChange={(e) => setField('businessName', e.target.value)}
            placeholder="Start typing to see suggestions…"
          />
          {businessSuggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
              background: 'white', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: 'var(--shadow-md)', maxHeight: 180, overflow: 'auto', marginTop: 4,
            }}>
              {businessSuggestions.map((s: any) => (
                <div
                  key={s.id}
                  style={{ padding: 8, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-soft)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                  onClick={() => {
                    // Pre-fill from existing — useful for review / duplicate-check
                    setForm({ ...form, businessName: s.businessName, phone: s.user?.phone ?? '', name: s.user?.name ?? '', cnic: s.user?.cnic ?? '', email: s.user?.email ?? '' });
                  }}
                >
                  <strong>{s.businessName}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>{s.user?.phone} · {s.status}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {fieldErr.businessName && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{fieldErr.businessName}</p>}

        <label>CNIC</label>
        <input value={form.cnic} onChange={(e) => setField('cnic', e.target.value)} placeholder="12345-1234567-1" />
        {fieldErr.cnic && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{fieldErr.cnic}</p>}

        <label>Email</label>
        <input value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="optional" />
        {fieldErr.email && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{fieldErr.email}</p>}

        <h4 style={{ marginTop: 20, marginBottom: 4 }}>Service area</h4>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Pick the city and area (zone) the distributor operates out of. The home store is then chosen from
          the matching zone.
        </p>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>City</label>
            <select
              value={cityId}
              onChange={(e) => { setCityId(e.target.value); setZoneId(''); setForm((f) => ({ ...f, homeStoreId: '' })); }}
            >
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Area / zone</label>
            <select
              value={zoneId}
              disabled={!cityId}
              onChange={(e) => { setZoneId(e.target.value); setForm((f) => ({ ...f, homeStoreId: '' })); }}
            >
              <option value="">— pick a zone —</option>
              {(zones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            {cityId && zones.data && zones.data.length === 0 && (
              <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                No zones covering this city. Create a zone on the Zones page first.
              </p>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <label>Home store</label>
            <select
              value={form.homeStoreId}
              disabled={!zoneId}
              onChange={(e) => setForm({ ...form, homeStoreId: e.target.value })}
            >
              <option value="">— optional —</option>
              {storesInZone.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {zoneId && storesInZone.length === 0 && (
              <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                No store in this zone yet. Create one on the Stores page first.
              </p>
            )}
          </div>
        </div>

        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Business</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th><th>Balance</th><th></th></tr></thead>
          <tbody>
            {rows.map((d: any) => (
              <tr key={d.id} style={{ opacity: d.status === 'SUSPENDED' ? 0.5 : 1 }}>
                <td>{d.businessName}</td>
                <td>{d.user?.name}</td>
                <td>{d.user?.phone}</td>
                <td>{d.user?.email ?? '—'}</td>
                <td>{d.status}</td>
                <td>{Number(d.advanceBalancePaisa) / 100} PKR</td>
                <td>
                  <button onClick={() => openEdit(d)}>Edit</button>{' '}
                  {d.status === 'PENDING' && <button className="primary" onClick={() => approve.mutate(d.id)}>Approve</button>}
                  {d.status === 'ACTIVE' && (
                    <button
                      style={{ color: 'var(--danger)' }}
                      onClick={() => { if (confirmDialog(`Suspend distributor "${d.businessName}"?`)) suspend.mutate(d.id); }}
                    >Suspend</button>
                  )}
                  {d.status === 'SUSPENDED' && <button onClick={() => approve.mutate(d.id)}>Reinstate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit distributor" open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <label>Business name</label>
            <input value={editForm.businessName ?? ''} onChange={(e) => setEditForm({ ...editForm, businessName: e.target.value })} />
            <label>Contact name</label>
            <input value={editForm.contactName ?? ''} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} />
            <label>Phone</label>
            <input value={editForm.phone ?? ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <label>Email</label>
            <input value={editForm.email ?? ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            {editErr && <p style={{ color: 'var(--danger)' }}>{editErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Cancel</button>{' '}
              <button className="primary" onClick={() => update.mutate()}>Save</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
