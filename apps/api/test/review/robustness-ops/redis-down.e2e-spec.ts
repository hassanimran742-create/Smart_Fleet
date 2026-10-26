/**
 * Review (robustness and operations): Redis is down (API_CONTRACT §2.2 "Redis being down never fails a
 * request", §3.6). The API is booted against a Redis port nothing listens on.
 *
 * With `dispatch.autoAssign.enabled` on (an editable setting), `POST /orders` awaits
 * `dispatchQueue.add()` after the order transaction has committed. BullMQ keeps that call waiting for
 * Redis to come back, so the request never answers although the order exists and its cost was deducted.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/common/bootstrap/configure-app';
import { installBigIntJson } from '../../../src/common/bootstrap/bigint-json';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { authHeader, createStandardData, describeDb, getTestPrisma, x1OrderBody, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';

describeDb('review robustness: Redis down', () => {
  let app: INestApplication;
  let std: StandardData;
  const savedUrl = process.env.REDIS_URL;

  beforeAll(async () => {
    // Nothing listens on port 1: every Redis client (rate limits, BullMQ queue and worker) fails to connect.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    installBigIntJson();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    std = await createStandardData();
  }, 120_000);

  afterAll(async () => {
    process.env.REDIS_URL = savedUrl;
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  });

  it('sign-in still answers (the rate limiter fails open)', async () => {
    const res = await http(app).post('/api/v1/auth/login').send({ phone: '0300 1112223', password: 'whatever1' });
    expect(res.status).toBe(401);
  });

  it('with auto-assign on, POST /orders answers within 10 seconds (it is committed and charged either way)', async () => {
    await app.get(SettingsService).set('dispatch.autoAssign.enabled', true, systemActor('cli:settings'), 'review: Redis down', { allowNotEditable: true });
    const before = await getTestPrisma().distributor.findUniqueOrThrow({ where: { id: std.DA.id } });

    const started = Date.now();
    const answer = await Promise.race([
      http(app)
        .post('/api/v1/orders')
        .set(authHeader(std.DA.actor))
        .set('Idempotency-Key', 'eeeeeeee-eeee-4eee-8eee-000000000001')
        .send(x1OrderBody(std))
        .then((res) => `HTTP ${res.status}`),
      new Promise<string>((resolve) => setTimeout(() => resolve('no answer after 10 s'), 10_000)),
    ]);
    const after = await getTestPrisma().distributor.findUniqueOrThrow({ where: { id: std.DA.id } });
    const orders = await getTestPrisma().order.count({ where: { distributorId: std.DA.id } });
    // eslint-disable-next-line no-console
    console.log(`[redis-down] POST /orders: ${answer} after ${Date.now() - started} ms; orders=${orders}; balance ${before.advanceBalancePaisa} -> ${after.advanceBalancePaisa}`);

    expect(answer).toBe('HTTP 201');
  }, 30_000);
});
