import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis, { type RedisOptions } from 'ioredis';

/** The result of counting one hit in a fixed window. */
export interface RateLimitHit {
  allowed: boolean;
  count: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

/** What the limiter needs from a Redis client (tests pass a fake). */
export interface RateLimitStore {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// INCR, and start the window's expiry on its first hit. One round trip, atomic.
const HIT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

// The window's count without changing it (0 when the key doesn't exist).
const PEEK_SCRIPT = `return tonumber(redis.call('GET', KEYS[1]) or '0')`;

const STORE_TIMEOUT_MS = 500;
const WARN_EVERY_MS = 60_000;

/**
 * Fixed-window counters in Redis for `@RateLimit` (API_CONTRACT §3.6). Keys are
 * `<BULLMQ_PREFIX>:rl:<name>:<sha256(identity)>:<window start>`, so staging and production never
 * share counters and no phone number or IP is stored in clear. **If Redis is down or slow, every
 * request is let through** (and a warning is logged at most once a minute).
 */
@Injectable()
export class RateLimitService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RateLimitService.name);
  private client: Redis | null = null;
  private store: RateLimitStore | null = null;
  private lastWarnAt = 0;

  constructor(private readonly config: ConfigService) {}

  /** Uses `store` instead of connecting to Redis (tests). */
  useStore(store: RateLimitStore): this {
    this.store = store;
    return this;
  }

  async hit(name: string, identity: string, limit: number, windowSeconds: number, nowMs = Date.now()): Promise<RateLimitHit> {
    const { key, retryAfterSeconds } = this.windowKey(name, identity, windowSeconds, nowMs);
    try {
      const count = Number(await withTimeout(this.storeOrConnect().eval(HIT_SCRIPT, 1, key, windowSeconds + 1)));
      if (!Number.isFinite(count)) throw new Error('unexpected reply');
      return { allowed: count <= limit, count, retryAfterSeconds };
    } catch (error) {
      this.warnStoreDown(error);
      return { allowed: true, count: 0, retryAfterSeconds };
    }
  }

  /**
   * The current window's count for `identity` without counting this call, for rules checked in a
   * fixed order before anything is counted (CUSTOMER_PAGE §5). 0 when Redis is down or slow, so a
   * peek, like a hit, fails open.
   */
  async peek(name: string, identity: string, windowSeconds: number, nowMs = Date.now()): Promise<number> {
    const { key } = this.windowKey(name, identity, windowSeconds, nowMs);
    try {
      const count = Number(await withTimeout(this.storeOrConnect().eval(PEEK_SCRIPT, 1, key)));
      return Number.isFinite(count) && count > 0 ? count : 0;
    } catch (error) {
      this.warnStoreDown(error);
      return 0;
    }
  }

  /** `<BULLMQ_PREFIX>:rl:<name>:<first 32 hex of sha256(identity)>:<window start>` and the seconds left. */
  private windowKey(name: string, identity: string, windowSeconds: number, nowMs: number): { key: string; retryAfterSeconds: number } {
    const nowSeconds = Math.floor(nowMs / 1000);
    const windowStart = nowSeconds - (nowSeconds % windowSeconds);
    const retryAfterSeconds = Math.max(1, windowStart + windowSeconds - nowSeconds);
    const prefix = this.config.get<string>('redis.keyPrefix') ?? 'bull';
    const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
    return { key: `${prefix}:rl:${name}:${digest}:${windowStart}`, retryAfterSeconds };
  }

  /** Connects at boot, so the first counted request finds Redis ready (commands never queue). */
  onModuleInit(): void {
    this.storeOrConnect();
  }

  /**
   * Closes the Redis client only once the HTTP server has stopped and its open requests have finished
   * (Nest runs this hook after closing the server, the module-destroy hooks before), so a graceful
   * shutdown never takes the limiter away from a request still in flight.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  private storeOrConnect(): RateLimitStore {
    if (this.store) return this.store;
    const url = this.config.get<string>('redis.url');
    const options: RedisOptions = {
      // Fail fast while disconnected instead of queueing: a request never waits on Redis.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
      lazyConnect: false,
    };
    this.client = url
      ? new Redis(url, { ...options, tls: url.startsWith('rediss://') ? {} : undefined })
      : new Redis({
          ...options,
          host: this.config.get<string>('redis.host') ?? 'localhost',
          port: this.config.get<number>('redis.port') ?? 6379,
        });
    this.client.on('error', (error) => this.warnStoreDown(error));
    this.store = this.client;
    return this.store;
  }

  private warnStoreDown(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_EVERY_MS) return;
    this.lastWarnAt = now;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Rate limits are not enforced while Redis is unavailable: ${reason}`);
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Redis did not answer in ${STORE_TIMEOUT_MS} ms`)), STORE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
