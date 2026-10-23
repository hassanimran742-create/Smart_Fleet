/**
 * Sign-in limits and the switched-off code sign-in (API_CONTRACT §3.6, §7.1): SEC-007 and SEC-008.
 * SEC-007 counts in the test Redis (REDIS_URL), under this suite's own BULLMQ_PREFIX.
 */
import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES, type StandardData } from '../helpers/standard-data';
import { RateLimitService } from '../../src/common/rate-limit/rate-limit.service';
import { SmsService } from '../../src/modules/sms/sms.service';
import { login, setPassword, APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

describeDb('auth: rate limits and code sign-in', () => {
  let app: INestApplication;
  let redis: Redis;
  let std: StandardData;
  const db = () => getTestPrisma();
  const prefix = process.env.BULLMQ_PREFIX || 'bull';

  /** Deletes this suite's rate-limit windows ("move past the window"). */
  async function clearWindows(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:rl:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  beforeAll(async () => {
    app = await createTestApp();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
    await clearWindows();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await clearWindows();
    redis?.disconnect();
    await app?.close();
  });

  it('SEC-007 sign-in and token refresh are rate limited', async () => {
    await setPassword(std.DA.userId, 'Shop!Pass2026');
    await setPassword(std.DR1.userId, 'Driver#2026');
    // Step 1: five wrong passwords, then the right one.
    for (let i = 0; i < 5; i++) {
      expect((await login(app, STANDARD_PHONES.DA, `Wrong#Pass${i}`).expect(401)).body.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    const blocked = await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.body.details.minutes).toBeGreaterThanOrEqual(1);
    expect(blocked.body.details.minutes).toBeLessThanOrEqual(10);
    expect(blocked.body.message).toBe(`Too many tries. Please wait ${blocked.body.details.minutes} min and try again.`);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.accessToken).toBeUndefined();
    // Step 2: past the window.
    await clearWindows();
    await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
    // Step 3: 30 unknown numbers from one IP, then a right password: the 31st request is refused.
    await clearWindows();
    for (let i = 0; i < 30; i++) {
      const phone = `0345 ${String(7000000 + i)}`;
      expect((await login(app, phone, 'Anything123').expect(401)).body.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    expect((await login(app, STANDARD_PHONES.DR1, 'Driver#2026').expect(429)).body.code).toBe('RATE_LIMITED');
    // Step 4: 30 refreshes from one IP within a minute, then a 31st.
    await clearWindows();
    for (let i = 0; i < 30; i++) {
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: `not-a-token-${i}` }).expect(401);
    }
    expect((await http(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-token' }).expect(429)).body.code).toBe('RATE_LIMITED');
    // Step 5: Redis down: the guard lets requests through.
    await clearWindows();
    app.get(RateLimitService).useStore({ eval: () => Promise.reject(new Error('Redis is down')) });
    for (let i = 0; i < 6; i++) await login(app, STANDARD_PHONES.DA, 'Shop!Pass2026').expect(200);
  }, 300_000);

  it('SEC-008 code (OTP) sign-in is off, can\'t be switched on over the API, and never creates users', async () => {
    const sms = app.get(SmsService);
    const sent = jest.spyOn(sms, 'send');
    const before = { users: await db().user.count(), codes: await db().otpCode.count() };
    const otpCalls = async () => {
      for (const phone of [STANDARD_PHONES.DA, '0300 9999999']) {
        const res = await http(app).post('/api/v1/auth/otp/send').send({ phone }).expect(403);
        expect(res.body).toMatchObject({ code: 'AUTH_OTP_DISABLED', message: 'Sign in with your password.' });
        expect(res.body.devCode).toBeUndefined();
      }
      const verify = await http(app).post('/api/v1/auth/otp/verify').send({ phone: '0300 9999999', code: '123456' }).expect(403);
      expect(verify.body.code).toBe('AUTH_OTP_DISABLED');
    };
    // Steps 1-3.
    await otpCalls();
    expect({ users: await db().user.count(), codes: await db().otpCode.count() }).toEqual(before);
    expect(await db().user.findUnique({ where: { phone: '+923009999999' } })).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    // Step 4: the switch can't be turned on over the API.
    const office = authHeader(std.SA1.actor);
    const patch = await http(app)
      .patch('/api/v1/settings/auth.otpLogin.enabled')
      .set(office)
      .send({ value: true, reason: 'OTP on-path test' })
      .expect(403);
    expect(patch.body).toMatchObject({ code: 'SETTING_NOT_EDITABLE', message: "This setting can't be changed here." });
    expect(await db().auditLog.count({ where: { action: 'setting.update' } })).toBe(0);
    // Step 5.
    const settings = await http(app).get('/api/v1/settings').set(office).expect(200);
    const row = (settings.body as Array<{ key: string; value: unknown }>).find((r) => r.key === 'auth.otpLogin.enabled');
    expect(row?.value).toBe(false);
    await otpCalls();
    expect(sent).not.toHaveBeenCalled();
  });
});
