/**
 * Regression test for review finding robustness-ops-14 (API_CONTRACT §3.6: with Redis down, requests go
 * through and a warning is logged at most once a minute). Without an error listener, BullMQ printed every
 * reconnect failure of the dispatch queue and worker with `console.error`, as a multi-line stack dump with
 * no timestamp, context or request id (about 109 lines a minute). The API is booted here as main.ts does,
 * without the test helper's silent worker listener, against a Redis port nothing listens on.
 */
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/bootstrap/configure-app';
import { installBigIntJson } from '../../src/common/bootstrap/bigint-json';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeDb('Redis down: queue errors go through the logger', () => {
  let app: INestApplication;
  const savedUrl = process.env.REDIS_URL;

  afterAll(async () => {
    process.env.REDIS_URL = savedUrl;
    jest.restoreAllMocks();
    await Promise.race([app?.close(), sleep(5_000)]);
  });

  it('REV robustness-ops-14 BullMQ errors are one warning per queue and worker per minute, never console.error dumps', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const warnings = jest.spyOn(Logger.prototype, 'warn');
    installBigIntJson();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');

    // From here on (the queues and workers exist and are watched), every reconnect failure is counted.
    const dumps = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await sleep(4_000); // BullMQ retries about once a second

    const queueWarnings = warnings.mock.calls.map((call) => String(call[0])).filter((line) => /^(queue|worker) dispatch: /.test(line));
    const refusedDumps = dumps.mock.calls.filter((call) => /ECONNREFUSED/.test(String((call[0] as Error)?.stack ?? call[0])));
    expect(refusedDumps).toHaveLength(0);
    // At least the worker or the queue reported it, each source at most once in the minute.
    expect(queueWarnings.length).toBeGreaterThan(0);
    const sources = queueWarnings.map((line) => line.split(':')[0]);
    expect(new Set(sources).size).toBe(sources.length);
    // And the API still answers.
    expect((await http(app).get('/api/v1/health/live')).status).toBe(200);
  }, 120_000);
});
