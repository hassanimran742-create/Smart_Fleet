/**
 * setupFilesAfterEnv for `npm run test:e2e`: runs inside every suite (test file).
 * Each suite starts from an empty, freshly seeded database and closes its connection at the end.
 * Suites run one at a time (maxWorkers 1 in jest-e2e.json), so truncating can't hit a neighbour.
 *
 * Each suite also starts with no rate-limit windows in this run's Redis namespace
 * (`<BULLMQ_PREFIX>:rl:*`, API_CONTRACT §3.6). Every request counts toward the per-IP sign-in limit
 * (30 per 10 minutes) and all suites call from 127.0.0.1, so without this a suite that signs in a lot
 * (the review's fuzz run) would leave a later suite's first sign-in a 429.
 */
import Redis from 'ioredis';
import { disconnectTestPrisma, hasTestDb, resetDb } from './db';

/** Deletes this run's rate-limit windows. Redis being down is fine: the limiter then lets requests through. */
async function clearRateLimitWindows(): Promise<void> {
  const prefix = process.env.BULLMQ_PREFIX || 'bull';
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:rl:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // No Redis: nothing is counted either.
  } finally {
    redis.disconnect();
  }
}

if (hasTestDb) {
  beforeAll(async () => {
    await resetDb();
    await clearRateLimitWindows();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });
}
