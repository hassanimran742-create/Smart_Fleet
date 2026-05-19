import { useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';

export function LoginScreen() {
  const [phone, setPhone] = useState('+923000000000');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.set);

  async function sendOtp() {
    setErr(null);
    setLoading(true);
    try {
      await api.post('/auth/otp/send', { phone });
      setOtpSent(true);
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setErr(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/otp/verify', { phone, code });
      setAuth({ token: data.accessToken, refreshToken: data.refreshToken, role: data.role });
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'var(--primary)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            fontSize: 24, fontWeight: 700,
            boxShadow: '0 8px 24px rgba(15, 108, 240, .35)',
          }}
        >LPG</div>
        <h2 style={{ marginBottom: 6 }}>LPG Management</h2>
        <p className="muted" style={{ margin: 0 }}>Delivery & operations console</p>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>{otpSent ? 'Enter your code' : 'Sign in'}</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          {otpSent
            ? `We sent a 6-digit code to ${phone}.`
            : 'Phone-based one-time-password login.'}
        </p>

        <label>Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+923XXXXXXXXX"
          disabled={otpSent}
        />
        {otpSent && (
          <>
            <label>OTP code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              autoFocus
              maxLength={6}
            />
          </>
        )}
        {err && (
          <div style={{
            background: 'var(--danger-soft)', color: 'var(--danger)',
            padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
          }}>{err}</div>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          {!otpSent ? (
            <button className="primary" onClick={sendOtp} disabled={loading} style={{ flex: 1 }}>
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          ) : (
            <>
              <button onClick={() => { setOtpSent(false); setCode(''); }}>Back</button>
              <button className="primary" onClick={verifyOtp} disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
        Dev: use <code>+923000000000</code> — SMS is in mock mode, the code prints in the API terminal.
      </p>
    </div>
  );
}
