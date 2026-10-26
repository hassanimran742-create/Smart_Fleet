/**
 * FND-005 and FND-006: one error envelope with a stable code, plain English and the request id, and no
 * internal text ever (API_CONTRACT §2.1, §2.2).
 */
import { Logger, type INestApplication } from '@nestjs/common';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { describeDb } from '../helpers/describe-db';
import { http as client, type TestResponse } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

const RAW = 'connect ECONNREFUSED 10.0.0.5:5432 user=smartfleet password=secret';
const INTERNAL = /ECONNREFUSED|10\.0\.0\.5|password|secret|Prisma|\bat .+\(.+:\d+:\d+\)|\.ts:\d+|class-validator|ZodError/;

function expectEnvelope(res: TestResponse, status: number, code: string, path: string): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ statusCode: status, code, error: code, path });
  expect(typeof res.body.message).toBe('string');
  expect(res.body.requestId).toBe(res.headers['x-request-id']);
  expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  expect(JSON.stringify(res.body)).not.toMatch(INTERNAL);
}

describeDb('foundation: the error envelope', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  const http = () => client(app);

  it('FND-005 an unknown route answers 404 NOT_FOUND in the same envelope, not the framework default', async () => {
    const res = await http().get('/api/v1/no-such-route').set(authHeader(std.DA.actor));
    expectEnvelope(res, 404, 'NOT_FOUND', '/api/v1/no-such-route');
    expect(res.body.message).toBe("We couldn't find this. It may have been removed.");
    expect(res.body).not.toHaveProperty('stack');
    // A client's own X-Request-Id is kept and echoed.
    const mine = await http().get('/api/v1/no-such-route').set('X-Request-Id', 'req-fnd-005-abcdef');
    expect(mine.headers['x-request-id']).toBe('req-fnd-005-abcdef');
    expect(mine.body.requestId).toBe('req-fnd-005-abcdef');
  });

  it('FND-005 a bad body and an unknown order use the envelope with a plain message', async () => {
    const invalid = await http()
      .post('/api/v1/clients')
      .set(authHeader(std.DA.actor))
      .set('Idempotency-Key', '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c')
      .send({ name: '', phone: '0300 7654321' });
    expectEnvelope(invalid, 400, 'VALIDATION_FAILED', '/api/v1/clients');
    expect(invalid.body.message).toBe('Some details need fixing.');
    expect(invalid.body.details.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'name', code: expect.any(String), message: expect.any(String) })]),
    );
    const missing = await http().get('/api/v1/orders/5c1d0e9f-8a7b-4c6d-9e5f-4a3b2c1d0e9f').set(authHeader(std.DA.actor));
    expectEnvelope(missing, 404, 'NOT_FOUND', '/api/v1/orders/5c1d0e9f-8a7b-4c6d-9e5f-4a3b2c1d0e9f');
    expect(missing.body.message).toBe("We couldn't find this. It may have been removed.");
  });

  it('FND-006 an unexpected server error returns 500 INTERNAL_ERROR without any internal text, logged with its request id', async () => {
    jest.spyOn(app.get(SettingsService), 'list').mockRejectedValue(new Error(RAW));
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const res = await http().get('/api/v1/settings').set(authHeader(std.SA1.actor));
    expectEnvelope(res, 500, 'INTERNAL_ERROR', '/api/v1/settings');
    expect(res.body.message).toBe('Something went wrong on our side. Please try again.');
    const line = logged.find((entry) => entry.includes(res.body.requestId));
    expect(line).toBeDefined();
    expect(line).toContain(RAW);
  });

  it('FND-006 GET /wallet failing inside the wallet read answers 500 INTERNAL_ERROR with no internal text', async () => {
    jest.spyOn(app.get(WalletService), 'summary').mockRejectedValue(new Error(RAW));
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const res = await http().get('/api/v1/wallet').set(authHeader(std.DA.actor));
    expectEnvelope(res, 500, 'INTERNAL_ERROR', '/api/v1/wallet');
    expect(logged.some((entry) => entry.includes(res.body.requestId) && entry.includes(RAW))).toBe(true);
  });
});
