/**
 * Review (robustness and operations): graceful shutdown. main.ts calls `app.enableShutdownHooks()`, so a
 * SIGTERM (docker stop on every deploy, Railway redeploys) runs `app.close()`. Nest runs every
 * `onModuleDestroy` (PrismaService.$disconnect, the Redis clients, BullMQ) before it stops the HTTP server,
 * so a request that is in flight when the signal arrives meets a disconnected database.
 *
 * Here a `POST /orders` waits on the distributor row lock (another session holds it, as a racing request
 * would), then `app.close()` starts, then the lock is released. The in-flight order should finish (201)
 * or at least fail cleanly; the test records what happens.
 *
 * Fixed (robustness-ops-05): PrismaService disconnects and RateLimitService closes its Redis client in
 * `onApplicationShutdown`, which Nest runs after the HTTP server has closed and drained, and compose gives
 * each API service 30 seconds to stop (test/unit/rev-graceful-shutdown.spec.ts).
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { authHeader, createStandardData, describeDb, getTestPrisma, x1OrderBody, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeDb('review robustness: graceful shutdown with a request in flight', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  }, 120_000);

  it('REV robustness-ops-05 an order in flight when the shutdown starts is answered 201 and committed', async () => {
    // Another session holds the distributor row, as a racing request would.
    const locker = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holding = locker.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM distributors WHERE id = ${std.DA.id}::uuid FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 30_000 },
    );
    await isLocked;

    const server = app.getHttpServer();
    const inFlight = http(app)
      .post('/api/v1/orders')
      .set(authHeader(std.DA.actor))
      .set('Idempotency-Key', 'ffffffff-ffff-4fff-8fff-000000000001')
      .send(x1OrderBody(std))
      .then(
        (res) => ({ status: res.status, code: res.body?.code as string | undefined }),
        (error: Error) => ({ status: 0, code: error.message }),
      );
    await sleep(700);

    const closeStarted = Date.now();
    const closing = app.close().then(() => Date.now() - closeStarted);
    await sleep(1_500);
    release();
    await holding;
    await locker.$disconnect();

    const answer = await inFlight;
    const closeMs = await closing;
    const db = getTestPrisma();
    const orders = await db.order.count({ where: { distributorId: std.DA.id } });
    const balance = (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa;
    // eslint-disable-next-line no-console
    console.log(`[shutdown] in-flight POST /orders -> ${answer.status} ${answer.code ?? ''}; orders=${orders}; balance=${balance}; close took ${closeMs} ms; listening=${server.listening}`);

    const committed = orders === 1 && balance === 452_000n;
    const nothingWritten = orders === 0 && balance === 500_000n;
    expect(committed || nothingWritten).toBe(true);
    // A graceful shutdown lets the request that was already running finish.
    expect(answer.status).toBe(201);
  }, 60_000);
});
