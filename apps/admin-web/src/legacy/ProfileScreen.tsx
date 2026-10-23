import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginResponse } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor, toApiError } from '../api/errors';
import { translateDynamic } from '../i18n';
import { formatPhone } from '../i18n/format';
import { useAuthStore } from '../store/auth';
import { useToast } from '../ui';

/**
 * The office user's own profile and password ("My profile"), kept inside the shell for Inc 1 (UX_ADMIN
 * §1.2). Touched for the Inc 1 API (API_CONTRACT §7.1, §7.2):
 * - `PATCH /users/me` changes only the name and email; the sign-in phone is shown, not edited (a body
 *   naming the phone or CNIC is refused whole), and no CNIC is shown at all;
 * - `POST /auth/change-password` ends every other session and returns new tokens, which this screen
 *   keeps, so the person stays signed in here;
 * - the role in words, and failures in the catalogue's words.
 */
interface Me {
  name: string | null;
  phone: string;
  email: string | null;
}

export function ProfileScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const role = useAuthStore((s) => s.role);
  const roleWords = (role && translateDynamic(`common:roleName.${role}`)) || '';

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<Me>('/users/me')).data,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileErr, setProfileErr] = useState<string | null>(null);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.name ?? '');
    setEmail(me.data.email ?? '');
  }, [me.data]);

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/users/me', { name: name.trim(), email: email.trim() || null }).then((r) => r.data),
    onSuccess: () => {
      setProfileErr(null);
      toast.success('Profile saved.');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => setProfileErr(messageFor(e)),
  });

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  const changePwd = useMutation({
    mutationFn: () =>
      api.post<LoginResponse>('/auth/change-password', { currentPassword: currentPwd, newPassword: newPwd }).then((r) => r.data),
    onSuccess: (session) => {
      // The change ends every other session; keep this one going with the new tokens.
      useAuthStore.getState().setTokens({ token: session.accessToken, refreshToken: session.refreshToken, role: session.role });
      setPwdErr(null);
      setCurrentPwd('');
      setNewPwd('');
      setNewPwd2('');
      toast.success('Password changed. Use the new one next time you sign in.');
    },
    onError: (e) => {
      const wrongCurrent = toApiError(e).fields.some((field) => field.path === 'currentPassword');
      setPwdErr(wrongCurrent ? "Your current password isn't right." : messageFor(e));
    },
  });

  const passwordsMatch = newPwd === newPwd2;
  const canSubmitPwd = currentPwd.length > 0 && newPwd.length >= 8 && passwordsMatch && !changePwd.isPending;
  const unchanged = me.data ? name.trim() === (me.data.name ?? '') && email.trim() === (me.data.email ?? '') : true;

  return (
    <>
      <h2 style={{ marginBottom: 8 }}>My profile</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        Your name, email and password.{roleWords ? <> You're signed in as <strong>{roleWords}</strong>.</> : null}
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        {me.isError ? (
          <>
            <p style={{ color: 'var(--danger-fg)' }}>{messageFor(me.error)}</p>
            <button onClick={() => void me.refetch()}>Try again</button>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              <div>
                <label htmlFor="prof-name">Name</label>
                <input id="prof-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
              </div>
              <div>
                <label htmlFor="prof-email">
                  Email <span className="muted">(optional)</span>
                </label>
                <input id="prof-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>Sign-in mobile number</span>
                <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{me.data ? formatPhone(me.data.phone) : '…'}</p>
                <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Engineering changes this number if it ever needs to change.</p>
              </div>
            </div>

            {profileErr && <p style={{ color: 'var(--danger-fg)', marginTop: 12 }}>{profileErr}</p>}

            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="primary"
                disabled={saveProfile.isPending || !name.trim() || unchanged}
                onClick={() => saveProfile.mutate()}
              >
                {saveProfile.isPending ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Changing it signs you out everywhere else. If you forget it, ask engineering to set a new one.
        </p>

        <label htmlFor="pwd-curr">Current password</label>
        <input
          id="pwd-curr"
          type="password"
          autoComplete="current-password"
          value={currentPwd}
          onChange={(e) => setCurrentPwd(e.target.value)}
        />

        <label htmlFor="pwd-new">New password (at least 8 characters)</label>
        <div style={{ position: 'relative' }}>
          <input
            id="pwd-new"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            aria-label={showNew ? 'Hide the new password' : 'Show the new password'}
            aria-pressed={showNew}
            onClick={() => setShowNew((v) => !v)}
            style={{
              position: 'absolute',
              right: 6,
              top: 6,
              bottom: 6,
              padding: '0 10px',
              background: 'transparent',
              border: 'none',
              color: 'var(--primary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {showNew ? 'Hide' : 'Show'}
          </button>
        </div>

        <label htmlFor="pwd-new2">Type the new password again</label>
        <input
          id="pwd-new2"
          type={showNew ? 'text' : 'password'}
          autoComplete="new-password"
          value={newPwd2}
          onChange={(e) => setNewPwd2(e.target.value)}
        />
        {!passwordsMatch && newPwd2.length > 0 && (
          <p style={{ color: 'var(--danger-fg)', fontSize: 12, marginTop: 4 }}>The two new passwords don't match.</p>
        )}

        {pwdErr && <p style={{ color: 'var(--danger-fg)', marginTop: 12 }}>{pwdErr}</p>}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="primary" disabled={!canSubmitPwd} onClick={() => changePwd.mutate()}>
            {changePwd.isPending ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </div>
    </>
  );
}
