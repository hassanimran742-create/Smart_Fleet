/**
 * Customers and zones (API_CONTRACT §7.2, §7.4): adding a customer with its delivery price, phone
 * rules, retries, the one zone-lookup rule, archived zones, other shops' customers, and the office's
 * zone routes.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type { ZoneListRow } from '@smartfleet/shared-types';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createStandardData, STANDARD_PHONES, x1OrderBody } from '../helpers/standard-data';
import { OrdersFixture, newKey, together } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

jest.setTimeout(300_000);

function box(x1: number, y1: number, x2: number, y2: number) {
  return { type: 'MultiPolygon', coordinates: [[[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]]] };
}

describeDb('api-orders: customers and zones', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
  });

  afterAll(async () => {
    await app?.close();
  });

  const northPin = { lat: 31.53, lng: 74.23 };
  const southPin = { lat: 31.53, lng: 74.27 };

  it('CUS-001 add a customer with a North pin: phone saved as +923001234567, with its zone and price', async () => {
    const { std, db } = f;
    // Standard data without Sana.
    await db.clientAddress.deleteMany({ where: { clientId: std.C1.id } });
    await db.client.delete({ where: { id: std.C1.id } });
    const auditsBefore = await db.auditLog.count();
    // Step 1.
    const res = await f
      .as(std.DA)
      .post('/clients')
      .set('X-App-Variant', 'distributor')
      .set('Idempotency-Key', newKey())
      .send({ name: 'Sana', phone: '0300 1234567', area: 'Model Town', address: { label: 'House 14, Street 5', ...northPin } })
      .expect(201);
    expect(res.body.client).toMatchObject({ name: 'Sana', phone: '+923001234567', area: 'Model Town' });
    expect(res.body.address).toMatchObject({ label: 'House 14, Street 5', zone: { name: 'North' } });
    expect(res.body.price).toMatchObject({ zone: { name: 'North' }, basePaisa: '25000' });
    expect((res.body.price.sizes as Array<{ sizeLabel: string; perCylinderPaisa: string }>).map((size) => [size.sizeLabel, size.perCylinderPaisa])).toEqual([
      ['6 kg', '3000'],
      ['11.8 kg', '4000'],
      ['15 kg', '8000'],
      ['45.4 kg', '15000'],
    ]);
    // Step 2.
    const list = await f.as(std.DA).get('/clients').expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    const sana = (list.body as Array<{ id: string; addresses: Array<{ zone: { name: string }; priceStatus: string }> }>).find((c) => c.id === res.body.client.id);
    expect(sana?.addresses[0]).toMatchObject({ zone: { name: 'North' }, priceStatus: 'SET' });
    // Step 3.
    expect((await db.clientAddress.findUniqueOrThrow({ where: { id: res.body.address.id } })).zoneId).toBe(std.zones.North.id);
    expect(await db.auditLog.count()).toBe(auditsBefore);
  });

  it('CUS-002 customer phone rules: an invalid mobile is 400, a duplicate in one shop 409, another shop may reuse it', async () => {
    const { std, db } = f;
    // Steps 1 and 2.
    for (const [name, phone] of [
      ['Test Landline', '0423 1234567'],
      ['Test Short', '0300 12345'],
    ]) {
      const res = await f.as(std.DA).post('/clients').send({ name, phone, address: { label: 'Test', ...northPin } }).expect(400);
      expect(res.body).toMatchObject({ code: 'CLIENT_PHONE_INVALID', message: 'Enter a number like 300 1234567.' });
    }
    // Step 3.
    const dup = await f.as(std.DA).post('/clients').send({ name: 'Sana B', phone: '+92 300 1234567', address: { label: 'Test', ...southPin } }).expect(409);
    expect(dup.body).toMatchObject({
      code: 'CLIENT_PHONE_EXISTS',
      details: { clientId: std.C1.id, name: 'Sana' },
      message: 'Sana already has this number. Pick them from the list.',
    });
    // Step 4.
    const other = await f.as(std.DB).post('/clients').send({ name: 'Hina Two', phone: '0300 1234567', address: { label: 'Test', lat: 31.51, lng: 74.28 } }).expect(201);
    expect(other.body.client.phone).toBe('+923001234567');
    expect(JSON.stringify(other.body)).not.toMatch(/Sana|Ahmed Gas/);
    // Step 5.
    const list = (await f.as(std.DA).get('/clients').expect(200)).body as Array<{ name: string; phone: string }>;
    expect(list.filter((c) => c.phone === STANDARD_PHONES.C1).map((c) => c.name)).toEqual(['Sana']);
    expect(list.map((c) => c.name)).not.toEqual(expect.arrayContaining(['Test Landline']));
    expect(list.map((c) => c.name).some((name) => ['Test Landline', 'Test Short', 'Sana B'].includes(name))).toBe(false);
    // Teardown: DB keeps only Hina.
    await db.clientAddress.deleteMany({ where: { clientId: other.body.client.id } });
    await db.client.delete({ where: { id: other.body.client.id } });
  });

  it('CUS-003 retrying Add customer with the same Idempotency-Key does not create a second customer', async () => {
    const { std } = f;
    const K1 = newKey();
    const body = { name: 'Test Retry', phone: '0321 4445556', address: { label: 'House 3', ...northPin } };
    // Step 1.
    const first = await f.as(std.DA).post('/clients').set('Idempotency-Key', K1).send(body).expect(201);
    // Step 2.
    const again = await f.as(std.DA).post('/clients').set('Idempotency-Key', K1).send(body).expect(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.client.id).toBe(first.body.client.id);
    // Step 3.
    const list = (await f.as(std.DA).get('/clients').expect(200)).body as Array<{ name: string; addresses: unknown[] }>;
    const retries = list.filter((c) => c.name === 'Test Retry');
    expect(retries).toHaveLength(1);
    expect(retries[0].addresses).toHaveLength(1);
    // Step 4.
    expect((await f.as(std.DA).post('/clients').set('Idempotency-Key', K1).send({ ...body, name: 'Other Name' }).expect(409)).body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(((await f.as(std.DA).get('/clients').expect(200)).body as Array<{ name: string }>).filter((c) => c.name === 'Test Retry')).toHaveLength(1);
  });

  it('CUS-004 zone lookup for a pin inside a zone, on a border and outside every zone', async () => {
    const { std } = f;
    const quote = (pin: { lat: number; lng: number }) => f.as(std.DA).get(`/pricing/quote?lat=${pin.lat}&lng=${pin.lng}`).expect(200);
    const locate = async (pin: { lat: number; lng: number }) => {
      const res = await f.as(std.SA1).get(`/zones/locate?lat=${pin.lat}&lng=${pin.lng}`).expect(200);
      return res.body && res.body.id ? (res.body.id as string) : null;
    };
    const ranked = await f.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM zones WHERE id IN (${std.zones.North.id}::uuid, ${std.zones.South.id}::uuid)
      ORDER BY ST_Area(polygon), created_at, id`;
    const points = {
      insideNorth: std.zones.North.center,
      insideSouth: std.zones.South.center,
      outerNorthVertex: { lat: 31.5, lng: 74.2 },
      sharedVertex: { lat: 31.5, lng: 74.25 },
      outside: std.outside,
    };
    // Step 1.
    expect((await quote(points.insideNorth)).body).toMatchObject({ zone: { name: 'North' }, blockCode: null });
    expect((await quote(points.insideSouth)).body).toMatchObject({ zone: { name: 'South' }, blockCode: null });
    // Step 2.
    expect((await quote(points.outerNorthVertex)).body.zone.name).toBe('North');
    // Step 3.
    const shared = new Set<string>();
    for (let i = 0; i < 5; i++) shared.add((await quote(points.sharedVertex)).body.zone.id);
    expect([...shared]).toEqual([ranked[0].id]);
    // Step 4.
    expect((await quote(points.outside)).body).toEqual({ serviceable: false, zone: null, price: null, blockCode: 'PRICING_ZONE_NOT_COVERED' });
    // Step 5.
    expect(await locate(points.insideNorth)).toBe(std.zones.North.id);
    expect(await locate(points.insideSouth)).toBe(std.zones.South.id);
    expect(await locate(points.outerNorthVertex)).toBe(std.zones.North.id);
    expect(await locate(points.sharedVertex)).toBe(ranked[0].id);
    expect(await locate(points.outside)).toBeNull();
  });

  it('CUS-005 a pin in an archived zone counts as outside, and quotes re-check the zone', async () => {
    const { std } = f;
    const body = { ...x1OrderBody(std), deliveryLabel: 'House 14, Street 5' };
    // Step 1.
    await f.as(std.SA1).delete(`/zones/${std.zones.North.id}`).expect(200);
    // Step 2.
    const pin = std.C1.location as { lat: number; lng: number };
    expect((await f.as(std.DA).get(`/pricing/quote?lat=${pin.lat}&lng=${pin.lng}`).expect(200)).body).toMatchObject({ zone: null, blockCode: 'PRICING_ZONE_NOT_COVERED' });
    // Step 3.
    const refused = await f.as(std.DA).post('/orders/quote').send(body).expect(422);
    expect(refused.body).toMatchObject({ code: 'PRICING_ZONE_NOT_COVERED', message: 'This location is outside our delivery area.' });
    expect(await f.db.order.count()).toBe(0);
    // Step 4.
    const list = (await f.as(std.DA).get('/clients').expect(200)).body as Array<{ id: string; addresses: Array<{ zone: unknown; priceStatus: string }> }>;
    expect(list.find((c) => c.id === std.C1.id)?.addresses[0]).toMatchObject({ zone: null, priceStatus: 'OUTSIDE' });
    // Step 5.
    await f.as(std.SA1).patch(`/zones/${std.zones.North.id}/reactivate`).expect(200);
    const back = await f.as(std.DA).post('/orders/quote').send(body).expect(200);
    expect(back.body.quote).toMatchObject({ zone: { name: 'North' }, totalPaisa: '48000' });
  });

  it('CUS-006 a second address in another zone gets that zone price, and the quote follows the chosen address', async () => {
    const { std } = f;
    // Step 1.
    const added = await f.as(std.DA).post(`/clients/${std.C1.id}/addresses`).send({ label: 'Shop, Main Market', ...southPin }).expect(201);
    expect(added.body).toMatchObject({ ok: true, zone: { name: 'South' }, price: { basePaisa: '40000' } });
    expect((added.body.price.sizes as Array<{ perCylinderPaisa: string }>).every((size) => size.perCylinderPaisa === '0')).toBe(true);
    const quote = (addressId: string) => f.as(std.DA).post('/orders/quote').send({ ...x1OrderBody(std), addressId }).expect(200);
    // Step 2.
    expect((await quote(added.body.id)).body.quote).toMatchObject({ zone: { name: 'South' }, totalPaisa: '40000' });
    // Step 3.
    expect((await quote(std.C1.addressId as string)).body.quote).toMatchObject({ zone: { name: 'North' }, totalPaisa: '48000' });
    // Step 4.
    const east = await f.as(std.DA).post(`/clients/${std.C1.id}/addresses`).send({ label: 'Test East', ...std.zones.East.center }).expect(422);
    expect(east.body).toMatchObject({ code: 'PRICING_PRICE_NOT_SET', details: { zoneName: 'East' } });
    // Step 5.
    const listed = await f.as(std.DA).get(`/clients/${std.C1.id}/addresses`).expect(200);
    expect((listed.body as Array<{ id: string }>).map((a) => a.id).sort()).toEqual([std.C1.addressId, added.body.id].sort());
  });

  it('CUS-010 Ahmed Gas can never see or use Bilal Gas customers; the office only reads them, by distributorId', async () => {
    const { std, db } = f;
    const names = (body: Array<{ name: string }>) => body.map((c) => c.name).sort();
    // Step 1.
    expect(names((await f.as(std.DA).get('/clients').expect(200)).body)).toEqual(['Sana', 'Usman']);
    expect(names((await f.as(std.DA).get(`/clients?distributorId=${std.DB.id}`).expect(200)).body)).toEqual(['Sana', 'Usman']);
    // Step 2.
    for (const call of [
      f.as(std.DA).get(`/clients/${std.C3.id}/addresses`),
      f.as(std.DA).post(`/clients/${std.C3.id}/addresses`).send({ label: 'Test', ...southPin }),
    ]) {
      const res = await call.expect(404);
      expect(res.body.code).toBe('CLIENT_NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/Hina|9876543/);
    }
    expect(await db.clientAddress.count({ where: { clientId: std.C3.id } })).toBe(1);
    // Step 3.
    const hina = {
      clientId: std.C3.id,
      deliveryLocation: std.C3.location,
      deliveryLabel: 'Test',
      lines: [{ cylinderTypeId: std.sizes.kg15, fullCount: 3, expectedReturnCount: 3 }],
    };
    expect((await f.as(std.DA).post('/orders/quote').send(hina).expect(404)).body.code).toBe('CLIENT_NOT_FOUND');
    expect((await f.as(std.DA).post('/orders').set('Idempotency-Key', newKey()).send(hina).expect(404)).body.code).toBe('CLIENT_NOT_FOUND');
    // Step 4.
    const wrongAddress = { ...x1OrderBody(std), addressId: std.C3.addressId };
    expect((await f.as(std.DA).post('/orders').set('Idempotency-Key', newKey()).send(wrongAddress).expect(404)).body.code).toBe('CLIENT_ADDRESS_NOT_FOUND');
    expect(await db.order.count()).toBe(0);
    expect(await f.ledger({ entryType: 'DEBIT_ORDER' })).toEqual([]);
    // Step 5.
    expect(names((await f.as(std.SA1).get(`/clients?distributorId=${std.DA.id}`).expect(200)).body)).toEqual(['Sana', 'Usman']);
    expect(names((await f.as(std.SA1).get(`/clients?distributorId=${std.DB.id}`).expect(200)).body)).toEqual(['Hina']);
    const noFilter = await f.as(std.SA1).get('/clients').expect(400);
    expect(noFilter.body.code).toBe('VALIDATION_FAILED');
    expect(noFilter.body.details.fields).toEqual([expect.objectContaining({ path: 'distributorId', code: 'REQUIRED' })]);
    expect((await f.as(std.SA1).get(`/clients?distributorId=${randomUUID()}`).expect(200)).body).toEqual([]);
    // Step 6.
    expect((await f.as(std.SA1).post('/clients').send({ name: 'Office Test', phone: '0300 9990001', address: { label: 'Test', ...northPin } }).expect(403)).body.code).toBe(
      'PERMISSION_DENIED',
    );
    expect((await f.as(std.DR1).get('/clients').expect(403)).body.code).toBe('PERMISSION_DENIED');
  });

  it('CUS-011 only the office adds, archives and reactivates zones, and a broken shape is refused', async () => {
    const { std, db } = f;
    const cityId = std.zones.North.cityId;
    const westTest = { cityId, name: 'West Test', polygonGeoJson: box(74.0, 31.5, 74.05, 31.55) };
    const bowTie = { type: 'MultiPolygon', coordinates: [[[[74.0, 31.6], [74.05, 31.65], [74.05, 31.6], [74.0, 31.65], [74.0, 31.6]]]] };
    const zonesBefore = await db.zone.count();
    // Step 1.
    expect((await f.as(std.DA).post('/zones').send(westTest).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 2.
    for (const polygonGeoJson of [bowTie, { type: 'MultiPolygon', coordinates: [] }]) {
      const res = await f.as(std.SA1).post('/zones').send({ ...westTest, polygonGeoJson }).expect(400);
      expect(res.body).toMatchObject({ code: 'ZONE_INVALID_SHAPE', message: "This zone shape isn't valid." });
    }
    expect(await db.zone.count()).toBe(zonesBefore);
    expect(await f.audits('zone.create')).toEqual([]);
    // Step 3.
    const created = await f.as(std.SA1).post('/zones').send(westTest).expect(201);
    expect(Object.keys(created.body)).toEqual(['id']);
    const zoneId = created.body.id as string;
    expect((await db.zone.findUniqueOrThrow({ where: { id: zoneId } })).isActive).toBe(true);
    const createAudits = await f.audits('zone.create', zoneId);
    expect(createAudits).toHaveLength(1);
    expect(createAudits[0].actorUserId).toBe(std.SA1.id);
    // Step 4.
    expect((await f.as(std.SA1).delete(`/zones/${zoneId}`).expect(200)).body).toEqual({ ok: true });
    expect(await f.audits('zone.archive', zoneId)).toHaveLength(1);
    const repeat = await f.as(std.SA1).delete(`/zones/${zoneId}`).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(await f.audits('zone.archive', zoneId)).toHaveLength(1);
    const inside = { lat: 31.525, lng: 74.025 };
    const located = await f.as(std.DA).get(`/zones/locate?lat=${inside.lat}&lng=${inside.lng}`).expect(200);
    expect(located.body?.id ?? null).toBeNull();
    const listed = await f.as(std.SA1).get(`/zones/city/${cityId}?includeArchived=true`).expect(200);
    const archived = (listed.body as ZoneListRow[]).find((z) => z.id === zoneId);
    // The row carries the zone's outline and centre as GeoJSON, for the website's maps.
    expect(archived).toMatchObject({ city_id: cityId, name: 'West Test', is_active: false, polygon: westTest.polygonGeoJson });
    expect(archived?.centroid?.type).toBe('Point');
    expect(archived?.centroid?.coordinates[0]).toBeCloseTo(74.025, 6);
    expect(archived?.centroid?.coordinates[1]).toBeCloseTo(31.525, 6);
    // Step 5.
    await f.as(std.SA1).patch(`/zones/${zoneId}/reactivate`).expect(200);
    expect(await f.audits('zone.reactivate', zoneId)).toHaveLength(1);
    expect((await f.as(std.DA).get(`/zones/locate?lat=${inside.lat}&lng=${inside.lng}`).expect(200)).body.id).toBe(zoneId);
    // Step 6.
    const unknownCity = await f.as(std.SA1).post('/zones').send({ ...westTest, name: 'Nowhere Test', cityId: randomUUID() }).expect(404);
    expect(unknownCity.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'cityId' } });
    expect(await db.zone.count({ where: { name: 'Nowhere Test' } })).toBe(0);
  });

  it('CUS-012 two adds with the same mobile at the same moment create only one customer', async () => {
    const { std, db } = f;
    // Step 1.
    const [a, b] = await together(
      f.as(std.DA).post('/clients').set('Idempotency-Key', newKey()).send({ name: 'Ali', phone: '0333 7654321', address: { label: 'Home', ...northPin } }),
      f.as(std.DA).post('/clients').set('Idempotency-Key', newKey()).send({ name: 'Ali Raza', phone: '03337654321', address: { label: 'Home', ...northPin } }),
    );
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(loser.body).toMatchObject({ code: 'CLIENT_PHONE_EXISTS', details: { name: winner.body.client.name, clientId: winner.body.client.id } });
    // Step 2.
    const rows = await db.client.findMany({ where: { distributorId: std.DA.id, phone: '+923337654321' }, include: { addresses: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].addresses).toHaveLength(1);
  });
});
