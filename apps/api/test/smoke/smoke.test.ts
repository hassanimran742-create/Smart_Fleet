// Smoke tests run against a real deployed environment (deploy-staging.yml runs them after each deploy).
// Set API_BASE_URL (default: http://localhost:3000/api/v1). Optional:
// - EXPECTED_VERSION: the commit the deploy built; GET /health must report it as `version`;
// - WEBSITE_ORIGIN: the office website's origin; a CORS preflight from it must be allowed.
// They MUST be safe to run repeatedly against staging — no destructive ops.

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';
const EXPECTED_VERSION = process.env.EXPECTED_VERSION?.trim() || undefined;
const WEBSITE_ORIGIN = process.env.WEBSITE_ORIGIN?.trim() || undefined;

const describeRemote = process.env.API_BASE_URL ? describe : describe.skip;
const itWhen = (value: string | undefined) => (value ? it : it.skip);

describeRemote('smoke @ ' + BASE, () => {
  jest.setTimeout(30_000);

  it('GET /health/live → 200', async () => {
    const res = await fetch(`${BASE}/health/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /health → reports DB ok', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks?: { database?: { ok?: boolean } } };
    expect(body.checks?.database?.ok).toBe(true);
  });

  itWhen(EXPECTED_VERSION)('GET /health → reports the deployed commit as its version', async () => {
    const res = await fetch(`${BASE}/health`);
    const body = (await res.json()) as { version?: string };
    expect(body.version).toBe(EXPECTED_VERSION);
  });

  it('GET /app/config → 200 with the public config the apps read at start', async () => {
    const res = await fetch(`${BASE}/app/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { environment?: unknown; minVersion?: unknown; features?: unknown };
    expect(body).toEqual(expect.objectContaining({ environment: expect.any(String), minVersion: expect.any(Object), features: expect.any(Object) }));
  });

  it('POST /auth/otp/send → 403 AUTH_OTP_DISABLED (code sign-in is off in the pilot), never 5xx', async () => {
    const res = await fetch(`${BASE}/auth/otp/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+923000000000' }),
    });
    const body = (await res.json()) as { code?: string };
    expect({ status: res.status, code: body.code }).toEqual({ status: 403, code: 'AUTH_OTP_DISABLED' });
  });

  itWhen(WEBSITE_ORIGIN)('a CORS preflight from the office website origin is allowed', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: WEBSITE_ORIGIN as string,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization,x-request-id',
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEBSITE_ORIGIN);
  });
});
