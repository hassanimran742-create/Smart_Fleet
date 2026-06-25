import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';

interface Props {
  userId: string;
  userName?: string | null;
  /** Optional inline style override for the button. */
  style?: any;
  /** Optional callback after a successful reset. */
  onDone?: () => void;
}

/**
 * Tiny admin action that resets a user's password.
 *
 * Click opens a small inline panel with a password input + Save. Once saved,
 * the just-typed value is shown one time so the operator can read it back
 * (e.g. to dictate it to the user over the phone). We never expose the
 * existing hash — passwords are argon2-hashed server-side and not reversible.
 */
export function PasswordResetButton({ userId, userName, style, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setPwd('');
    setSavedValue(null);
    setErr(null);
    setShow(false);
  }

  const mut = useMutation({
    mutationFn: () => api.post(`/users/${userId}/password`, { password: pwd }).then((r) => r.data),
    onSuccess: () => {
      setSavedValue(pwd);
      setPwd('');
      setErr(null);
      onDone?.();
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Failed to reset password'),
  });

  function suggest() {
    // Simple readable password generator (4 lowercase + 4 digits) — operator
    // can edit it before saving if they want something else.
    const letters = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 4; i++) s += digits[Math.floor(Math.random() * digits.length)];
    setPwd(s);
    setShow(true);
  }

  return (
    <>
      <button
        title={`Set password for ${userName ?? 'user'}`}
        onClick={() => setOpen(true)}
        style={style}
      >🔑</button>
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 18, 27, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="card" style={{ width: 380, maxWidth: '92vw' }}>
            <h3 style={{ marginTop: 0 }}>Reset password</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {userName ?? 'User'} will sign in with this new password from then on. Tell it to them in person or over the phone — we don't store the plaintext.
            </p>

            {savedValue ? (
              <>
                <div style={{
                  background: 'var(--ok-soft, #ecf7ed)',
                  color: '#1f6b2b',
                  padding: '12px 14px', borderRadius: 8,
                  fontFamily: 'monospace', fontSize: 14, marginBottom: 14,
                  wordBreak: 'break-all',
                }}>
                  New password: <strong>{savedValue}</strong>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                  Write it down now — closing this dialog forgets it.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={close}>Done</button>
                </div>
              </>
            ) : (
              <>
                <label>New password (≥ 8 chars)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder="••••••••"
                    style={{ paddingRight: 60 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    style={{
                      position: 'absolute', right: 6, top: 6, bottom: 6,
                      padding: '0 10px', background: 'transparent',
                      border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
                    }}
                  >{show ? 'Hide' : 'Show'}</button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button type="button" onClick={suggest} style={{ fontSize: 12 }}>
                    Suggest a password
                  </button>
                </div>

                {err && (
                  <div style={{
                    background: 'var(--danger-soft)', color: 'var(--danger)',
                    padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
                  }}>{err}</div>
                )}

                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={close}>Cancel</button>
                  <button
                    className="primary"
                    disabled={pwd.length < 8 || mut.isPending}
                    onClick={() => mut.mutate()}
                  >{mut.isPending ? 'Saving…' : 'Save password'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
