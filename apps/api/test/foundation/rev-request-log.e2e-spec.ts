/**
 * Regression test for review finding robustness-ops-15: one log line per request, so the `Reference`
 * (request id) an app shows can always be found, for successful and refused requests alike. The line
 * names the route pattern, the status, the time, the request id and the user; never a query string, a
 * body or an id in the path.
 */
import { Logger, type INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeDb('the request log', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV robustness-ops-15 every request writes one line with its route pattern, status, request id and user', async () => {
    const lines = jest.spyOn(Logger.prototype, 'log');
    const missing = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await http(app).get(`/api/v1/orders/${missing}?phone=03001234567`).set(authHeader(std.DA.actor)).set('X-Request-Id', 'rev-log-0000001').expect(404);
    await http(app).get('/api/v1/health/live').set('X-Request-Id', 'rev-log-0000002').expect(200);
    await http(app).get('/api/v1/wallet').set('X-Request-Id', 'rev-log-0000003').expect(401);
    await sleep(100);
    const logged = lines.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('requestId=rev-log-'));
    lines.mockRestore();
    expect(logged).toEqual([
      expect.stringMatching(new RegExp(`^GET /api/v1/orders/:id 404 \\d+ms requestId=rev-log-0000001 userId=${std.DA.userId}$`)),
      expect.stringMatching(/^GET \/api\/v1\/health\/live 200 \d+ms requestId=rev-log-0000002$/),
      expect.stringMatching(/^GET \/api\/v1\/wallet 401 \d+ms requestId=rev-log-0000003$/),
    ]);
    expect(logged.join('\n')).not.toMatch(/03001234567|0f8fad5b/);
  });
});
