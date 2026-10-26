/**
 * The legacy driver scan route, locked down for Inc 1 (API_CONTRACT §7.7), and the driver's own order
 * actions (§7.6): exact roles, server-chosen holders, the trip's van, and no money at the door.
 */
import type { INestApplication } from '@nestjs/common';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createCylinder } from '../helpers/factories';
import { createStandardData } from '../helpers/standard-data';
import { OrdersFixture, qrOf, type OrderBody } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

jest.setTimeout(300_000);

describeDb('api-orders: the legacy driver scan route', () => {
  let app: INestApplication;
  let f: OrdersFixture;
  let x1: OrderBody;
  let T1: string;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
    x1 = await f.x1();
    T1 = (await f.assign(x1.id, f.std.DR1)).tripId;
  });

  afterAll(async () => {
    await app?.close();
  });

  const scan = (who: { actor: Parameters<OrdersFixture['as']>[0]['actor'] }, body: Record<string, unknown>) => f.as(who).post('/custody/scan').send(body);
  const events = (code: string) => f.cylinder(code).then((cylinder) => f.db.cylinderEvent.findMany({ where: { cylinderId: cylinder.id } }));

  it('DRV-001 the legacy scan route accepts only drivers (no super-admin bypass)', async () => {
    const { std } = f;
    const body = { qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT', tripId: T1 };
    // Steps 1 and 2.
    for (const who of [std.DA, std.SA1]) {
      const res = await scan(who, body).expect(403);
      expect(res.body).toMatchObject({ code: 'PERMISSION_DENIED', message: "Your account can't do this." });
    }
    // Step 3.
    const cylinder = await f.cylinder('AG-C0001');
    const history = await f.as(std.SA1).get(`/custody/cylinders/${cylinder.id}/history`).expect(200);
    expect((history.body as Array<{ eventType: string }>).filter((event) => event.eventType === 'SCAN_OUT')).toEqual([]);
    expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['STORE', std.DA.homeStoreId]);
    // Step 4.
    await scan(std.DR1, body).expect(201);
    const loaded = await f.cylinder('AG-C0001');
    expect([loaded.custodyType, loaded.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
    const scans = (await events('AG-C0001')).filter((event) => event.eventType === 'SCAN_OUT');
    expect(scans).toHaveLength(1);
    expect(scans[0].actorUserId).toBe(std.DR1.userId);
    // The history: the office and the owner read it; a driver or another shop cannot.
    await f.as(std.DA).get(`/custody/cylinders/${cylinder.id}/history`).expect(200);
    expect((await f.as(std.DR1).get(`/custody/cylinders/${cylinder.id}/history`).expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect((await f.as(std.DB).get(`/custody/cylinders/${cylinder.id}/history`).expect(404)).body.code).toBe('NOT_FOUND');
  });

  it('DRV-002 the legacy scan route refuses client-chosen holders and the old EMPTY-to-FULL event', async () => {
    const { std, db } = f;
    await db.cylinder.update({ where: { serial: 'AG-C0020' }, data: { state: 'EMPTY' } });
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT', tripId: T1, toCustodyType: 'STORE', toCustodyId: std.DB.homeStoreId }, 'toCustody'],
      [{ qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT' }, 'tripId'],
      [{ qrCode: qrOf('AG-C0001'), eventType: 'DELIVERED', tripId: T1 }, 'orderId'],
      [{ qrCode: 'AB', eventType: 'SCAN_OUT', tripId: T1 }, 'qrCode'],
    ];
    // Steps 1–4.
    for (const [body, field] of cases) {
      const res = await scan(std.DR1, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      const paths = (res.body.details.fields as Array<{ path: string }>).map((item) => item.path);
      expect({ field, matched: paths.some((path) => path.startsWith(field)) }).toEqual({ field, matched: true });
    }
    // Step 5.
    const laundering = await scan(std.DR1, { qrCode: qrOf('AG-C0020'), eventType: 'RETURNED_TO_DISTRIBUTOR', tripId: T1 }).expect(403);
    expect(laundering.body).toMatchObject({ code: 'SCAN_EVENT_NOT_ALLOWED', message: "This scan isn't allowed." });
    // Step 6.
    const c1 = await f.cylinder('AG-C0001');
    const c20 = await f.cylinder('AG-C0020');
    expect([c1.state, c1.custodyType, c1.custodyId]).toEqual(['FULL', 'STORE', std.DA.homeStoreId]);
    expect([c20.state, c20.custodyType, c20.custodyId]).toEqual(['EMPTY', 'STORE', std.DA.homeStoreId]);
    expect(await db.cylinderEvent.count()).toBe(0);
  });

  it('DRV-003 the legacy load scan puts the cylinder on the trip van and marks delivery as started', async () => {
    const { std, db } = f;
    // After the assignment DR1 moves onto LEB-202: the trip's van must be used.
    await db.driver.update({ where: { id: std.DR2.id }, data: { currentVehicleId: null } });
    await db.driver.update({ where: { id: std.DR1.id }, data: { currentVehicleId: std.DR2.vehicleId } });
    // Step 1.
    const first = await scan(std.DR1, { qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT', tripId: T1 }).expect(201);
    expect(first.body).toMatchObject({ event: expect.any(Object), cylinderId: expect.any(String), newState: 'FULL', toType: 'VEHICLE', toId: std.DR1.vehicleId });
    const cylinder = await f.cylinder('AG-C0001');
    expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
    // Step 2.
    const order = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body).toMatchObject({ stage: 'LOADING', loadStartedAt: expect.any(String), cancel: { refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' } });
    // Step 3.
    expect((await f.as(std.DR1).get(`/trips/${T1}`).expect(200)).body.status).toBe('IN_PROGRESS');
    // Step 4.
    const again = await scan(std.DR1, { qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT', tripId: T1 }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body).toMatchObject({ event: { id: first.body.event.id }, cylinderId: first.body.cylinderId, newState: 'FULL', toType: 'VEHICLE', toId: std.DR1.vehicleId, alreadyRecorded: true });
    // Step 5.
    const scans = (await events('AG-C0001')).filter((event) => event.eventType === 'SCAN_OUT');
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({ actorUserId: std.DR1.userId, tripId: T1 });
    expect(await f.balance()).toBe(475_000n);
  });

  it('DRV-004 the legacy scan guards refuse each wrong move and change nothing', async () => {
    const { std, db } = f;
    await db.cylinder.update({ where: { serial: 'AG-C0020' }, data: { state: 'EMPTY' } });
    await db.cylinder.update({ where: { serial: 'AG-C0019' }, data: { state: 'FAULTY' } });
    await db.cylinder.update({ where: { serial: 'AG-C0011' }, data: { custodyType: 'CLIENT', custodyId: std.C1.id } });
    const foreign = await createCylinder({
      distributor: { id: std.DB.id, homeStoreId: std.DB.homeStoreId },
      cylinderTypeId: std.sizes.kg11_8,
      custody: { type: 'STORE', id: std.DA.homeStoreId },
    });
    const before = await db.cylinder.findMany({ orderBy: { id: 'asc' } });
    const cases: Array<[Record<string, unknown>, string, string?]> = [
      [{ qrCode: qrOf('AG-C0011'), eventType: 'SCAN_OUT', tripId: T1 }, 'SCAN_NOT_AT_STORE', "This cylinder isn't in Ahmed Gas Store's stock. Load only from this store."],
      [{ qrCode: qrOf('AG-C0020'), eventType: 'SCAN_OUT', tripId: T1 }, 'SCAN_NOT_FULL', "This cylinder isn't full. Load only full cylinders."],
      [{ qrCode: foreign.qrCode, eventType: 'SCAN_OUT', tripId: T1 }, 'SCAN_WRONG_OWNER', 'This cylinder belongs to another shop.'],
      [{ qrCode: qrOf('AG-C0019'), eventType: 'SCAN_OUT', tripId: T1 }, 'SCAN_CYLINDER_BLOCKED'],
      [{ qrCode: qrOf('AG-C0005'), eventType: 'DELIVERED', tripId: T1, orderId: x1.id }, 'SCAN_NOT_ON_YOUR_VAN'],
      [{ qrCode: qrOf('AG-C0005'), eventType: 'PICKED_UP_EMPTY', tripId: T1, orderId: x1.id }, 'SCAN_NOT_WITH_THIS_CUSTOMER'],
    ];
    // Steps 1–6.
    for (const [body, code, message] of cases) {
      const res = await scan(std.DR1, body).expect(409);
      expect({ code: res.body.code, ...(message ? { message: res.body.message } : {}) }).toEqual({ code, ...(message ? { message } : {}) });
    }
    // Step 7.
    expect(await db.cylinder.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.cylinderEvent.count()).toBe(0);
    expect((await f.order(x1.id)).loadStartedAt).toBeNull();
    // An unknown QR value and an order not on the trip.
    expect((await scan(std.DR1, { qrCode: 'NO-SUCH-QR', eventType: 'SCAN_OUT', tripId: T1 }).expect(404)).body.code).toBe('SCAN_CYLINDER_UNKNOWN');
    const other = await f.x1();
    const elsewhere = await scan(std.DR1, { qrCode: qrOf('AG-C0005'), eventType: 'DELIVERED', tripId: T1, orderId: other.id }).expect(403);
    expect(elsewhere.body.code).toBe('ORDER_NOT_ON_YOUR_TRIP');
  });

  it('DRV-005 only the trip driver can mark an order delivered or not delivered', async () => {
    const { std } = f;
    await scan(std.DR1, { qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT', tripId: T1 }).expect(201);
    // Steps 1 and 2.
    expect((await f.as(std.DR2).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }, std.DR2).expect(404)).body.code).toBe('NOT_FOUND');
    // Step 3.
    expect((await f.as(std.SA1).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(400)).body.code).toBe('ORDER_USE_MANUAL_DELIVERY');
    // Step 4.
    expect((await f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }, std.DA).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 5.
    const order = await f.order(x1.id);
    expect(['DELIVERED', 'FAILED']).not.toContain(order.status);
    expect(await f.balance()).toBe(475_000n);
    expect(await f.audits('order.fail', x1.id)).toEqual([]);
  });

  it('DRV-007 could not deliver records a valid reason and moves no money', async () => {
    const { std } = f;
    await scan(std.DR1, { qrCode: qrOf('AG-C0001'), eventType: 'SCAN_OUT', tripId: T1 }).expect(201);
    // Steps 1–3.
    for (const body of [{ reasonCode: 'OTHER' }, { reasonCode: 'OTHER', note: 'ab' }, { reasonCode: 'LOST_KEYS' }]) {
      expect((await f.fail(x1.id, body, std.DR1).expect(400)).body.code).toBe('VALIDATION_FAILED');
    }
    expect((await f.order(x1.id)).status).toBe('ASSIGNED');
    // Step 4.
    const failed = await f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME', lat: 31.53, lng: 74.23 }, std.DR1).expect(200);
    expect(failed.body).toMatchObject({ status: 'FAILED', failedAt: expect.any(String), failureReasonCode: 'CUSTOMER_NOT_HOME', stage: 'NOT_DELIVERED' });
    expect((await f.stops(T1)).find((stop) => stop.stopType === 'DELIVERY')?.status).toBe('FAILED');
    // Step 5.
    const again = await f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME', lat: 31.53, lng: 74.23 }, std.DR1).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    // Step 6.
    expect(await f.balance()).toBe(475_000n);
    expect((await f.ledger({ orderId: x1.id })).map((row) => [row.entryType, row.amountPaisa])).toEqual([['DEBIT_ORDER', -25_000n]]);
    const audits = await f.audits('order.fail', x1.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.DR1.userId, reason: 'CUSTOMER_NOT_HOME' });
    const cylinder = await f.cylinder('AG-C0001');
    expect([cylinder.custodyType, cylinder.custodyId]).toEqual(['VEHICLE', std.DR1.vehicleId]);
  });
});
