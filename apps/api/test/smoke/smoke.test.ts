// Smoke tests run against a real deployed environment.
// Set API_BASE_URL (default: http://localhost:3000/api/v1).
// They MUST be safe to run repeatedly against staging — no destructive ops.

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';

const describeRemote = process.env.API_BASE_URL ? describe : describe.skip;

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

  it('POST /auth/otp/request → 200 or 400 (rate limit), never 5xx', async () => {
    const res = await fetch(`${BASE}/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+923000000000', purpose: 'LOGIN' }),
    });
    expect([200, 201, 400, 429]).toContain(res.status);
  });
});
