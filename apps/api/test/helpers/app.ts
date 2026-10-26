/**
 * The whole API for DB suites: AppModule with the same HTTP set-up as main.ts (configureApp: the
 * /api/v1 prefix, CORS, trust proxy, BigInt JSON). The global filter, pipe, guards and interceptors are
 * APP_* providers of AppModule, so they are all in place.
 *
 *   let app: INestApplication;
 *   beforeAll(async () => { app = await createTestApp(); });
 *   afterAll(() => app.close());
 *   await http(app).get('/api/v1/app/config').expect(200);   // test/helpers/http.ts
 *
 * It needs DATABASE_URL (the suite's own test database) and REDIS_URL (the rate limiter and BullMQ
 * connect at boot; with Redis down the limiter fails open). Override providers with `customize`. The
 * app is already listening on a loopback port: never call `app.listen()` again.
 */
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/bootstrap/configure-app';
import { installBigIntJson } from '../../src/common/bootstrap/bigint-json';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { assertSafeTestDatabase } from './db';

export async function createTestApp(customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication> {
  assertSafeTestDatabase();
  installBigIntJson();
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (customize ? customize(builder) : builder).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  await settleWorkers(app);
  // One loopback port for the whole suite (app.close() closes it). Against a server that isn't
  // listening, supertest opens a port per request and closes it when that request ends, so a request
  // built earlier (a list of calls awaited in turn, or concurrent calls) can find it closed.
  await app.listen(0, '127.0.0.1');
  return app;
}

/**
 * Waits until every BullMQ worker has its Redis connections, and gives each an error listener: a worker
 * closed while it is still connecting emits "Connection is closed", which would otherwise surface as an
 * unhandled error in whichever test runs next.
 */
async function settleWorkers(app: INestApplication): Promise<void> {
  let discovery: DiscoveryService;
  try {
    discovery = app.get(DiscoveryService, { strict: false });
  } catch {
    return;
  }
  for (const wrapper of discovery.getProviders()) {
    const instance: unknown = wrapper.instance;
    if (!(instance instanceof WorkerHost)) continue;
    const worker = (instance as WorkerHost).worker;
    if (!worker) continue;
    worker.on('error', () => undefined);
    await worker.waitUntilReady().catch(() => undefined);
  }
}

/**
 * Forgets the settings cache, for a test that changed `app_settings` directly in the database (a change
 * made through `PATCH /settings/:key` clears it by itself).
 */
export function forgetSettings(app: INestApplication): void {
  app.get(SettingsService).invalidate();
}
