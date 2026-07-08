import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';

/**
 * Admin's own profile + credentials. Two cards:
 *   1. Profile info — edit name, phone, email (CNIC editable too but optional).
 *   2. Change password — current + new (with confirmation).
 *
 * Both submit to existing endpoints:
 *   PATCH /users/me              (profile fields)
 *   POST  /auth/change-password  (currentPassword, newPassword)
 */
export function ProfileScreen() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
  });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cnic, setCnic] = useState('');
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.name ?? '');
    setPhone(me.data.phone ?? '');
    setEmail(me.data.email ?? '');
    setCnic(me.data.cnic ?? '');
  }, [me.data]);

  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch('/users/me', { name, phone, email: email || undefined, cnic: cnic || undefined }).then((r) => r.data),
    onSuccess: () => {
      setProfileOk(true);
      setProfileErr(null);
      qc.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setProfileOk(false), 2500);
    },
    onError: (e: any) => {
      setProfileOk(false);
      setProfileErr(e?.response?.data?.message ?? 'Failed to save profile');
    },
  });

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdOk, setPwdOk] = useState(false);

  const changePwd = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', { currentPassword: currentPwd, newPassword: newPwd }).then((r) => r.data),
    onSuccess: () => {
      setPwdOk(true);
      setPwdErr(null);
      setCurrentPwd('');
      setNewPwd('');
      setNewPwd2('');
      setTimeout(() => setPwdOk(false), 2500);
    },
    onError: (e: any) => {
      setPwdOk(false);
      setPwdErr(e?.response?.data?.message ?? 'Failed to change password');
    },
  });

  const passwordsMatch = newPwd === newPwd2;
  const canSubmitPwd =
    currentPwd.length > 0 && newPwd.length >= 8 && passwordsMatch && !changePwd.isPending;

  return (
    <>
      <h2 style={{ marginBottom: 8 }}>My profile</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        Update your contact info and password. You're signed in as <strong>{role}</strong>.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label htmlFor="prof-name">Name</label>
            <input id="prof-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
          </div>
          <div>
            <label htmlFor="prof-phone">Phone</label>
            <input id="prof-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+923XXXXXXXXX" />
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Changing the phone here is also the new login phone.
            </p>
          </div>
          <div>
            <label htmlFor="prof-email">Email <span className="muted">(optional)</span></label>
            <input id="prof-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label htmlFor="prof-cnic">CNIC <span className="muted">(optional)</span></label>
            <input id="prof-cnic" value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="XXXXX-XXXXXXX-X" />
          </div>
        </div>

        {profileErr && (
          <div style={{
            background: 'var(--danger-soft)', color: 'var(--danger)',
            padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
          }}>{profileErr}</div>
        )}
        {profileOk && (
          <div style={{
            background: '#ecf7ed', color: '#1f6b2b',
            padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
          }}>Profile saved.</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="primary"
            disabled={saveProfile.isPending || !name || !phone}
            onClick={() => saveProfile.mutate()}
          >{saveProfile.isPending ? 'Saving…' : 'Save profile'}</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          We never store your password in plaintext — it's hashed with argon2. If you ever forget it, ask another admin to reset it for you.
        </p>

        <label htmlFor="pwd-curr">Current password</label>
        <input
          id="pwd-curr"
          type="password"
          autoComplete="current-password"
          value={currentPwd}
          onChange={(e) => setCurrentPwd(e.target.value)}
          placeholder="••••••••"
        />

        <label htmlFor="pwd-new">New password (≥ 8 characters)</label>
        <div style={{ position: 'relative' }}>
          <input
            id="pwd-new"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="••••••••"
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            style={{
              position: 'absolute', right: 6, top: 6, bottom: 6,
              padding: '0 10px', background: 'transparent',
              border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
            }}
          >{showNew ? 'Hide' : 'Show'}</button>
        </div>

        <label htmlFor="pwd-new2">Confirm new password</label>
        <input
          id="pwd-new2"
          type={showNew ? 'text' : 'password'}
          value={newPwd2}
          onChange={(e) => setNewPwd2(e.target.value)}
          placeholder="••••••••"
        />
        {!passwordsMatch && newPwd2.length > 0 && (
          <p className="muted" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
            New password and confirmation don't match.
          </p>
        )}

        {pwdErr && (
          <div style={{
            background: 'var(--danger-soft)', color: 'var(--danger)',
            padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
          }}>{pwdErr}</div>
        )}
        {pwdOk && (
          <div style={{
            background: '#ecf7ed', color: '#1f6b2b',
            padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
          }}>Password changed. Use the new one next time you sign in.</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="primary"
            disabled={!canSubmitPwd}
            onClick={() => changePwd.mutate()}
          >{changePwd.isPending ? 'Saving…' : 'Change password'}</button>
        </div>
      </div>
    </>
  );
}
