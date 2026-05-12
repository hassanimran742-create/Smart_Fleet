import { useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';

export function LoginScreen() {
  const [phone, setPhone] = useState('+923000000000');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.set);

  async function sendOtp() {
    setErr(null);
    try {
      await api.post('/auth/otp/send', { phone });
      setOtpSent(true);
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Failed to send OTP');
    }
  }

  async function verifyOtp() {
    setErr(null);
    try {
      const { data } = await api.post('/auth/otp/verify', { phone, code });
      setAuth({ token: data.accessToken, refreshToken: data.refreshToken, role: data.role });
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Invalid code');
    }
  }

  return (
    <div className="login">
      <h2>Smart_Fleet Admin</h2>
      <div className="card">
        <label>Phone</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+923XXXXXXXXX" />
        {otpSent && (
          <>
            <label>OTP code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
          </>
        )}
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <div style={{ marginTop: 12 }}>
          {!otpSent ? (
            <button className="primary" onClick={sendOtp}>Send OTP</button>
          ) : (
            <button className="primary" onClick={verifyOtp}>Verify & Login</button>
          )}
        </div>
      </div>
      <p className="muted">Dev: use phone +923000000000 — the SMS provider is in mock mode and the code is printed in the API logs.</p>
    </div>
  );
}
