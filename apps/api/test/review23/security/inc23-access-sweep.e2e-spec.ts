/**
 * Review 23 (security): the Inc 2/3 route table, probed over HTTP. These pass on today's code; they back
 * the review's "no hole" lines for the routes they touch (the holes found are in the other review23 files).
 *
 * - Ahmed Gas (DA) names Bilal Gas's (DB's) order, customer, cylinder, refill, day-end sheet and case: 404
 *   (or the scan's own SCAN_WRONG_OWNER), and nothing of DB's changes.
 * - Imran (DR2) names Kashif's (DR1's) trip, stops and refill: 404, nothing moves; a driver never reads
 *   the customer link of an order, even on his own trip.
 * - Each role gets 403 on the other roles' routes (office, store, driver, day-end), before any record is read.
 */
import type { INestApplication } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { createConfirmation } from '../../helpers/customer-links';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { binaryParser, http, type TestResponse } from '../../helpers/http';
import { createRefill } from '../../helpers/refills';
import { createOrder } from '../../helpers/runs';
import { FilesService } from '../../../src/modules/files/files.service';
import { buildWorld, X1, type World } from '../../inc2/scan/support/world';
import { businessDate } from '@smartfleet/shared-utils';

jest.setTimeout(180_000);

type Method = 'get' | 'post' | 'patch' | 'put';
type Call = [method: Method, url: string, body?: unknown];

describeDb('review23 security: Inc 2/3 access sweep', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
    const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
    jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
    await w.setting('confirmation.enabled', true);
  });

  async function call(who: { actor: Parameters<typeof authHeader>[0] }, [method, url, body]: Call): Promise<TestResponse> {
    const req = http(app)[method](`/api/v1${url}`).set(authHeader(who.actor));
    return body === undefined ? req : req.send(body as object);
  }

  async function expectAll(who: { actor: Parameters<typeof authHeader>[0] }, calls: Array<[Call, number, string]>): Promise<void> {
    for (const [c, status, code] of calls) {
      const res = await call(who, c);
      expect({ call: `${c[0].toUpperCase()} ${c[1]}`, status: res.status, code: res.body?.code }).toEqual({ call: `${c[0].toUpperCase()} ${c[1]}`, status, code });
    }
  }

  it('REV23-SEC-SWEEP Ahmed Gas gets 404 (or SCAN_WRONG_OWNER) on every Inc 2/3 route that names Bilal Gas\'s records', async () => {
    const bg1 = await w.bg(1);
    const dbOrder = await createOrder({ distributor: w.std.DB, client: w.std.C3, lines: [{ cylinderTypeId: w.std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED });
    await createConfirmation({ order: dbOrder });
    const dbRefill = await createRefill({ distributor: w.std.DB, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 1 });
    const today = businessDate(new Date(), { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' });
    const sheet = await http(app).get(`/api/v1/day-end/${today}/sheet.xlsx`).set(authHeader(w.std.DB.actor)).buffer(true).parse(binaryParser);
    expect(sheet.status).toBe(200);
    const dbDay = await w.db.dayClose.findFirstOrThrow({ where: { distributorId: w.std.DB.id } });
    const dbCase = await w.db.alert.create({
      data: {
        alertType: 'CUSTOMER_PROBLEM',
        severity: 'WARNING',
        title: 'Customer problem',
        body: 'x',
        resourceType: 'Order',
        resourceId: dbOrder.id,
        distributorId: w.std.DB.id,
        context: { orderId: dbOrder.id, orderShortCode: dbOrder.shortCode, distributorId: w.std.DB.id, answer: 'NO', comment: 'Bilal secret' },
      },
    });
    const before = {
      events: await w.db.cylinderEvent.count(),
      bg1: await w.db.cylinder.findUniqueOrThrow({ where: { id: bg1.id } }),
      refill: await w.db.fillingOrder.findUniqueOrThrow({ where: { id: dbRefill.id } }),
      client: await w.db.client.findUniqueOrThrow({ where: { id: w.std.C3.id } }),
      messages: await w.db.outboundMessage.count(),
    };

    await expectAll(w.std.DA, [
      [['get', `/orders/${dbOrder.id}/confirmation`], 404, 'NOT_FOUND'],
      [['post', `/orders/${dbOrder.id}/confirmation/share`, { via: 'COPY' }], 404, 'NOT_FOUND'],
      [['post', `/orders/${dbOrder.id}/confirmation/new-link`, { send: 'SMS' }], 404, 'NOT_FOUND'],
      [['patch', `/clients/${w.std.C3.id}`, { notes: 'Taken over' }], 404, 'CLIENT_NOT_FOUND'],
      [['get', `/cylinders/${encodeURIComponent(bg1.qrCode)}/history`], 404, 'NOT_FOUND'],
      [['get', `/cylinders/${bg1.shortCode}/history`], 404, 'NOT_FOUND'],
      [['post', '/store/scans', { scanId: '7e000000-0000-4000-8000-000000000001', code: bg1.qrCode, entryMethod: 'QR' }], 409, 'SCAN_WRONG_OWNER'],
      [['post', '/store/scans', { scanId: '7e000000-0000-4000-8000-000000000002', code: bg1.shortCode, entryMethod: 'TYPED' }], 404, 'SCAN_CYLINDER_UNKNOWN'],
      [['get', `/filling-orders/${dbRefill.id}`], 404, 'NOT_FOUND'],
      [['patch', `/filling-orders/${dbRefill.id}/cancel`, { reason: 'Not mine at all' }], 404, 'NOT_FOUND'],
      [['get', `/files/${dbDay.sheetFileId}/url`], 404, 'FILE_NOT_FOUND'],
    ]);
    // Bilal's sheet uploaded by Ahmed Gas names nothing of Bilal's.
    const upload = await http(app)
      .post(`/api/v1/day-end/${today}/upload`)
      .set(authHeader(w.std.DA.actor))
      .attach('file', sheet.body as Buffer, { filename: 'bilal.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect({ status: upload.status, code: upload.body.code }).toEqual({ status: 422, code: 'DAY_SHEET_WRONG_DISTRIBUTOR' });
    expect(JSON.stringify(upload.body)).not.toContain('Bilal');
    // Ahmed Gas's own day and cases show nothing of Bilal's.
    const ownDay = await call(w.std.DA, ['get', `/day-end/${today}`]);
    expect(ownDay.body).toMatchObject({ status: 'OPEN', stage: 'NOT_STARTED', lastUpload: null });
    const mine = await call(w.std.DA, ['get', '/alerts/mine']);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toEqual([]);
    expect(JSON.stringify(mine.body)).not.toContain(dbCase.id);

    expect(await w.db.cylinderEvent.count()).toBe(before.events);
    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: bg1.id } })).toEqual(before.bg1);
    expect(await w.db.fillingOrder.findUniqueOrThrow({ where: { id: dbRefill.id } })).toEqual(before.refill);
    expect(await w.db.client.findUniqueOrThrow({ where: { id: w.std.C3.id } })).toEqual(before.client);
    expect(await w.db.outboundMessage.count()).toBe(before.messages);
  });

  it('REV23-SEC-SWEEP Imran gets 404 on Kashif\'s trip, stops and refill; no driver reads a customer link', async () => {
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, w.std.DR1);
    const stop = await t1.stopFor(x1.id);
    const refill = await createRefill({ distributor: w.std.DA, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 1, assignTo: { id: w.std.DR1.id, vehicleId: w.std.DR1.vehicleId } });
    await w.markState(7, 'EMPTY');
    const events = await w.db.cylinderEvent.count();

    await expectAll(w.std.DR2, [
      [['get', `/trips/${t1.id}`], 404, 'NOT_FOUND'],
      [['get', `/trips/${t1.id}/stops/${stop}`], 404, 'NOT_FOUND'],
      [['post', `/trips/${t1.id}/scans`, { scanId: '7e000000-0000-4000-8000-000000000011', stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode, entryMethod: 'QR' }], 404, 'NOT_FOUND'],
      [['put', `/trips/${t1.id}/stops/${stop}/unlabelled-returns`, { items: [{ cylinderTypeId: w.std.sizes.kg11_8, state: 'EMPTY', count: 2 }] }], 404, 'NOT_FOUND'],
      [['post', `/trips/${t1.id}/stops/${t1.pickupStopId}/finish`, {}], 404, 'NOT_FOUND'],
      [['post', `/trips/${t1.id}/finish`, {}], 404, 'NOT_FOUND'],
      [['post', `/filling-orders/${refill.id}/scans`, { scanId: '7e000000-0000-4000-8000-000000000012', phase: 'PICKUP', code: w.ag(7).qrCode, entryMethod: 'QR' }], 404, 'NOT_FOUND'],
      [['post', `/filling-orders/${refill.id}/advance`, { to: 'EMPTIES_PICKED' }], 404, 'NOT_FOUND'],
      [['get', `/filling-orders/${refill.id}`], 404, 'NOT_FOUND'],
    ]);
    // Even on his own trip, a driver never reads the customer's link (§9.7).
    await w.load(w.std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(w.std.DR1, t1);
    await w.hand(w.std.DR1, t1, x1, [1, 2, 31]);
    expect((await w.finishVisit(w.std.DR1, t1, x1)).status).toBe(200);
    await expectAll(w.std.DR1, [
      [['get', `/orders/${x1.id}/confirmation`], 404, 'NOT_FOUND'],
      [['post', `/orders/${x1.id}/confirmation/share`, { via: 'COPY' }], 404, 'NOT_FOUND'],
      [['post', `/orders/${x1.id}/confirmation/new-link`, {}], 404, 'NOT_FOUND'],
    ]);
    const detail = await call(w.std.DR1, ['get', `/orders/${x1.id}`]);
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty('confirmation');
    expect(JSON.stringify(detail.body)).not.toMatch(/\/c\/[0-9a-z]{26}/);
    // Imran's attempts moved nothing (the 3 loads and 3 hand-overs are Kashif's own).
    expect(await w.db.cylinderEvent.count()).toBe(events + 6);
  });

  it('REV23-SEC-SWEEP every role gets 403 on the other roles\' Inc 2/3 routes', async () => {
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, w.std.DR1);
    const refill = await createRefill({ distributor: w.std.DA, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 1 });
    const anyDay = '00000000-0000-4000-8000-000000000001';
    const denied = (calls: Call[]): Array<[Call, number, string]> => calls.map((c) => [c, 403, 'PERMISSION_DENIED']);
    // The shop on office and driver routes.
    await expectAll(w.std.DA, denied([
      ['post', `/orders/${x1.id}/manual-delivery`, { reason: 'Shop tries the office route', cylinders: [{ code: w.ag(1).qrCode }] }],
      ['post', `/alerts/${anyDay}/resolve`, { note: 'Shop tries to close' }],
      ['get', '/alerts?type=CUSTOMER_PROBLEM'],
      ['get', '/admin/day-end'],
      ['post', `/admin/day-end/${anyDay}/approve`, { version: 1 }],
      ['patch', `/filling-orders/${refill.id}/assign`, { driverId: w.std.DR1.id }],
      ['post', '/cylinders/bulk-register', { distributorId: w.std.DA.id, cylinderTypeId: w.std.sizes.kg11_8, quantity: 1 }],
      ['patch', `/drivers/${w.std.DR1.id}/vehicle`, { vehicleId: null }],
      ['post', `/trips/${t1.id}/scans`, { scanId: '7e000000-0000-4000-8000-000000000021', stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode, entryMethod: 'QR' }],
      ['get', '/driver/home'],
      ['post', `/filling-orders/${refill.id}/scans`, { scanId: '7e000000-0000-4000-8000-000000000022', phase: 'PICKUP', code: w.ag(1).qrCode, entryMethod: 'QR' }],
    ]));
    // The office on the shop's and the driver's own routes (exact roles, no bypass).
    await expectAll(w.std.SA1, denied([
      ['post', '/store/scans', { scanId: '7e000000-0000-4000-8000-000000000031', code: w.ag(1).qrCode, entryMethod: 'QR' }],
      ['get', '/store/incoming'],
      ['get', '/store/stock'],
      ['patch', `/clients/${w.std.C1.id}`, { notes: 'Office edit' }],
      ['get', '/alerts/mine'],
      ['get', '/day-end'],
      ['patch', `/filling-orders/${refill.id}/cancel`, { reason: 'Office cancel' }],
      ['post', `/trips/${t1.id}/scans`, { scanId: '7e000000-0000-4000-8000-000000000032', stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode, entryMethod: 'QR' }],
      ['post', `/trips/${t1.id}/finish`, {}],
      ['get', '/driver/home'],
    ]));
    // The driver on the shop's and the office's routes.
    await expectAll(w.std.DR1, denied([
      ['post', '/store/scans', { scanId: '7e000000-0000-4000-8000-000000000041', code: w.ag(1).qrCode, entryMethod: 'QR' }],
      ['get', '/store/stock'],
      ['get', `/cylinders/${w.ag(1).shortCode}/history`],
      ['post', `/orders/${x1.id}/manual-delivery`, { reason: 'Driver tries the office route', cylinders: [{ code: w.ag(1).qrCode }] }],
      ['get', '/admin/day-end'],
      ['get', '/day-end'],
      ['get', '/alerts/mine'],
    ]));
    expect(await w.db.cylinderEvent.count({ where: { eventType: { not: 'REGISTERED' } } })).toBe(0);
  });
});
