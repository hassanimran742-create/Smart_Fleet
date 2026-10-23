/**
 * FND-012 (installed 0.1.0 apps keep working), FND-023 (health checks) and FND-035 (201 for creates,
 * 200 for actions, never 204), on the routes the Increment 1 API lanes rebuilt.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { systemActor } from '../../src/common/auth/actor';
import { FilesService } from '../../src/modules/files/files.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, STANDARD_PHONES, x1OrderBody, type StandardData } from '../helpers/standard-data';

const SRC = path.resolve(__dirname, '..', '..', 'src');

function controllers(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllers(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

describeDb('foundation: installed apps, health and status codes', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    std = await createStandardData();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  const http = () => client(app);
  const db = () => getTestPrisma();

  it('FND-012 installed 0.1.0 apps keep working: the old order body, bare-array lists and the transfers poll', async () => {
    const shop = authHeader(std.DA.actor);
    // Step 1: the 0.1.0 body, no X-App-* headers and no Idempotency-Key.
    const placed = await http()
      .post('/api/v1/orders')
      .set(shop)
      .send({
        clientId: std.C1.id,
        deliveryLabel: "Sana's house",
        deliveryLocation: { lat: 31.53, lng: 74.23 },
        lines: [
          { cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 2 },
          { cylinderTypeId: std.sizes.kg45_4, fullCount: 1, expectedReturnCount: 1 },
        ],
      })
      .expect(201);
    expect(placed.body).toMatchObject({ fee: { totalPaisa: '48000' }, deliveryFeePaisa: '48000', paymentStatus: 'PAID_VIA_LEDGER' });
    const debits = await db().ledgerEntry.findMany({ where: { orderId: placed.body.id, entryType: 'DEBIT_ORDER' } });
    expect(debits.map((row) => row.amountPaisa)).toEqual([-48_000n]);
    // Step 2.
    expect((await http().get('/api/v1/ledger/balance').set(shop).expect(200)).body).toEqual({ balancePaisa: '452000', pendingTopupPaisa: '0' });
    for (const url of ['/api/v1/ledger/me', '/api/v1/orders', '/api/v1/payments/mine', '/api/v1/clients', '/api/v1/filling-orders/mine']) {
      const res = await http().get(url).set(shop).expect(200);
      expect({ url, array: Array.isArray(res.body) }).toEqual({ url, array: true });
    }
    const orders = await http().get('/api/v1/orders').set(shop).expect(200);
    expect((orders.body as Array<{ id: string }>).map((order) => order.id)).toContain(placed.body.id);
    // Step 3.
    const driver = authHeader(std.DR1.actor);
    for (const url of ['/api/v1/trips/mine', '/api/v1/filling-orders/driver/mine']) {
      expect(Array.isArray((await http().get(url).set(driver).expect(200)).body)).toBe(true);
    }
    const transfers = await http().get('/api/v1/transfers/mine').set(driver).expect(200);
    expect(transfers.body).toEqual([]);
    expect(transfers.headers['x-feature-disabled']).toBe('transfers');
  });

  it('FND-023 the health checks are public and reveal nothing secret', async () => {
    // Step 1.
    const health = await http().get('/api/v1/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', environment: 'test', checks: { database: { ok: true, latencyMs: expect.any(Number) } } });
    expect(health.body.version).toEqual(expect.any(String));
    expect(health.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(health.body).not.toHaveProperty('env');
    // Step 2.
    expect((await http().get('/api/v1/health/live').expect(200)).body).toEqual({ status: 'ok' });
    // Step 3: the database is unreachable.
    const prisma = app.get(PrismaService);
    const down = () => Promise.reject(new Error("Can't reach database server at `10.0.0.5:5432` user=smartfleet password=secret"));
    jest.spyOn(prisma, '$queryRaw').mockImplementation(down as never);
    jest.spyOn(prisma, '$queryRawUnsafe').mockImplementation(down as never);
    jest.spyOn(prisma, '$executeRaw').mockImplementation(down as never);
    expect((await http().get('/api/v1/health/live').expect(200)).body).toEqual({ status: 'ok' });
    const degraded = await http().get('/api/v1/health').expect(503);
    expect(degraded.body).toMatchObject({ status: 'degraded', checks: { database: { ok: false } } });
    expect(JSON.stringify(degraded.body)).not.toMatch(/10\.0\.0\.5|password|secret|smartfleet|postgres(ql)?:\/\//i);
  });

  it('FND-035 no route answers 204: no controller declares @HttpCode(204) or sends 204 itself', () => {
    const files = controllers(SRC);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const name = path.relative(SRC, file).split(path.sep).join('/');
      expect({ name, httpCode204: /@HttpCode\(\s*(204|HttpStatus\.NO_CONTENT)\s*\)/.test(text) }).toEqual({ name, httpCode204: false });
      expect({ name, sends204: /\.(status|sendStatus)\(\s*(204|HttpStatus\.NO_CONTENT)\s*\)/.test(text) }).toEqual({ name, sends204: false });
    }
  });

  it('FND-035 a create answers 201 and its replay 200; every action sent as POST answers 200', async () => {
    const shop = authHeader(std.DA.actor);
    const office = authHeader(std.SA1.actor);
    const K1 = '33333333-cccc-4ccc-8ccc-000000000001';
    const K2 = '33333333-cccc-4ccc-8ccc-000000000002';
    const K3 = '33333333-cccc-4ccc-8ccc-000000000003';
    // Step 1.
    const order = await http().post('/api/v1/orders').set(shop).set('Idempotency-Key', K1).send(x1OrderBody(std)).expect(201);
    const orderReplay = await http().post('/api/v1/orders').set(shop).set('Idempotency-Key', K1).send(x1OrderBody(std)).expect(200);
    expect([orderReplay.headers['idempotent-replay'], orderReplay.body.id]).toEqual(['true', order.body.id]);
    const customer = { name: 'Bilal Khan', phone: '0333 7778899' };
    const created = await http().post('/api/v1/clients').set(shop).set('Idempotency-Key', K2).send(customer).expect(201);
    const createdAgain = await http().post('/api/v1/clients').set(shop).set('Idempotency-Key', K2).send(customer).expect(200);
    expect([createdAgain.headers['idempotent-replay'], createdAgain.body.client.id]).toEqual(['true', created.body.client.id]);
    // Step 2: object storage is the real S3 client with `send` stubbed.
    const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
    jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
    const jpeg = Buffer.alloc(2048, 0x41);
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(jpeg);
    const upload = () => http().post('/api/v1/files/upload').set(shop).attach('file', jpeg, { filename: 'proof.jpg', contentType: 'image/jpeg' });
    const firstUpload = await upload().expect(201);
    const secondUpload = await upload().expect(201);
    expect(secondUpload.body.fileId).toBe(firstUpload.body.fileId);
    // Step 3.
    const correction = { direction: 'ADD', amountPaisa: 10000, reasonCode: 'OTHER', note: 'Status code test, please ignore' };
    const url = `/api/v1/admin/distributors/${std.DA.id}/wallet/corrections`;
    const entry = await http().post(url).set(office).set('Idempotency-Key', K3).send(correction).expect(201);
    const entryAgain = await http().post(url).set(office).set('Idempotency-Key', K3).send(correction).expect(200);
    expect([entryAgain.headers['idempotent-replay'], entryAgain.body.entry.id]).toEqual(['true', entry.body.entry.id]);
    // Step 4.
    await db().user.update({ where: { id: std.DA.userId }, data: { passwordHash: await argon2.hash('Shop!Pass123') } });
    const login = await http().post('/api/v1/auth/login').send({ phone: STANDARD_PHONES.DA, password: 'Shop!Pass123' }).expect(200);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    await http().post('/api/v1/orders/quote').set(shop).send(x1OrderBody(std)).expect(200);
    await http().post(`/api/v1/orders/${order.body.id}/cancel`).set(shop).set('Idempotency-Key', '33333333-cccc-4ccc-8ccc-000000000004').send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    // Step 5.
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Rehearsal company account', {
      allowNotEditable: true,
    });
    const request = await http()
      .post('/api/v1/payments/topup-requests')
      .set(shop)
      .set('Idempotency-Key', '33333333-cccc-4ccc-8ccc-000000000005')
      .send({ amountPaisa: 500000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP' })
      .expect(201);
    await http()
      .post(`/api/v1/payments/${request.body.id}/approve`)
      .set(office)
      .set('Idempotency-Key', '33333333-cccc-4ccc-8ccc-000000000006')
      .send({ bankReference: 'FT-7781-4402', bankAmountPaisa: 500000, bankTime: new Date(Date.now() - 60_000).toISOString() })
      .expect(200);
    const push = await http().post('/api/v1/push-tokens').set(shop).send({ token: 'ExponentPushToken[status-test]' }).expect(200);
    expect(push.body).toEqual({ ok: true });
  });
});
