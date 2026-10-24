/**
 * Orders (API_CONTRACT §7.6): placing, reading, the board, the buttons, cancel reasons, the Delivered
 * guard and the office's manual delivery. The money of each step is asserted in fees.e2e-spec.ts.
 */
import type { INestApplication } from '@nestjs/common';
import { authHeader } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES, x1OrderBody, x2OrderBody } from '../helpers/standard-data';
import { API, OrdersFixture, newKey, type OrderBody } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

const SECRET_KEYS = ['passwordHash', 'cnic', 'cnicEncrypted', 'cnicIndex', 'codeHash', 'tokenHash'];

function keysDeep(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key);
      keysDeep(inner, out);
    }
  }
  return out;
}

// Booting the whole API and the many-round race cases need more than the 30 s default on a busy machine.
jest.setTimeout(300_000);

describeDb('api-orders: orders', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('ORD-001 place order X1: it waits for a driver and keeps its own copy of the cost', async () => {
    const { std } = f;
    const body = { ...x1OrderBody(std), deliveryLabel: 'House 14, Street 5' };
    // Step 1.
    const quote = await f.as(std.DA).post('/orders/quote').send(body).expect(200);
    expect(quote.body.quote).toMatchObject({
      zone: { name: 'North' },
      basePaisa: '25000',
      totalPaisa: '48000',
      lines: [
        { sizeLabel: '11.8 kg', count: 2, perCylinderPaisa: '4000', subtotalPaisa: '8000' },
        { sizeLabel: '45.4 kg', count: 1, perCylinderPaisa: '15000', subtotalPaisa: '15000' },
      ],
    });
    // Step 2.
    const placed = await f.as(std.DA).post('/orders').set('Idempotency-Key', newKey()).send({ ...body, quotedTotalPaisa: '48000' }).expect(201);
    const order = placed.body as OrderBody;
    expect(order).toMatchObject({ status: 'PENDING', stage: 'NEEDS_DRIVER', trip: null, assignedAt: null });
    expect(order.shortCode).toBe(`AG-${String(order.orderNo).padStart(4, '0')}`);
    expect(order.shortCode).toMatch(/^AG-\d{4}$/);
    expect(placed.body.lines).toEqual([
      expect.objectContaining({ sizeLabel: '11.8 kg', fullCount: 2, expectedReturnCount: 2 }),
      expect.objectContaining({ sizeLabel: '45.4 kg', fullCount: 1, expectedReturnCount: 1 }),
    ]);
    expect(order.fee).toMatchObject({
      totalPaisa: '48000',
      status: 'DEDUCTED',
      breakdown: {
        basePaisa: '25000',
        lines: [
          expect.objectContaining({ sizeLabel: '11.8 kg', count: 2, perCylinderPaisa: '4000', subtotalPaisa: '8000' }),
          expect.objectContaining({ sizeLabel: '45.4 kg', count: 1, perCylinderPaisa: '15000', subtotalPaisa: '15000' }),
        ],
      },
    });
    expect(placed.body.destZone).toMatchObject({ name: 'North' });
    expect(placed.body.originStore).toMatchObject({ id: std.DA.homeStoreId, name: 'Ahmed Gas Store' });
    expect(placed.body).toMatchObject({ deliveryFeePaisa: '48000', paymentStatus: 'PAID_VIA_LEDGER' });
    // Step 3.
    const read = await f.as(std.DA).get(`/orders/${order.id}`).expect(200);
    expect(read.body).toMatchObject({ id: order.id, shortCode: order.shortCode, fee: { totalPaisa: '48000', status: 'DEDUCTED' } });
    // Step 4.
    const audits = await f.as(std.SA1).get(`/audit-logs?action=order.create&resourceId=${order.id}`).expect(200);
    const items = Array.isArray(audits.body) ? audits.body : audits.body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ actor: { kind: 'USER', userId: std.DA.userId }, distributorId: std.DA.id });
  });

  it('ORD-002 order lines need a full cylinder, one line per size, and at most orders.maxCylindersPerOrder cylinders', async () => {
    const { std } = f;
    const usman = (lines: unknown[]) => ({ clientId: std.C2.id, addressId: std.C2.addressId, deliveryLabel: "Usman's house", lines });
    const quote = (lines: unknown[]) => f.as(std.DA).post('/orders/quote').send(usman(lines));
    const l = (cylinderTypeId: string, fullCount: number) => ({ cylinderTypeId, fullCount, expectedReturnCount: 0 });
    // Steps 1–3.
    for (const lines of [[], [l(std.sizes.kg11_8, 0)], [l(std.sizes.kg11_8, 1), l(std.sizes.kg11_8, 1)]]) {
      const res = await quote(lines).expect(400);
      expect(res.body).toMatchObject({ code: 'ORDER_LINES_INVALID', message: 'Add at least one full cylinder, one line per size.' });
    }
    // Step 4.
    expect((await quote([l(std.sizes.kg11_8, 20), l(std.sizes.kg15, 10)]).expect(200)).body.quote.totalPaisa).toBe('40000');
    // Step 5.
    const tooMany = [l(std.sizes.kg11_8, 20), l(std.sizes.kg15, 11)];
    const refused = await quote(tooMany).expect(400);
    expect(refused.body).toMatchObject({ code: 'ORDER_TOO_MANY_CYLINDERS', details: { max: 30 }, message: 'Too many cylinders. An order can have at most 30.' });
    // Step 6.
    const before = await f.db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } });
    const ledgerBefore = await f.db.ledgerEntry.count();
    const placed = await f.as(std.DA).post('/orders').set('Idempotency-Key', newKey()).send(usman(tooMany)).expect(400);
    expect(placed.body.code).toBe('ORDER_TOO_MANY_CYLINDERS');
    expect(await f.db.order.count()).toBe(0);
    expect((await f.db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo).toBe(before.nextOrderNo);
    expect(await f.db.ledgerEntry.count()).toBe(ledgerBefore);
    // Step 7.
    await f.as(std.SA1).patch('/settings/orders.maxCylindersPerOrder').send({ value: 40, reason: 'Test bigger orders' }).expect(200);
    await quote(tooMany).expect(200);
    await quote([l(std.sizes.kg15, 31)]).expect(200);
    expect((await http(app).get(`${API}/app/config`).expect(200)).body.orders.maxCylindersPerOrder).toBe(40);
    // Step 8.
    await f.as(std.SA1).patch('/settings/orders.maxCylindersPerOrder').send({ value: 30, reason: 'Back to default' }).expect(200);
    expect((await quote(tooMany).expect(400)).body).toMatchObject({ code: 'ORDER_TOO_MANY_CYLINDERS', details: { max: 30 } });
    // Step 9.
    const perLine = await quote([l(std.sizes.kg11_8, 101)]).expect(400);
    expect(perLine.body.code).toBe('VALIDATION_FAILED');
    expect(perLine.body.details.fields).toEqual([expect.objectContaining({ path: 'lines.0.fullCount', code: 'TOO_LARGE' })]);
  });

  it('ORD-009 order reads are scoped: the owner, the office and the trip driver see an order; anyone else gets 404', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const { tripId } = await f.assign(x1.id, std.DR1);
    // A Bilal Gas order (BG-0001, Hina, South); DB starts with no balance in the standard data.
    await f.setBalance(std.DB, 100_000n);
    const bg = await f.as(std.DB).post('/orders').set('Idempotency-Key', newKey()).send({
      clientId: std.C3.id,
      addressId: std.C3.addressId,
      deliveryLabel: "Hina's house",
      lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
    }).expect(201);
    expect(bg.body.shortCode).toBe('BG-0001');
    const bodies: unknown[] = [];
    // Step 1.
    for (const person of [std.DA, std.SA1, std.DR1]) {
      const res = await f.as(person).get(`/orders/${x1.id}`).expect(200);
      expect(res.body.trip).toEqual({ id: tripId, status: 'PLANNED', driver: { id: std.DR1.id, name: 'Kashif', phone: STANDARD_PHONES.DR1 }, vehicle: { plateNo: 'LEA-101' } });
      bodies.push(res.body);
    }
    expect((await f.as(std.SA1).get(`/orders/${x1.id}`)).body.distributor).toEqual({ id: std.DA.id, businessName: 'Ahmed Gas', code: 'AG' });
    expect((await f.as(std.DA).get(`/orders/${x1.id}`)).body.distributor).toBeUndefined();
    for (const person of [std.DB, std.DR2]) {
      const res = await f.as(person).get(`/orders/${x1.id}`).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    // Step 2.
    for (const person of [std.DA, std.SA1]) {
      const res = await f.as(person).get(`/orders/${x1.id}/tracking`).expect(200);
      expect(res.body).toMatchObject({ orderId: x1.id, status: 'ASSIGNED', deliveryFeePaisa: '48000', tripId });
      expect(res.body.driver).toMatchObject({ id: std.DR1.id, name: 'Kashif', vehiclePlate: 'LEA-101' });
      bodies.push(res.body);
    }
    expect((await f.as(std.DB).get(`/orders/${x1.id}/tracking`).expect(404)).body.code).toBe('NOT_FOUND');
    await f.anonymous().get(`/orders/${x1.id}/tracking`).expect(401);
    // Step 3.
    const bare = await f.as(std.DA).get('/orders').expect(200);
    expect(Array.isArray(bare.body)).toBe(true);
    expect((bare.body as OrderBody[]).every((order) => order.shortCode.startsWith('AG-'))).toBe(true);
    const tab = await f.as(std.DA).get('/orders?tab=active').expect(200);
    expect(tab.body).toMatchObject({ items: expect.any(Array), nextCursor: null });
    expect((tab.body.items as OrderBody[]).map((order) => order.id)).toEqual([x1.id]);
    bodies.push(bare.body, tab.body);
    // Step 4.
    const keys = keysDeep(bodies);
    for (const secret of SECRET_KEYS) expect({ secret, present: keys.has(secret) }).toEqual({ secret, present: false });
  });

  it('ORD-010 GET /orders/board gives the office tabs, counts, search and a distributor filter', async () => {
    const { std, db } = f;
    await f.setBalance(std.DA, 2_000_000n);
    await f.setBalance(std.DB, 100_000n);
    const place = async (client: 'C1' | 'C2') => (client === 'C1' ? f.x1() : f.x2());
    const needs = await place('C1');
    const assigned = await place('C1');
    await f.assign(assigned.id, std.DR1);
    const transit = await place('C1');
    await f.assign(transit.id, std.DR2);
    await db.order.update({ where: { id: transit.id }, data: { status: 'IN_TRANSIT', onTheWayAt: new Date() } });
    const delivered = await place('C2');
    await db.order.update({ where: { id: delivered.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), deliveryMethod: 'DRIVER_TAP' } });
    const cancelled = await place('C2');
    await db.order.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED', cancelledAt: new Date(Date.now() - 2 * 86_400_000) } });
    const old = await place('C2');
    await db.order.update({ where: { id: old.id }, data: { status: 'CANCELLED', cancelledAt: new Date(Date.now() - 8 * 86_400_000) } });
    const dbOrder = await f.as(std.DB).post('/orders').set('Idempotency-Key', newKey()).send({
      clientId: std.C3.id,
      addressId: std.C3.addressId,
      deliveryLabel: "Hina's house",
      lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
    }).expect(201);
    const office = f.as(std.SA1);
    const ids = (res: { body: { items: OrderBody[] } }) => res.body.items.map((order) => order.id);

    // Step 1.
    const needsTab = await office.get('/orders/board?tab=needs-driver').expect(200);
    expect(needsTab.body.counts).toEqual({ needsDriver: 2, inProgress: 2, doneToday: 1, cancelledFailed: 1 });
    expect(ids(needsTab)).toEqual([needs.id, dbOrder.body.id]);
    expect(ids(await office.get('/orders/board?tab=in-progress').expect(200)).sort()).toEqual([assigned.id, transit.id].sort());
    expect(ids(await office.get('/orders/board?tab=done-today').expect(200))).toEqual([delivered.id]);
    expect(ids(await office.get('/orders/board?tab=cancelled-failed').expect(200))).toEqual([cancelled.id]);
    expect(ids(await office.get('/orders/board?tab=all').expect(200))).toHaveLength(7);
    // Step 2.
    const sanaIds = [needs.id, assigned.id, transit.id].sort();
    expect(ids(await office.get('/orders/board?tab=all&q=Sana').expect(200)).sort()).toEqual(sanaIds);
    expect(ids(await office.get(`/orders/board?tab=all&q=${encodeURIComponent('0300 1234567')}`).expect(200)).sort()).toEqual(sanaIds);
    expect(ids(await office.get(`/orders/board?tab=all&q=${needs.shortCode}`).expect(200))).toEqual([needs.id]);
    // Step 3.
    const filtered = await office.get(`/orders/board?tab=needs-driver&distributorId=${std.DA.id}`).expect(200);
    expect(ids(filtered)).toEqual([needs.id]);
    expect(filtered.body.items[0].distributor).toEqual({ id: std.DA.id, businessName: 'Ahmed Gas', code: 'AG' });
    // Step 4.
    expect((await f.as(std.DA).get('/orders/board').expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 5.
    const active = await f.as(std.DA).get('/orders?tab=active').expect(200);
    expect(ids(active)).toEqual([transit.id, assigned.id, needs.id]);
    const done = await f.as(std.DA).get('/orders?tab=done').expect(200);
    expect(ids(done)).toEqual([old.id, cancelled.id, delivered.id]);
  });

  it('ORD-011 allowedActions match the caller and the state, and follow orders.deliveryStartedAt', async () => {
    const { std, db } = f;
    await f.setBalance(std.DA, 2_000_000n);
    const P = await f.x1();
    const A = await f.x1();
    const L = await f.x1();
    // From Inc 2 an order joins its driver's PLANNED trip while that trip has no load (API_CONTRACT §9.5),
    // and the first LOAD stamps every open order of the trip: so L is assigned and loaded first, and A, assigned
    // after it, gets a trip of its own with nothing loaded.
    const lTrip = await f.assign(L.id, std.DR1);
    await f.loadScan(std.DR1, lTrip.tripId, 'AG-C0001').expect(201);
    await f.assign(A.id, std.DR1);
    const T = await f.x1();
    const tTrip = await f.assign(T.id, std.DR2);
    // From Inc 2 the depart is "Done loading" (API_CONTRACT §9.10): all of X1's cylinders are loaded first.
    for (const code of ['AG-C0002', 'AG-C0003', 'AG-C0031']) await f.loadScan(std.DR2, tTrip.tripId, code).expect(201);
    const storeStop = (await f.stops(tTrip.tripId))[0];
    await f.as(std.DR2).patch(`/trips/stops/${storeStop.id}/depart`).expect(200);
    const D = await f.x1();
    await db.order.update({ where: { id: D.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), deliveryMethod: 'DRIVER_TAP' } });
    const actions = async (who: { actor: Parameters<typeof authHeader>[0] }, id: string) => {
      const res = await f.as(who).get(`/orders/${id}`).expect(200);
      return { actions: res.body.allowedActions as string[], allowed: res.body.cancel.allowed as boolean };
    };

    // Step 1: the shop.
    for (const id of [P.id, A.id, L.id]) expect((await actions(std.DA, id)).actions).toContain('CANCEL');
    expect((await actions(std.DA, T.id)).actions).toEqual(['CANCEL', 'TRACK']);
    expect((await actions(std.DA, D.id)).actions).toEqual([]);
    // The office.
    expect((await actions(std.SA1, P.id)).actions).toEqual(['CANCEL', 'ASSIGN']);
    expect((await actions(std.SA1, A.id)).actions).toEqual(['CANCEL', 'REASSIGN', 'MANUAL_DELIVERY']);
    expect((await actions(std.SA1, L.id)).actions).toEqual(['CANCEL', 'MARK_FAILED', 'MANUAL_DELIVERY']);
    expect((await actions(std.SA1, T.id)).actions).toEqual(['CANCEL', 'MARK_FAILED', 'MANUAL_DELIVERY', 'TRACK']);
    expect((await actions(std.SA1, D.id)).actions).toEqual([]);
    // The trip's driver.
    expect((await actions(std.DR1, L.id)).actions).toEqual(['MARK_FAILED']);
    expect((await actions(std.DR1, A.id)).actions).toEqual([]);
    for (const id of [P.id, A.id, L.id, T.id]) expect((await actions(std.SA1, id)).allowed).toBe(true);
    expect((await actions(std.SA1, D.id)).allowed).toBe(false);
    // Step 2.
    await f.as(std.SA1).patch('/settings/orders.deliveryStartedAt').send({ value: 'DRIVER_ASSIGNED', reason: 'Test allowed actions' }).expect(200);
    expect((await actions(std.SA1, A.id)).actions).toContain('MARK_FAILED');
    // Step 3.
    await f.as(std.SA1).patch('/settings/orders.deliveryStartedAt').send({ value: 'FIRST_LOAD_SCAN', reason: 'Back to the default' }).expect(200);
    expect((await actions(std.SA1, A.id)).actions).not.toContain('MARK_FAILED');
  });

  it('ORD-012 cancel reasons: the five codes, Other needs 3–300 characters from the shop, the office always 5–300', async () => {
    const { std } = f;
    await f.setBalance(std.DA, 2_000_000n);
    const orders: OrderBody[] = [];
    for (let i = 0; i < 6; i++) orders.push(await f.x2());
    const [O1, O2, O3, O4, O5, O6] = orders;
    // Steps 1–3.
    const bad = [{ reasonCode: 'CHANGED_MIND' }, { reasonCode: 'OTHER' }, { reasonCode: 'OTHER', note: 'ab' }];
    for (const body of bad) {
      const res = await f.cancel(O1.id, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect((res.body.details.fields as Array<{ path: string }>).map((field) => field.path).some((path) => ['reasonCode', 'note'].includes(path))).toBe(true);
    }
    expect((await f.order(O1.id)).status).toBe('PENDING');
    // Step 4.
    const other = await f.cancel(O1.id, { reasonCode: 'OTHER', note: 'abc' }).expect(200);
    expect(other.body.order).toMatchObject({ status: 'CANCELLED', cancelReasonCode: 'OTHER' });
    // Step 5.
    for (const [order, reasonCode] of [
      [O2, 'CUSTOMER_CANCELLED'],
      [O3, 'WRONG_ORDER'],
      [O4, 'DUPLICATE'],
    ] as const) {
      expect((await f.cancel(order.id, { reasonCode }).expect(200)).body.order.cancelReasonCode).toBe(reasonCode);
    }
    // Step 6.
    expect((await f.cancel(O5.id, { reasonCode: 'OUT_OF_STOCK' }, std.SA1).expect(400)).body.code).toBe('VALIDATION_FAILED');
    await f.cancel(O5.id, { reasonCode: 'OUT_OF_STOCK', note: 'Store has none' }, std.SA1).expect(200);
    // Step 7.
    const short = await f.cancel(O6.id, { reasonCode: 'OTHER', note: 'abcd' }, std.SA1).expect(400);
    expect(short.body.details.fields).toEqual([expect.objectContaining({ path: 'note' })]);
    await f.cancel(O6.id, { reasonCode: 'OTHER', note: 'abcde' }, std.SA1).expect(200);
    // Step 8.
    const rows = await f.audits('order.cancel');
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.reason).toBeTruthy();
      expect(row.diff).toMatchObject({ refunded: expect.any(Boolean), refundPaisa: expect.any(String), startedRule: 'FIRST_LOAD_SCAN' });
    }
    expect(rows.filter((row) => row.actorUserId === std.SA1.id)).toHaveLength(2);
    expect(rows.filter((row) => row.actorUserId === std.DA.userId)).toHaveLength(4);
  });

  // ORD-014 and ORD-015 were retired at Increment 2. The Delivered tap now needs matching hand-over scans
  // and records SCANNED, and the office's manual delivery names its cylinders (API_CONTRACT §9.5, §9.10).
  // Their Inc 2 forms are 'ORD-014 (Inc 2)' in test/inc2/scan/assign-and-steps-inc2.e2e-spec.ts and
  // 'ORD-015 (Inc 2)' in test/inc2/scan/manual-delivery.e2e-spec.ts.

  it('ORD-016 the installed 0.1.0 shop app still works: the old add-customer and place-order requests', async () => {
    const { std } = f;
    const old = authHeader(std.DA.actor);
    // Step 1: no X-App-* headers and no Idempotency-Key.
    const created = await http(app)
      .post(`${API}/clients`)
      .set(old)
      .send({ name: 'Old App Test', phone: '0322 1112223', creditLimitRs: 5000, priority: 'HIGH', city: 'Lahore' })
      .expect(201);
    expect(created.body.client.phone).toBe('+923221112223');
    expect(created.body.id).toBe(created.body.client.id);
    const address = await http(app)
      .post(`${API}/clients/${created.body.id}/addresses`)
      .set(old)
      .send({ label: 'Old house', lat: 31.52, lng: 74.22 })
      .expect(201);
    expect(address.body.zone).toMatchObject({ name: 'North' });
    // Step 2.
    const placed = await http(app)
      .post(`${API}/orders`)
      .set(old)
      .send({
        clientId: created.body.id,
        deliveryLabel: 'Old house · Model Town',
        deliveryLocation: { lat: 31.52, lng: 74.22 },
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 2 }],
      })
      .expect(201);
    expect(placed.body).toMatchObject({ status: 'PENDING', deliveryFeePaisa: '33000', paymentStatus: 'PAID_VIA_LEDGER' });
    // Step 3: a pin inside East (no price there).
    const east = await http(app)
      .post(`${API}/orders`)
      .set(old)
      .send({
        clientId: created.body.id,
        deliveryLabel: 'Old house · East',
        deliveryLocation: std.zones.East.center,
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
      })
      .expect(422);
    expect(east.body).toMatchObject({ code: 'PRICING_PRICE_NOT_SET', error: 'PRICING_PRICE_NOT_SET', message: expect.any(String) });
    // Step 4.
    expect(Array.isArray((await http(app).get(`${API}/orders`).set(old).expect(200)).body)).toBe(true);
    expect(Array.isArray((await http(app).get(`${API}/clients`).set(old).expect(200)).body)).toBe(true);
    // Teardown.
    await f.cancel(placed.body.id, { reasonCode: 'DUPLICATE' }).expect(200);
  });

  // ORD-018 was retired at Increment 2: from inc1b every distributor has its store (`home_store_id`
  // NOT NULL, DATA_MODEL §3.5), so a shop without one can't exist; MIG-014 (test/inc2/db/inc1b.e2e-spec.ts)
  // proves the release refuses such data. ORD-019 was retired for 'ORD-019 (Inc 2)' in
  // test/inc2/scan/manual-delivery.e2e-spec.ts (the manual delivery racing the visit finish).

  it('ORD-001 POST /orders without an Idempotency-Key and with an unknown order id use the documented codes', async () => {
    const { std } = f;
    await f.as(std.DA).post('/orders').send(x2OrderBody(std)).expect(201);
    const missing = await f.as(std.DA).get('/orders/5c1d0e9f-8a7b-4c6d-9e5f-4a3b2c1d0e9f').expect(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND', message: "We couldn't find this. It may have been removed." });
    expect((await f.as(std.DA).get('/orders/not-a-uuid').expect(404)).body.code).toBe('NOT_FOUND');
  });
});
