/**
 * CORS for the office website (API_CONTRACT §1.2, §3.7): SEC-018. The API under test runs with
 * CORS_ORIGINS set to the test website's origin only.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { signAccessToken } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { connectDrivers, listen, preflight, type SocketEvents, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

const WEBSITE = 'https://office.test.smartfleet.example';

describeDb('CORS: only the office website', () => {
  let app: INestApplication;
  let baseUrl: string;
  let std: StandardData;
  const open: SocketEvents[] = [];
  const previous = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = WEBSITE;
    app = await createTestApp();
    baseUrl = await listen(app);
    await resetDb();
    std = await createStandardData();
  }, APP_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    for (const client of open.splice(0)) client.socket.disconnect();
    await app?.close();
    if (previous === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previous;
  });

  it('SEC-018 CORS answers only our own website\'s origin', async () => {
    const ask = (origin: string) =>
      preflight(app, '/api/v1/orders')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization, idempotency-key, x-app-variant');
    // Step 1.
    const ok = await ask(WEBSITE);
    expect(ok.headers['access-control-allow-origin']).toBe(WEBSITE);
    const allowed = String(ok.headers['access-control-allow-headers']).toLowerCase();
    for (const header of ['authorization', 'idempotency-key', 'x-app-variant']) expect(allowed).toContain(header);
    // Step 2.
    const config = await http(app).get('/api/v1/app/config').set('Origin', WEBSITE).expect(200);
    const exposed = String(config.headers['access-control-expose-headers']).toLowerCase();
    for (const header of ['x-request-id', 'idempotent-replay', 'x-already-applied', 'x-feature-disabled']) expect(exposed).toContain(header);
    // Step 3.
    for (const origin of ['https://evil.example', 'null']) {
      expect((await ask(origin)).headers['access-control-allow-origin']).toBeUndefined();
      const res = await http(app).get('/api/v1/app/config').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    // Step 4: the socket handshake from another origin is refused; the website and the apps (no Origin) connect.
    const evil = connectDrivers(baseUrl, signAccessToken(std.SA1.actor), { origin: 'https://evil.example' });
    open.push(evil);
    await evil.next('connect_error');
    expect(evil.events.some((e) => e.event === 'connect')).toBe(false);
    const website = connectDrivers(baseUrl, signAccessToken(std.SA1.actor), { origin: WEBSITE });
    const phone = connectDrivers(baseUrl, signAccessToken(std.DR1.actor));
    open.push(website, phone);
    await Promise.all([website.next('connect'), phone.next('connect')]);
    await website.next('drivers:snapshot');
  });
});
