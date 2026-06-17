import { useState, FormEvent } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';

export function LoginScreen() {
  const [phone, setPhone] = useState('+923000000000');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.set);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { phone, password });
      setAuth({ token: data.accessToken, refreshToken: data.refreshToken, role: data.role });
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Login failed');
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

      <form className="card" onSubmit={onSubmit}>
        <h3 style={{ marginBottom: 4 }}>Sign in</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          Admin staff sign in with phone and password.
        </p>

        <label htmlFor="phone">Phone</label>
        <input
          id="phone"
          name="phone"
          autoComplete="username"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+923XXXXXXXXX"
          required
        />

        <label htmlFor="password">Password</label>
        <div style={{ position: 'relative' }}>
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
            minLength={8}
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            style={{
              position: 'absolute', right: 6, top: 6, bottom: 6,
              padding: '0 10px', background: 'transparent',
              border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
            }}
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >{showPassword ? 'Hide' : 'Show'}</button>
        </div>

        {err && (
          <div style={{
            background: 'var(--danger-soft)', color: 'var(--danger)',
            padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13,
          }}>{err}</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="submit"
            className="primary"
            disabled={loading}
            style={{ flex: 1 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>

      <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 12 }}>
        Drivers and distributors sign in from the mobile app using one-time codes.
      </p>
    </div>
  );
}
