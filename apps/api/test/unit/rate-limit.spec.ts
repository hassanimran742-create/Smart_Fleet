import { Logger, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RATE_LIMITS_KEY, RateLimit, RateLimitGuard, type RateLimitRule } from '../../src/common/rate-limit/rate-limit';
import { RateLimitService, type RateLimitStore } from '../../src/common/rate-limit/rate-limit.service';

/** A Redis stand-in that runs the INCR + EXPIRE script in memory. */
class MemoryStore implements RateLimitStore {
  counts = new Map<string, number>();
  keys: string[] = [];
  async eval(_script: string, _numKeys: number, key: string | number): Promise<unknown> {
    const k = String(key);
    this.keys.push(k);
    const n = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, n);
    return n;
  }
}

const config = new ConfigService({ redis: { keyPrefix: 'sf-test' } });

describe('RateLimitService (API_CONTRACT §3.6)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('counts hits in a fixed window and blocks past the limit', async () => {
    const store = new MemoryStore();
    const limiter = new RateLimitService(config).useStore(store);
    const now = Date.parse('2026-10-21T10:00:30Z');
    const hits = [];
    for (let i = 0; i < 6; i++) hits.push(await limiter.hit('auth.login.phone', '+923001234567', 5, 600, now));
    expect(hits.map((hit) => hit.allowed)).toEqual([true, true, true, true, true, false]);
    // 10:00:30 is 30 s into the 10:00-10:10 window.
    expect(hits[5].retryAfterSeconds).toBe(570);
  });

  it('starts a new window afterwards, and keys by environment prefix without the raw identity', async () => {
    const store = new MemoryStore();
    const limiter = new RateLimitService(config).useStore(store);
    await limiter.hit('auth.login.phone', '+923001234567', 1, 600, Date.parse('2026-10-21T10:00:00Z'));
    const later = await limiter.hit('auth.login.phone', '+923001234567', 1, 600, Date.parse('2026-10-21T10:10:00Z'));
    expect(later.allowed).toBe(true);
    expect(store.keys[0]).toMatch(/^sf-test:rl:auth\.login\.phone:[0-9a-f]{32}:\d+$/);
    expect(store.keys.join(' ')).not.toContain('923001234567');
    expect(store.keys[0]).not.toBe(store.keys[1]);
  });

  it('lets requests through when Redis fails or is slow', async () => {
    const failing: RateLimitStore = { eval: async () => Promise.reject(new Error('ECONNREFUSED')) };
    const limiter = new RateLimitService(config).useStore(failing);
    await expect(limiter.hit('files.upload', 'u-1', 1, 3600)).resolves.toMatchObject({ allowed: true });

    jest.useFakeTimers();
    try {
      const hanging: RateLimitStore = { eval: () => new Promise(() => undefined) };
      const slow = new RateLimitService(config).useStore(hanging).hit('files.upload', 'u-1', 1, 3600);
      jest.advanceTimersByTime(600);
      await expect(slow).resolves.toMatchObject({ allowed: true });
    } finally {
      jest.useRealTimers();
    }
  });
});

class LoginController {
  @RateLimit('auth.login.phone', 2, 600, (req) => (req.body as { phone?: string } | undefined)?.phone)
  @RateLimit('auth.login.ip', 30, 600, 'ip')
  login() {}
}

describe('@RateLimit and RateLimitGuard', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('stacks rules on a handler and attaches the guard once', () => {
    const rules: RateLimitRule[] = Reflect.getMetadata(RATE_LIMITS_KEY, LoginController.prototype.login);
    expect(rules.map((rule) => rule.name).sort()).toEqual(['auth.login.ip', 'auth.login.phone']);
    expect(Reflect.getMetadata(GUARDS_METADATA, LoginController.prototype.login)).toEqual([RateLimitGuard]);
  });

  it('answers 429 RATE_LIMITED with minutes and Retry-After once a rule is over its limit', async () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitService(config).useStore(new MemoryStore()));
    const headers: Record<string, string> = {};
    const ctx = {
      getType: () => 'http',
      getHandler: () => LoginController.prototype.login,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '10.0.0.1', body: { phone: '+923001234567' } }),
        getResponse: () => ({ setHeader: (name: string, value: string) => (headers[name] = value) }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const error = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'RATE_LIMITED' });
    expect((error as { details: { minutes: number } }).details.minutes).toBeGreaterThanOrEqual(1);
    expect((error as { details: { minutes: number } }).details.minutes).toBeLessThanOrEqual(10);
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('refuses nonsense limits when the route is declared', () => {
    expect(() => RateLimit('x', 0, 60)).toThrow();
  });
});
