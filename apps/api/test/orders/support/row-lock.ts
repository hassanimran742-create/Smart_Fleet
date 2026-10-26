/**
 * Makes a race deterministic: a connection of its own holds `SELECT … FOR UPDATE` on the row the racing
 * requests contend for, the test waits until every request is queued on a lock, then the row is released
 * and they all go at once. A read-modify-write then reads the same stale value in every request, which a
 * single guarded statement never does.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { getTestPrisma } from '../../helpers/db';

export interface HeldRowLock {
  /** The backend that holds the lock (never counted as a waiter). */
  pid: number;
  /** Commits the holding transaction. Safe to call twice. */
  release(): Promise<void>;
}

/** Runs `lock` (a `SELECT … FOR UPDATE`) in a transaction that stays open until `release()`. */
export async function holdRowLock(lock: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<HeldRowLock> {
  const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let open!: () => void;
  const released = new Promise<void>((resolve) => (open = resolve));
  let holding!: (pid: number) => void;
  let failed!: (error: unknown) => void;
  const locked = new Promise<number>((resolve, reject) => {
    holding = resolve;
    failed = reject;
  });
  const done = client.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await lock(tx);
      holding(pid);
      await released;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  done.catch(failed);
  let finished: Promise<void> | null = null;
  const release = () => {
    finished ??= (async () => {
      open();
      try {
        await done;
      } finally {
        await client.$disconnect();
      }
    })();
    return finished;
  };
  try {
    return { pid: await locked, release };
  } catch (error) {
    await release().catch(() => undefined);
    throw error;
  }
}

/** Waits until `count` sessions other than `holder` wait on a lock in a statement that names `table`. */
export async function waitForLockWaiters(holder: HeldRowLock, table: string, count: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [{ waiting }] = await getTestPrisma().$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> ${holder.pid} AND wait_event_type = 'Lock' AND query ILIKE ${`%${table}%`}`;
    if (waiting >= count) return;
    if (Date.now() > deadline) throw new Error(`only ${waiting} of ${count} requests queued on ${table} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
