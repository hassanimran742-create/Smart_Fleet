/**
 * Security review (Increment 1): a sweep of ownership (IDOR) and mass-assignment probes over HTTP.
 * These pass on today's code; they back the review's "no hole found" lines for the routes they touch.
 *
 * - DA calls every distributor route with Bilal Gas's (DB's) ids in the path, query and body: 404, and
 *   nothing of DB's changes.
 * - DR2 calls every driver route with DR1's trip, stop, order and refill: 404, nothing moves.
 * - Extra body fields that would change the owner, the price, the status or the role are dropped.
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../../src/common/auth/actor';
import { FilesService } from '../../../src/modules/files/files.service';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { NEW_SHOP_APP } from '../../helpers/app-headers';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http, type TestRequest, type TestResponse } from '../../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, x1OrderBody, type StandardData } from '../../helpers/standard-data';
import { APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from '../../security/security-helpers';

jest.setTimeout(TEST_TIMEOUT_MS);

const KEY = (n: number) => `9e5e1111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(2048, 0x41)]);

type Call = [method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: Record<string, unknown>];

describeDb('review security: IDOR and mass-assignment sweep', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  function send(as: Record<string, string>, [method, url, body]: Call): TestRequest {
    const req = http(app)[method](`/api/v1${url}`).set(as);
    return body ? req.send(body) : req;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
    jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Review sweep account', {
      allowNotEditable: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  /** DB's own records: a funded order for Hina (C3), a top-up being checked with a proof, a refill, a cylinder. */
  async function bilalRecords() {
    const office = authHeader(std.SA1.actor);
    const bilal = authHeader(std.DB.actor);
    await send(office, ['post', `/admin/distributors/${std.DB.id}/wallet/corrections`, { direction: 'ADD', amountPaisa: 100000, reasonCode: 'OTHER', note: 'Review sweep money' }])
      .set('Idempotency-Key', KEY(1))
      .expect(201);
    const order = await send(bilal, [
      'post',
      '/orders',
      { clientId: std.C3.id, addressId: std.C3.addressId, deliveryLabel: "Hina's house", lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] },
    ])
      .set('Idempotency-Key', KEY(2))
      .expect(201);
    const file = await http(app).post('/api/v1/files/upload').set(bilal).attach('file', JPEG, { filename: 'slip.jpg', contentType: 'image/jpeg' }).expect(201);
    const topup = await send(bilal, ['post', '/payments/topup-requests', { amountPaisa: 50000, payerName: 'Bilal Gas', payerChannel: 'BANK_APP', proofFileId: file.body.fileId }])
      .set('Idempotency-Key', KEY(3))
      .expect(201);
    const station = await send(office, ['post', '/filling-stations', { name: 'Sweep Station', address: 'GT Road', lat: 31.53, lng: 74.26 }]).expect(201);
    const refill = await send(bilal, ['post', '/filling-orders', { fillingStationId: station.body.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 }]).set(NEW_SHOP_APP).expect(201);
    const cylinder = await db().cylinder.create({
      data: { serial: 'BG-C0001', qrCode: 'BG-C0001-QR', distributorId: std.DB.id, cylinderTypeId: std.sizes.kg11_8, state: 'FULL', custodyType: 'STORE', custodyId: std.DB.homeStoreId },
    });
    return { order: order.body.id as string, file: file.body.fileId as string, fileKey: file.body.key as string, topup: topup.body.id as string, station: station.body.id as string, refill: refill.body.id as string, cylinder };
  }

  it('REV-SEC-SWEEP DA gets 404 on every route that names one of DB\'s records, and nothing of DB\'s changes', async () => {
    const b = await bilalRecords();
    const shop = authHeader(std.DA.actor);
    const before = {
      order: await db().order.findUniqueOrThrow({ where: { id: b.order } }),
      topup: await db().payment.findUniqueOrThrow({ where: { id: b.topup } }),
      refill: await db().fillingOrder.findUniqueOrThrow({ where: { id: b.refill } }),
      addresses: await db().clientAddress.count({ where: { clientId: std.C3.id } }),
    };
    const calls: Array<[Call, number, string]> = [
      [['get', `/orders/${b.order}`], 404, 'NOT_FOUND'],
      [['get', `/orders/${b.order}/tracking`], 404, 'NOT_FOUND'],
      [['post', `/orders/${b.order}/cancel`, { reasonCode: 'WRONG_ORDER' }], 404, 'NOT_FOUND'],
      [['get', `/clients/${std.C3.id}/addresses`], 404, 'CLIENT_NOT_FOUND'],
      [['post', `/clients/${std.C3.id}/addresses`, { label: 'Fake', lat: 31.52, lng: 74.28 }], 404, 'CLIENT_NOT_FOUND'],
      [['post', '/orders', { clientId: std.C3.id, addressId: std.C3.addressId, deliveryLabel: 'x', lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 0 }] }], 404, 'CLIENT_NOT_FOUND'],
      [['post', '/orders/quote', { clientId: std.C3.id, addressId: std.C3.addressId, deliveryLabel: 'x', lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 0 }] }], 404, 'CLIENT_NOT_FOUND'],
      [['post', '/orders', { clientId: std.C1.id, addressId: std.C3.addressId, deliveryLabel: 'x', lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 0 }] }], 404, 'CLIENT_ADDRESS_NOT_FOUND'],
      [['get', `/payments/${b.topup}`], 404, 'NOT_FOUND'],
      [['post', `/payments/${b.topup}/bank-proof`, { proofUrl: `https://x/${b.fileKey}` }], 404, 'NOT_FOUND'],
      [['post', '/payments/topup-requests', { amountPaisa: 50000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP', proofFileId: b.file }], 404, 'FILE_NOT_FOUND'],
      [['get', `/files/${b.file}/url`], 404, 'FILE_NOT_FOUND'],
      [['get', `/filling-orders/${b.refill}`], 404, 'NOT_FOUND'],
      [['patch', `/filling-orders/${b.refill}/cancel`, { reason: 'Not mine' }], 404, 'NOT_FOUND'],
      [['get', `/cylinders/by-qr/${b.cylinder.qrCode}`], 404, 'NOT_FOUND'],
      [['get', `/custody/cylinders/${b.cylinder.id}/history`], 404, 'NOT_FOUND'],
    ];
    let n = 0;
    for (const [call, status, code] of calls) {
      n += 1;
      const res: TestResponse = await send(shop, call).set('Idempotency-Key', KEY(100 + n));
      expect({ call: `${call[0].toUpperCase()} ${call[1]}`, status: res.status, code: res.body.code }).toEqual({
        call: `${call[0].toUpperCase()} ${call[1]}`,
        status,
        code,
      });
    }
    // Query ids are ignored for a distributor.
    const quote = await send(shop, ['get', `/pricing/quote?lat=31.51&lng=74.28&distributorId=${std.DB.id}`]).expect(200);
    expect(quote.body).toMatchObject({ zone: { name: 'South' }, price: { basePaisa: '40000' } }); // DA's South price, not DB's Rs 300
    const clients = await send(shop, ['get', `/clients?distributorId=${std.DB.id}`]).expect(200);
    expect((clients.body as Array<{ name: string }>).map((c) => c.name).sort()).toEqual(['Sana', 'Usman']);
    // Nothing of DB's changed.
    expect(await db().order.findUniqueOrThrow({ where: { id: b.order } })).toEqual(before.order);
    expect(await db().payment.findUniqueOrThrow({ where: { id: b.topup } })).toEqual(before.topup);
    expect(await db().fillingOrder.findUniqueOrThrow({ where: { id: b.refill } })).toEqual(before.refill);
    expect(await db().clientAddress.count({ where: { clientId: std.C3.id } })).toBe(before.addresses);
  });

  it('REV-SEC-SWEEP DR2 gets 404 on every driver route that names DR1\'s trip, stop, order or refill', async () => {
    const office = authHeader(std.SA1.actor);
    const shop = authHeader(std.DA.actor);
    const x1 = await send(shop, ['post', '/orders', x1OrderBody(std)]).set('Idempotency-Key', KEY(10)).expect(201);
    await send(office, ['post', `/orders/${x1.body.id}/assign-driver`, { driverId: std.DR1.id }]).expect(200);
    const trip = await db().trip.findFirstOrThrow({ where: { driverId: std.DR1.id }, include: { stops: true } });
    const station = await send(office, ['post', '/filling-stations', { name: 'Sweep Station 2', address: 'GT Road', lat: 31.53, lng: 74.26 }]).expect(201);
    const refill = await send(shop, ['post', '/filling-orders', { fillingStationId: station.body.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 }]).set(NEW_SHOP_APP).expect(201);
    await send(office, ['patch', `/filling-orders/${refill.body.id}/assign`, { driverId: std.DR1.id }]).expect(200);
    const cylinder = await db().cylinder.findFirstOrThrow({ where: { distributorId: std.DA.id } });

    const imran = authHeader(std.DR2.actor);
    const calls: Array<[Call, number, string]> = [
      [['get', `/trips/${trip.id}`], 404, 'NOT_FOUND'],
      [['patch', `/trips/${trip.id}/status`, { status: 'IN_PROGRESS' }], 404, 'NOT_FOUND'],
      [['patch', `/trips/stops/${trip.stops[0].id}/arrive`], 404, 'NOT_FOUND'],
      [['patch', `/trips/stops/${trip.stops[0].id}/depart`], 404, 'NOT_FOUND'],
      [['post', '/custody/scan', { qrCode: cylinder.qrCode, eventType: 'SCAN_OUT', tripId: trip.id }], 404, 'NOT_FOUND'],
      [['get', `/orders/${x1.body.id}`], 404, 'NOT_FOUND'],
      [['patch', `/orders/${x1.body.id}/status`, { status: 'DELIVERED' }], 404, 'NOT_FOUND'],
      [['post', `/orders/${x1.body.id}/fail`, { reasonCode: 'CUSTOMER_NOT_HOME' }], 404, 'NOT_FOUND'],
      [['get', `/filling-orders/${refill.body.id}`], 404, 'NOT_FOUND'],
      [['patch', `/filling-orders/${refill.body.id}/picked-empties`, { emptyCount: 2 }], 404, 'NOT_FOUND'],
      [['get', `/drivers/${std.DR1.id}`], 404, 'NOT_FOUND'],
      [['patch', `/drivers/${std.DR1.id}/profile`, { name: 'Hijacked' }], 404, 'NOT_FOUND'],
    ];
    for (const [call, status, code] of calls) {
      const res = await send(imran, call);
      expect({ call: `${call[0].toUpperCase()} ${call[1]}`, status: res.status, code: res.body.code }).toEqual({
        call: `${call[0].toUpperCase()} ${call[1]}`,
        status,
        code,
      });
    }
    expect(await db().cylinderEvent.count()).toBe(0);
    expect((await db().order.findUniqueOrThrow({ where: { id: x1.body.id } })).status).toBe('ASSIGNED');
    expect((await db().trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe('PLANNED');
    expect((await db().user.findUniqueOrThrow({ where: { id: std.DR1.userId } })).name).toBe('Kashif');
  });

  it('REV-SEC-SWEEP extra body fields can\'t change the owner, the cost, the status or the role', async () => {
    const shop = authHeader(std.DA.actor);
    // An order "for DB", "already paid", "delivered", from DB's store.
    const order = await send(shop, [
      'post',
      '/orders',
      { ...x1OrderBody(std), distributorId: std.DB.id, deliveryFeePaisa: 0, feeStatus: 'NONE', status: 'DELIVERED', originStoreId: std.DB.homeStoreId, tripId: std.DB.id },
    ])
      .set('Idempotency-Key', KEY(20))
      .expect(201);
    const row = await db().order.findUniqueOrThrow({ where: { id: order.body.id } });
    expect(row).toMatchObject({ distributorId: std.DA.id, deliveryFeePaisa: 25000n, feeStatus: 'DEDUCTED', status: 'PENDING', originStoreId: std.DA.homeStoreId, tripId: null });
    // A customer "of DB".
    const client = await send(shop, ['post', '/clients', { name: 'Zara', phone: '0333 5556667', distributorId: std.DB.id, userId: std.DB.userId }])
      .set('Idempotency-Key', KEY(21))
      .expect(201);
    expect(await db().client.findUniqueOrThrow({ where: { id: client.body.client.id } })).toMatchObject({ distributorId: std.DA.id, userId: null });
    // A top-up "already approved" for DB.
    const topup = await send(shop, [
      'post',
      '/payments/topup-requests',
      { amountPaisa: 50000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP', distributorId: std.DB.id, status: 'SUCCESS', bankReference: 'FT-1', bankAmountPaisa: 5000000 },
    ])
      .set('Idempotency-Key', KEY(22))
      .expect(201);
    expect(await db().payment.findUniqueOrThrow({ where: { id: topup.body.id } })).toMatchObject({ distributorId: std.DA.id, status: 'PENDING', bankReference: null, bankAmountPaisa: null });
    // A refill priced and picked up at DB's store.
    const station = await send(authHeader(std.SA1.actor), ['post', '/filling-stations', { name: 'Sweep Station 3', address: 'GT Road', lat: 31.53, lng: 74.26 }]).expect(201);
    const refill = await send(shop, [
      'post',
      '/filling-orders',
      { fillingStationId: station.body.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, pickupStoreId: std.DB.homeStoreId, distributorId: std.DB.id, pricePerCylinderPaisa: 99900, status: 'COMPLETED' },
    ])
      .set(NEW_SHOP_APP)
      .expect(201);
    expect(await db().fillingOrder.findUniqueOrThrow({ where: { id: refill.body.id } })).toMatchObject({
      distributorId: std.DA.id,
      pickupStoreId: std.DA.homeStoreId,
      pricePerCylinderPaisa: 0n,
      status: 'PENDING',
    });
    // A profile edit that tries to become the office.
    await send(shop, ['patch', '/users/me', { name: 'Ahmed Gas', role: 'SUPER_ADMIN', status: 'ACTIVE', tokenVersion: 0, passwordHash: 'x', email: null }]).expect(200);
    expect(await db().user.findUniqueOrThrow({ where: { id: std.DA.userId } })).toMatchObject({ role: 'DISTRIBUTOR', passwordHash: null, tokenVersion: 0 });
    // A driver's own profile edit can't touch office fields.
    const self = await send(authHeader(std.DR1.actor), ['patch', `/drivers/${std.DR1.id}/profile`, { name: 'Kashif', licenceNo: 'FAKE-1' }]);
    expect({ status: self.status, code: self.body.code }).toEqual({ status: 403, code: 'USER_FIELD_OFFICE_ONLY' });
  });
});
