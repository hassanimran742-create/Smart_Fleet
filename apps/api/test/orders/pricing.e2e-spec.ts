/**
 * Delivery prices and quotes (ADR-08, API_CONTRACT §5.6, §7.5): the office grid, setting and
 * removing a price, the location and order quotes, and the frozen legacy zone-pair routes. A price is
 * ONE flat delivery cost per order, whatever cylinders the order holds (owner, 2026-10-26).
 */
import type { INestApplication } from '@nestjs/common';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createZone } from '../helpers/factories';
import { createStandardData, x1OrderBody, x2OrderBody } from '../helpers/standard-data';
import { OrdersFixture, newKey, together } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

jest.setTimeout(300_000);

describeDb('api-orders: delivery prices and quotes', () => {
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

  const office = () => f.as(f.std.SA1);
  const priceUrl = (distributorId: string, zoneId: string) => `/pricing/prices/${distributorId}/${zoneId}`;

  it('PRC-001 the office price grid shows each distributor price per active zone and the coverage', async () => {
    const { std, db } = f;
    // The office set the standard prices: show who last changed North.
    await db.distributorZonePrice.updateMany({ where: { distributorId: std.DA.id, zoneId: std.zones.North.id }, data: { updatedByUserId: std.SA1.id } });
    // Step 1.
    const grid = await office().get(`/pricing/prices/${std.DA.id}`).expect(200);
    expect(grid.body.distributor).toMatchObject({ businessName: 'Ahmed Gas', code: 'AG', store: { name: 'Ahmed Gas Store', zone: { name: 'North' } } });
    // One cost per order: no size list, and no amount per size on any row.
    expect(Object.keys(grid.body).sort()).toEqual(['coverage', 'distributor', 'zones']);
    const row = (name: string, body = grid.body) => (body.zones as Array<{ zone: { name: string }; price: any }>).find((z) => z.zone.name === name);
    expect(row('North')?.price).toEqual({ basePaisa: '25000', updatedAt: expect.any(String), updatedBy: { id: std.SA1.id, name: 'Owner' } });
    expect(row('South')?.price).toMatchObject({ basePaisa: '40000' });
    expect(Object.keys(row('South')?.price).sort()).toEqual(['basePaisa', 'updatedAt', 'updatedBy']);
    expect(row('East')?.price).toBeNull();
    expect(grid.body.coverage).toEqual({ priced: 2, total: 3 });
    // Step 2.
    const db2 = await office().get(`/pricing/prices/${std.DB.id}`).expect(200);
    expect(row('South', db2.body)?.price.basePaisa).toBe('30000');
    expect([row('North', db2.body)?.price, row('East', db2.body)?.price]).toEqual([null, null]);
    expect(db2.body.coverage).toEqual({ priced: 1, total: 3 });
    // Step 3.
    await office().delete(`/zones/${std.zones.East.id}`).expect(200);
    const after = await office().get(`/pricing/prices/${std.DA.id}`).expect(200);
    expect(after.body.coverage).toEqual({ priced: 2, total: 2 });
    expect(row('East', after.body)?.zone).toMatchObject({ isActive: false });
  });

  it('PRC-002 setting a price saves the one delivery cost per order, applies at once, and is audited', async () => {
    const { std } = f;
    const east = priceUrl(std.DA.id, std.zones.East.id);
    // Step 1.
    const body = { basePaisa: 20000, note: 'Pilot price East' };
    const saved = await office().put(east).send(body).expect(200);
    expect(saved.body.zone).toMatchObject({ name: 'East', isActive: true, cityName: 'Lahore' });
    expect(saved.body.price).toEqual({ basePaisa: '20000', updatedAt: expect.any(String), updatedBy: { id: std.SA1.id, name: 'Owner' } });
    expect((await office().get(`/pricing/prices/${std.DA.id}`).expect(200)).body.coverage).toEqual({ priced: 3, total: 3 });
    // Step 2.
    const again = await office().put(east).send(body).expect(200);
    expect(again.body).toEqual(saved.body);
    expect(await f.audits('price.set')).toHaveLength(1);
    // Step 3: the same cost for any order there, whatever its cylinders.
    const pin = std.zones.East.center;
    const location = await f.as(std.DA).get(`/pricing/quote?lat=${pin.lat}&lng=${pin.lng}`).expect(200);
    expect(location.body).toMatchObject({ serviceable: true, zone: { name: 'East' }, price: { basePaisa: '20000' } });
    const quoteBody = (lines: unknown[]) => ({ clientId: std.C1.id, deliveryLocation: pin, deliveryLabel: 'Shop, East', lines });
    const two = quoteBody([{ cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 2 }]);
    const many = quoteBody([
      { cylinderTypeId: std.sizes.kg6, fullCount: 5, expectedReturnCount: 0 },
      { cylinderTypeId: std.sizes.kg45_4, fullCount: 3, expectedReturnCount: 3 },
    ]);
    expect((await f.as(std.DA).post('/orders/quote').send(two).expect(200)).body.quote.totalPaisa).toBe('20000');
    expect((await f.as(std.DA).post('/orders/quote').send(many).expect(200)).body.quote.totalPaisa).toBe('20000');
    // Step 4.
    await office().put(east).send({ basePaisa: 22000 }).expect(200);
    expect((await f.as(std.DA).post('/orders/quote').send(two).expect(200)).body.quote.totalPaisa).toBe('22000');
    // Step 5.
    const rows = await f.audits('price.set');
    expect(rows).toHaveLength(2);
    const diff = (i: number) => rows[i].diff as { before: unknown; after: unknown };
    expect(diff(0).before).toBeNull();
    expect(diff(0).after).toEqual({ basePaisa: '20000', note: 'Pilot price East' });
    expect(diff(1).before).toEqual(diff(0).after);
    expect(diff(1).after).toEqual({ basePaisa: '22000', note: null });
    expect(rows.every((row) => row.actorUserId === std.SA1.id)).toBe(true);
    await office().delete(east).send({ reason: 'restore test data' }).expect(200);
  });

  it('PRC-003 a flat price costs the same whatever the cylinders (X2, and X1 in North)', async () => {
    const { std } = f;
    // Step 1.
    const quote = await f.as(std.DA).post('/orders/quote').send(x2OrderBody(std)).expect(200);
    expect(quote.body.quote).toEqual({
      strategy: 'DISTRIBUTOR_ZONE',
      zone: { id: std.zones.South.id, name: 'South' },
      basePaisa: '40000',
      totalPaisa: '40000',
    });
    // Step 2.
    const mixed = await f
      .as(std.DA)
      .post('/orders/quote')
      .send({
        ...x2OrderBody(std),
        lines: [
          { cylinderTypeId: std.sizes.kg6, fullCount: 1, expectedReturnCount: 0 },
          { cylinderTypeId: std.sizes.kg45_4, fullCount: 2, expectedReturnCount: 0 },
        ],
      })
      .expect(200);
    expect(mixed.body.quote.totalPaisa).toBe('40000');
    // X1 (2 × 11.8 kg + 1 × 45.4 kg) and one 6 kg cylinder in North cost the same Rs 250.
    expect((await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200)).body.quote.totalPaisa).toBe('25000');
    const one = { ...x1OrderBody(std), lines: [{ cylinderTypeId: std.sizes.kg6, fullCount: 1, expectedReturnCount: 0 }] };
    expect((await f.as(std.DA).post('/orders/quote').send(one).expect(200)).body.quote.totalPaisa).toBe('25000');
    // Step 3.
    const placed = await f.placeX2(newKey(), { quotedTotalPaisa: '40000' }).expect(201);
    expect(placed.body.fee).toEqual({ totalPaisa: '40000', status: 'DEDUCTED' });
    expect(await f.balance()).toBe(460_000n);
    const debit = await f.ledger({ entryType: 'DEBIT_ORDER' });
    expect(debit.map((row) => row.amountPaisa)).toEqual([-40_000n]);
    // The order keeps one cost; its lines hold the cylinders only.
    const order = await f.db.order.findUniqueOrThrow({ where: { id: placed.body.id }, include: { lines: true } });
    expect([order.deliveryFeePaisa, order.feeBasePaisa]).toEqual([40_000n, 40_000n]);
    expect(Object.keys(order.lines[0]).sort()).toEqual(['cylinderTypeId', 'expectedReturnCount', 'fullCount', 'id', 'orderId']);
  });

  it('PRC-004 invalid price saves are refused and change nothing: negative, paisa, fractions, too large, per size, archived zone', async () => {
    const { std } = f;
    const westTest = await createZone({ city: { id: std.zones.North.cityId }, name: 'West Test', bbox: [74.0, 31.5, 74.05, 31.55], isActive: false });
    const east = priceUrl(std.DA.id, std.zones.East.id);
    // Steps 1 and 2.
    const bad: unknown[] = [-10000, 25050, 250.5, 'abc', '99999999999999999999', 10000100];
    for (const basePaisa of bad) {
      const res = await office().put(east).send({ basePaisa }).expect(400);
      expect({ basePaisa, code: res.body.code, message: res.body.message }).toEqual({
        basePaisa,
        code: 'PRICE_INVALID',
        message: 'Enter whole rupees, from Rs 0 to Rs 100,000.',
      });
    }
    // Per-size amounts are gone: a body that still sends them is refused.
    for (const sizes of [[{ cylinderTypeId: std.sizes.kg11_8, perCylinderPaisa: 4000 }], []]) {
      const res = await office().put(east).send({ basePaisa: 20000, sizes }).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: [{ path: 'sizes', code: 'NOT_ALLOWED' }] } });
    }
    // Step 3.
    const archived = await office().put(priceUrl(std.DA.id, westTest.id)).send({ basePaisa: 20000 }).expect(409);
    expect(archived.body).toMatchObject({ code: 'ZONE_ARCHIVED', message: 'This zone is archived.' });
    // Step 4.
    const south = priceUrl(std.DA.id, std.zones.South.id);
    await office().put(south).send({ basePaisa: 10000000 }).expect(200);
    const back = await office().put(south).send({ basePaisa: 40000 }).expect(200);
    expect(back.body.price.basePaisa).toBe('40000');
    // Step 5.
    const grid = await office().get(`/pricing/prices/${std.DA.id}`).expect(200);
    expect((grid.body.zones as Array<{ zone: { name: string }; price: unknown }>).find((row) => row.zone.name === 'East')?.price).toBeNull();
    expect(grid.body.coverage).toEqual({ priced: 2, total: 3 });
    const eastAudits = (await f.audits('price.set')).filter((row) => (row.diff as { zone?: string }).zone === 'East');
    expect(eastAudits).toEqual([]);
  });

  it('PRC-005 removing a price needs a reason and blocks the zone again, but placed orders keep their cost', async () => {
    const { std } = f;
    const x2 = await f.x2();
    expect(await f.balance()).toBe(460_000n);
    const south = priceUrl(std.DA.id, std.zones.South.id);
    // Step 1.
    expect((await office().delete(south).expect(400)).body.code).toBe('VALIDATION_FAILED');
    const removed = await office().delete(south).send({ reason: 'Price under review' }).expect(200);
    expect(removed.body).toMatchObject({ zone: { name: 'South' }, price: null });
    const audits = await f.audits('price.remove');
    expect(audits).toHaveLength(1);
    expect(audits[0].reason).toBe('Price under review');
    expect((audits[0].diff as { before: unknown }).before).toEqual({ basePaisa: '40000', note: null });
    const again = await office().delete(south).send({ reason: 'Price under review' }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(await f.audits('price.remove')).toHaveLength(1);
    // Step 2.
    const pin = std.C2.location as { lat: number; lng: number };
    expect((await f.as(std.DA).get(`/pricing/quote?lat=${pin.lat}&lng=${pin.lng}`).expect(200)).body.blockCode).toBe('PRICING_PRICE_NOT_SET');
    const refused = await f.placeX2().expect(422);
    expect(refused.body).toMatchObject({ code: 'PRICING_PRICE_NOT_SET', details: { zoneName: 'South' } });
    expect(await f.balance()).toBe(460_000n);
    const clients = await f.as(std.DA).get('/clients').expect(200);
    const usman = (clients.body as Array<{ id: string; addresses: Array<{ priceStatus: string }> }>).find((c) => c.id === std.C2.id);
    expect(usman?.addresses[0].priceStatus).toBe('NOT_SET');
    // Step 3.
    expect((await f.as(std.DA).get(`/orders/${x2.id}`).expect(200)).body.fee.totalPaisa).toBe('40000');
    const cancel = await f.cancel(x2.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '40000' }).expect(200);
    expect(cancel.body.refundedPaisa).toBe('40000');
    expect(await f.balance()).toBe(500_000n);
    // Step 4.
    await office().put(south).send({ basePaisa: 40000 }).expect(200);
  });

  it('PRC-006 two office users saving the first price for a zone at the same moment leave one consistent price', async () => {
    const { std, db } = f;
    const east = priceUrl(std.DA.id, std.zones.East.id);
    const bodyA = { basePaisa: 20000, note: 'Saved by Owner' };
    const bodyB = { basePaisa: 21000, note: 'Saved by Ops' };
    for (let round = 0; round < 20; round++) {
      const setsBefore = (await f.audits('price.set')).length;
      const [a, b] = await together(office().put(east).send(bodyA), f.as(std.SA2).put(east).send(bodyB));
      for (const res of [a, b]) {
        expect({ round, status: res.status }).toEqual({ round, status: res.status === 409 ? 409 : 200 });
        if (res.status === 409) expect(res.body.code).toBe('CONFLICT_STALE_STATE');
      }
      const rows = await db.distributorZonePrice.findMany({ where: { distributorId: std.DA.id, zoneId: std.zones.East.id } });
      expect({ round, rows: rows.length }).toEqual({ round, rows: 1 });
      const stored = { basePaisa: Number(rows[0].basePaisa), note: rows[0].note };
      expect([JSON.stringify(bodyA), JSON.stringify(bodyB)]).toContain(JSON.stringify(stored));
      const successes = [a, b].filter((res) => res.status === 200).length;
      expect((await f.audits('price.set')).length - setsBefore).toBe(successes);
      await office().delete(east).send({ reason: 'Race test round reset' }).expect(200);
    }
  });

  it('PRC-007 price routes are office only, and a distributor quote always uses its own prices', async () => {
    const { std, db } = f;
    const before = await db.distributorZonePrice.count();
    // Step 1.
    for (const who of [std.DA, std.DR1]) {
      const calls = [
        f.as(who).get(`/pricing/prices/${std.DA.id}`),
        f.as(who).put(priceUrl(std.DA.id, std.zones.East.id)).send({ basePaisa: 0 }),
        f.as(who).delete(priceUrl(std.DA.id, std.zones.North.id)).send({ reason: 'test removal' }),
      ];
      for (const call of calls) expect((await call.expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    expect(await db.distributorZonePrice.count()).toBe(before);
    // Step 2.
    const southPin = std.zones.South.center;
    const own = await f.as(std.DA).get(`/pricing/quote?lat=${southPin.lat}&lng=${southPin.lng}&distributorId=${std.DB.id}`).expect(200);
    expect(own.body.price.basePaisa).toBe('40000');
    // Step 3.
    const northPin = std.zones.North.center;
    expect((await f.as(std.DB).get(`/pricing/quote?lat=${northPin.lat}&lng=${northPin.lng}`).expect(200)).body.blockCode).toBe('PRICING_PRICE_NOT_SET');
    // Step 4.
    const asOffice = await office().get(`/pricing/quote?lat=${southPin.lat}&lng=${southPin.lng}&distributorId=${std.DB.id}`).expect(200);
    expect(asOffice.body.price.basePaisa).toBe('30000');
    expect((await office().post('/orders/quote').send(x2OrderBody(std)).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // The office must name the distributor.
    expect((await office().get(`/pricing/quote?lat=${southPin.lat}&lng=${southPin.lng}`).expect(400)).body.details.fields[0]).toMatchObject({
      path: 'distributorId',
      code: 'REQUIRED',
    });
  });

  it('PRC-008 the location quote answers 200 for every pin: priced, price not set, outside', async () => {
    const { std } = f;
    const quote = (pin: { lat: number; lng: number }) => f.as(std.DA).get(`/pricing/quote?lat=${pin.lat}&lng=${pin.lng}`).expect(200);
    const north = await quote(std.zones.North.center);
    expect(north.body).toEqual({
      serviceable: true,
      zone: { id: std.zones.North.id, name: 'North' },
      price: { zone: { id: std.zones.North.id, name: 'North' }, basePaisa: '25000', updatedAt: expect.any(String) },
      blockCode: null,
    });
    const south = await quote(std.zones.South.center);
    expect(south.body).toMatchObject({ serviceable: true, price: { basePaisa: '40000' }, blockCode: null });
    expect((await quote(std.zones.East.center)).body).toEqual({ serviceable: false, zone: { id: std.zones.East.id, name: 'East' }, price: null, blockCode: 'PRICING_PRICE_NOT_SET' });
    expect((await quote(std.outside)).body).toEqual({ serviceable: false, zone: null, price: null, blockCode: 'PRICING_ZONE_NOT_COVERED' });
    // The North–South border, five times: the same zone each time, the smaller one (then the older).
    const border = { lat: 31.525, lng: 74.25 };
    const zones = new Set<string>();
    for (let i = 0; i < 5; i++) zones.add((await quote(border)).body.zone.id);
    const ranked = await f.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM zones WHERE id IN (${std.zones.North.id}::uuid, ${std.zones.South.id}::uuid)
      ORDER BY ST_Area(polygon), created_at, id`;
    expect([...zones]).toEqual([ranked[0].id]);
  });

  it('PRC-009 a customer cannot be added in a zone with no price or outside every zone, until the office sets a price', async () => {
    const { std, db } = f;
    const eastPin = std.zones.East.center;
    const before = { clients: await db.client.count(), addresses: await db.clientAddress.count() };
    // Step 1.
    const east = await f.as(std.DA).post('/clients').set('Idempotency-Key', newKey()).send({ name: 'Test East', phone: '0300 7654321', address: { label: 'House 9, East', ...eastPin } }).expect(422);
    expect(east.body).toMatchObject({
      code: 'PRICING_PRICE_NOT_SET',
      details: { zoneId: std.zones.East.id, zoneName: 'East' },
      message: 'No delivery price is set for East yet. Ask the office to set it.',
    });
    // Step 2.
    const out = await f.as(std.DA).post('/clients').send({ name: 'Test Out', phone: '0300 7654322', address: { label: 'Far away', ...std.outside } }).expect(422);
    expect(out.body).toMatchObject({ code: 'PRICING_ZONE_NOT_COVERED', message: 'This location is outside our delivery area.' });
    expect({ clients: await db.client.count(), addresses: await db.clientAddress.count() }).toEqual(before);
    // Step 3.
    expect((await f.as(std.DA).post(`/clients/${std.C1.id}/addresses`).send({ label: 'Shop, East', ...eastPin }).expect(422)).body.code).toBe('PRICING_PRICE_NOT_SET');
    expect(await db.clientAddress.count({ where: { clientId: std.C1.id } })).toBe(1);
    // Step 4.
    const noPin = await f.as(std.DA).post('/clients').send({ name: 'Test NoPin', phone: '0300 7654323' }).expect(201);
    expect(noPin.body).toMatchObject({ address: null, price: null });
    // Step 5.
    await office().put(priceUrl(std.DA.id, std.zones.East.id)).send({ basePaisa: 20000 }).expect(200);
    const added = await f.as(std.DA).post('/clients').set('Idempotency-Key', newKey()).send({ name: 'Test East', phone: '0300 7654321', address: { label: 'House 9, East', ...eastPin } }).expect(201);
    expect(added.body).toMatchObject({ address: { zone: { name: 'East' } }, price: { basePaisa: '20000' } });
    expect((await db.clientAddress.findUniqueOrThrow({ where: { id: added.body.address.id } })).zoneId).toBe(std.zones.East.id);
    await office().delete(priceUrl(std.DA.id, std.zones.East.id)).send({ reason: 'Restore test data' }).expect(200);
  });

  it('PRC-010 the order quote gives the X1 cost and whether the wallet is enough, and changes nothing', async () => {
    const { std, db } = f;
    const counts = async () => ({
      orders: await db.order.count(),
      ledger: await db.ledgerEntry.count(),
      audits: await db.auditLog.count(),
      next: (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo,
    });
    const quote = (lines: unknown[]) => f.as(std.DA).post('/orders/quote').send({ ...x1OrderBody(std), lines });
    // Step 1.
    const x1 = await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200);
    expect(x1.body).toEqual({
      quote: { strategy: 'DISTRIBUTOR_ZONE', zone: { id: std.zones.North.id, name: 'North' }, basePaisa: '25000', totalPaisa: '25000' },
      wallet: { balancePaisa: '500000', enough: true, shortByPaisa: '0' },
    });
    const before = await counts();
    // Step 2: ten 15 kg cylinders cost the same as X1.
    expect((await quote([{ cylinderTypeId: std.sizes.kg15, fullCount: 10, expectedReturnCount: 0 }]).expect(200)).body.quote.totalPaisa).toBe('25000');
    // Step 3.
    await f.setBalance(std.DA, 24_900n);
    const short = await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200);
    expect(short.body.wallet).toEqual({ balancePaisa: '24900', enough: false, shortByPaisa: '100' });
    const afterBalance = await counts();
    // Step 4.
    expect((await quote([]).expect(400)).body.code).toBe('ORDER_LINES_INVALID');
    const tooMany = await quote([
      { cylinderTypeId: std.sizes.kg11_8, fullCount: 16, expectedReturnCount: 0 },
      { cylinderTypeId: std.sizes.kg15, fullCount: 15, expectedReturnCount: 0 },
    ]).expect(400);
    expect(tooMany.body).toMatchObject({ code: 'ORDER_TOO_MANY_CYLINDERS', details: { max: 30 }, message: 'Too many cylinders. An order can have at most 30.' });
    // Step 5 (the balance set-up added one ledger row of its own).
    expect(before.orders).toBe(0);
    expect(await counts()).toEqual(afterBalance);
    expect(afterBalance).toMatchObject({ orders: 0, audits: before.audits, next: before.next });
  });

  it('PRC-011 placing an order to an unpriced or uncovered spot is blocked and nothing is deducted', async () => {
    const { std, db } = f;
    const body = (pin: { lat: number; lng: number }, label: string) => ({
      clientId: std.C1.id,
      deliveryLocation: pin,
      deliveryLabel: label,
      lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
    });
    const nextBefore = (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo;
    // Step 1.
    const east = await f.as(std.DA).post('/orders').set('Idempotency-Key', newKey()).send(body(std.zones.East.center, 'Shop, East')).expect(422);
    expect(east.body).toMatchObject({
      code: 'PRICING_PRICE_NOT_SET',
      details: { zoneId: std.zones.East.id, zoneName: 'East' },
      message: 'No delivery price is set for East yet. Ask the office to set it.',
    });
    // Step 2.
    const outside = await f.as(std.DA).post('/orders').set('Idempotency-Key', newKey()).send(body(std.outside, 'Far away')).expect(422);
    expect(outside.body).toMatchObject({ code: 'PRICING_ZONE_NOT_COVERED', message: 'This location is outside our delivery area.' });
    // Step 3.
    expect((await f.as(std.DA).post('/orders/quote').send(body(std.zones.East.center, 'Shop, East')).expect(422)).body.code).toBe('PRICING_PRICE_NOT_SET');
    expect((await f.as(std.DA).post('/orders/quote').send(body(std.outside, 'Far away')).expect(422)).body.code).toBe('PRICING_ZONE_NOT_COVERED');
    // Step 4.
    expect(await f.balance()).toBe(500_000n);
    expect(await db.order.count()).toBe(0);
    expect(await f.ledger({ entryType: 'DEBIT_ORDER' })).toEqual([]);
    expect(await f.audits('order.create')).toEqual([]);
    expect((await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo).toBe(nextBefore);
  });

  it('PRC-013 a price change after placement never changes a placed order cost or refund', async () => {
    const { std } = f;
    const x1 = await f.x1();
    expect(await f.balance()).toBe(475_000n);
    // Step 1.
    const north = priceUrl(std.DA.id, std.zones.North.id);
    await office().put(north).send({ basePaisa: 30000 }).expect(200);
    // Step 2.
    const read = await f.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(read.body.fee).toEqual({ totalPaisa: '25000', status: 'DEDUCTED' });
    expect(read.body.deliveryFeePaisa).toBe('25000');
    expect((await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200)).body.quote.totalPaisa).toBe('30000');
    // Step 3.
    const cancel = await f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '25000' }).expect(200);
    expect(cancel.body.refundedPaisa).toBe('25000');
    expect(await f.balance()).toBe(500_000n);
    // Step 4.
    await office().put(north).send({ basePaisa: 25000 }).expect(200);
  });

  it('PRC-014 if the price changes between review and placing, the order is refused with the new cost', async () => {
    const { std, db } = f;
    // Step 1.
    expect((await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200)).body.quote.totalPaisa).toBe('25000');
    // Step 2.
    const north = priceUrl(std.DA.id, std.zones.North.id);
    await office().put(north).send({ basePaisa: 30000 }).expect(200);
    // Step 3.
    const changed = await f.placeX1(newKey(), { quotedTotalPaisa: '25000' }).expect(409);
    expect(changed.body).toMatchObject({
      code: 'PRICING_QUOTE_CHANGED',
      details: { totalPaisa: '30000', quote: { totalPaisa: '30000', basePaisa: '30000' } },
      message: 'The delivery cost is now Rs 300. Check it and place the order again.',
    });
    expect(await db.order.count()).toBe(0);
    expect(await f.balance()).toBe(500_000n);
    // Step 4.
    const placed = await f.placeX1(newKey(), { quotedTotalPaisa: '30000' }).expect(201);
    expect(placed.body.fee.totalPaisa).toBe('30000');
    expect(await f.balance()).toBe(470_000n);
    // Step 5.
    await f.placeX1(newKey()).expect(201);
    expect(await f.balance()).toBe(440_000n);
    await office().put(north).send({ basePaisa: 25000 }).expect(200);
  });

  it('PRC-017 the old zone-pair pricing routes are office only and never change a quote', async () => {
    const { std, db } = f;
    const city = std.zones.North.cityId;
    const rule = {
      cityId: city,
      originZoneId: std.zones.North.id,
      destZoneId: std.zones.North.id,
      cylinderTypeId: std.sizes.kg11_8,
      basePaisa: 99900,
      perUnitPaisa: 99900,
    };
    // Step 1.
    for (const who of [std.DA, std.DR1]) {
      expect((await f.as(who).get(`/pricing/city/${city}`).expect(403)).body.code).toBe('PERMISSION_DENIED');
      expect((await f.as(who).post('/pricing/rules').send(rule).expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    // Step 2.
    expect(Array.isArray((await office().get(`/pricing/city/${city}`).expect(200)).body)).toBe(true);
    // Step 3.
    const pricesBefore = await db.distributorZonePrice.findMany({ orderBy: { id: 'asc' } });
    const created = await office().post('/pricing/rules').send(rule).expect(201);
    expect(created.body).toMatchObject({ cityId: city, originZoneId: std.zones.North.id, basePaisa: '99900' });
    expect(await db.pricingRule.count()).toBe(1);
    expect(await db.distributorZonePrice.findMany({ orderBy: { id: 'asc' } })).toEqual(pricesBefore);
    // Step 4.
    expect((await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200)).body.quote.totalPaisa).toBe('25000');
  });
});
