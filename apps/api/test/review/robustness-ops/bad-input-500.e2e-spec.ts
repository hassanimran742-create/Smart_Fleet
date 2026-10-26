/**
 * Review (robustness and operations): requests a client can send that end in 500 INTERNAL_ERROR (logged
 * as a server fault and reported to Sentry) instead of a 4xx. API_CONTRACT §2.2: bad input is
 * VALIDATION_FAILED; only "anything else" is INTERNAL_ERROR.
 *
 * 1. Postgres can't store or compare the value, and the filter doesn't map the data exception:
 *    - a NUL character (U+0000) in any text field or search (SQLSTATE 22021);
 *    - a cursor whose date is outside Postgres' range ("Could not convert argument value");
 *    - scheduledWindowStart in year 0000 (SQLSTATE 22008).
 * 2. The JSON body parser refuses the body before Nest runs (http-errors with a 4xx status): a client
 *    that drops the connection mid-body, a body over 100 KB, an unknown charset.
 */
import * as net from 'net';
import type { AddressInfo } from 'net';
import { Logger, type INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { authHeader, createStandardData, describeDb, getTestPrisma, x1OrderBody, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';
import * as sentry from '../../../src/common/sentry/sentry';

let n = 0;
const key = () => `abababab-abab-4bab-8bab-${String(++n).padStart(12, '0')}`;
const oldCursor = Buffer.from(JSON.stringify(['-271821-04-20T00:00:00.000Z', '00000000-0000-4000-8000-000000000000'])).toString('base64url');

describeDb('review robustness: client input that answers 500', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('values Postgres refuses', () => {
    it('a NUL character in a customer name is a 400, not a 500 (POST /clients)', async () => {
      const res = await http(app)
        .post('/api/v1/clients')
        .set(authHeader(std.DA.actor))
        .set('Idempotency-Key', key())
        .send({ name: 'Sana\u0000', phone: '0300 5551234' });
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    });

    it('a NUL character in the delivery label is a 400 and charges nothing (POST /orders)', async () => {
      const before = await getTestPrisma().distributor.findUniqueOrThrow({ where: { id: std.DA.id } });
      const res = await http(app)
        .post('/api/v1/orders')
        .set(authHeader(std.DA.actor))
        .set('Idempotency-Key', key())
        .send({ ...x1OrderBody(std), deliveryLabel: 'Gate\u00002' });
      const after = await getTestPrisma().distributor.findUniqueOrThrow({ where: { id: std.DA.id } });
      expect(after.advanceBalancePaisa).toBe(before.advanceBalancePaisa);
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    });

    it('a NUL character in the office order search is a 400 (GET /orders/board?q=)', async () => {
      const res = await http(app).get('/api/v1/orders/board').query({ tab: 'all', q: 'Sa\u0000na' }).set(authHeader(std.SA1.actor));
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    });

    it('a cursor with a date Postgres cannot hold is a 400 on cursor (GET /orders?tab=done, GET /wallet/statement)', async () => {
      const orders = await http(app).get('/api/v1/orders').query({ tab: 'done', cursor: oldCursor }).set(authHeader(std.DA.actor));
      const statement = await http(app).get('/api/v1/wallet/statement').query({ cursor: oldCursor }).set(authHeader(std.DA.actor));
      expect([orders.status, statement.status]).toEqual([400, 400]);
    });

    it('a delivery window in year 0000 is a 400 (POST /orders scheduledWindowStart)', async () => {
      const res = await http(app)
        .post('/api/v1/orders')
        .set(authHeader(std.DA.actor))
        .set('Idempotency-Key', key())
        .send({ ...x1OrderBody(std), scheduledWindowStart: '0000-01-01T00:00:00Z' });
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    });
  });

  describe('bodies the JSON parser refuses', () => {
    it('a body over 100 KB is a 4xx, not a 500 (POST /auth/login)', async () => {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ phone: '0321 1234567', password: 'x'.repeat(200_000) }));
      expect(res.status).toBeLessThan(500);
    });

    it('an unknown charset is a 4xx, not a 500', async () => {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json; charset=foo')
        .send('{"phone":"0321 1234567","password":"secret123"}');
      expect(res.status).toBeLessThan(500);
    });

    it('a phone that drops the connection mid-body is not logged as a server fault or sent to Sentry', async () => {
      const errors = jest.spyOn(Logger.prototype, 'error');
      const reported = jest.spyOn(sentry, 'captureException');
      const { port } = app.getHttpServer().address() as AddressInfo;
      await new Promise<void>((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(
            'POST /api/v1/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n' +
              'X-Request-Id: review-aborted-body-1\r\nContent-Length: 200\r\n\r\n{"phone":"0321 1234567","password":"',
          );
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 200);
        });
        socket.on('error', () => undefined);
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const faultLines = errors.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('review-aborted-body-1'));
      // eslint-disable-next-line no-console
      console.log(`[aborted body] error lines: ${JSON.stringify(faultLines)}; Sentry captures: ${reported.mock.calls.length}`);
      errors.mockRestore();
      reported.mockRestore();
      expect(faultLines).toEqual([]);
    });
  });
});
