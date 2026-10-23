import type { Prisma, PrismaClient } from '@prisma/client';

/** A Prisma client or the client of an open transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A transaction client (every write that must commit together runs on one). Raw SQL in these modules
 * writes times as `(now() AT TIME ZONE 'UTC')`: Prisma DateTime columns are timestamp(3) holding UTC
 * (DATA_MODEL §5.4), whatever the session's time zone.
 */
export type Tx = Prisma.TransactionClient;

/**
 * Options for transactions that take row locks (`SELECT … FOR UPDATE`): a request may wait behind a
 * racing one for its lock, so it gets more than Prisma's default 2 s to start and 5 s to finish.
 */
export const LOCKING_TX = { maxWait: 10_000, timeout: 20_000 } as const;
