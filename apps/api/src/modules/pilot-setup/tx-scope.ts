import { AsyncLocalStorage } from 'async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * One database transaction for a whole pilot-setup run (API_CONTRACT §10.3: it "writes everything in one
 * database transaction through the services, so their rules and audit rows apply").
 *
 * The services are written for HTTP requests: each opens its own `this.prisma.$transaction(...)` and reads
 * with `this.prisma` around it. The CLI gives them a {@link transactionAware} client instead of the plain
 * one. Inside {@link runInTransaction}, every call it receives goes to the run's transaction, and a nested
 * `$transaction(fn)` runs `fn` on that same transaction. So each service applies its own rules and writes
 * its own audit rows unchanged, and a refusal anywhere rolls the whole run back. Outside a run the client
 * behaves exactly like the plain one (start-up, shutdown, the read-only checks).
 */
const scope = new AsyncLocalStorage<Prisma.TransactionClient>();

/** Never taken from the transaction: lifecycle hooks, the class itself and promise detection. */
const OWN_PROPERTIES: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  'constructor',
  'then',
  'onModuleInit',
  'onModuleDestroy',
  'onApplicationShutdown',
  '$connect',
  '$disconnect',
  '$on',
  '$use',
  '$extends',
]);

/** True while a {@link runInTransaction} callback (or anything it awaits) is running. */
export function inRunTransaction(): boolean {
  return scope.getStore() !== undefined;
}

/** Runs `fn` with every {@link transactionAware} client bound to `tx`. */
export function runInTransaction<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T> {
  return scope.run(tx, fn);
}

/** A nested `$transaction` joins the outer one: a callback runs on it, an array of queries runs in order. */
function joinTransaction(tx: Prisma.TransactionClient) {
  return (work: unknown): Promise<unknown> => {
    if (typeof work === 'function') return Promise.resolve((work as (client: Prisma.TransactionClient) => unknown)(tx));
    if (Array.isArray(work)) {
      return (async () => {
        const results: unknown[] = [];
        for (const query of work) results.push(await query);
        return results;
      })();
    }
    return Promise.reject(new Error('$transaction expects a function or an array of queries'));
  };
}

/**
 * Wraps a Prisma client so that, during {@link runInTransaction}, its models, raw queries and
 * `$transaction` act on the run's transaction. Methods are bound to their own object, so the client's
 * internals never see the proxy as `this`.
 */
export function transactionAware<T extends PrismaClient>(base: T): T {
  return new Proxy(base, {
    get(target, property) {
      const tx = scope.getStore();
      if (tx && !OWN_PROPERTIES.has(property)) {
        if (property === '$transaction') return joinTransaction(tx);
        const fromTx: unknown = Reflect.get(tx as object, property);
        if (fromTx !== undefined) return typeof fromTx === 'function' ? fromTx.bind(tx) : fromTx;
      }
      const own: unknown = Reflect.get(target, property, target);
      return typeof own === 'function' && property !== 'constructor' ? own.bind(target) : own;
    },
  });
}
