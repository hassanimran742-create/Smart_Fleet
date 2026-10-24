/**
 * [Inc 3] Refill requests (API_CONTRACT §10.1 `POST /filling-orders`, §4.2, §1.1): numbered from each shop's
 * own counter (AG-R001…), and a retried request with the same Idempotency-Key returns the first refill. No
 * money: no balance check, no ledger row, both prices "0".
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { resetDb } from '../../helpers/db';
import { buildRefillWorld, messageOf, type RefillWorld } from './support/refill-world';

jest.setTimeout(180_000);

describeDb('inc3 refills: requests and their numbers', () => {
  let app: INestApplication;
  let w: RefillWorld;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildRefillWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const body = () => ({ fillingStationId: w.station.id, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 2 });

  it("REF-013 Refill numbers come from the shop's own counter, and a retried request isn't doubled", async () => {
    const { std, db, refills } = w;
    const ledger = await w.ledgerCount();
    expect((await db.distributor.findMany({ where: { id: { in: [std.DA.id, std.DB.id] } }, select: { nextRefillNo: true } })).map((d) => d.nextRefillNo)).toEqual([1, 1]);

    // Step 1.
    const K1 = randomUUID();
    const first = await refills.create(std.DA, body(), K1).expect(201);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(first.body).toMatchObject({
      shortCode: 'AG-R001',
      refillNo: 1,
      status: 'PENDING',
      stage: 'NEEDS_DRIVER',
      counts: { requested: 2, picked: 0, filled: 0, received: 0 },
      sizeLabel: '11.8 kg',
      pricePerCylinderPaisa: '0',
      totalCostPaisa: '0',
      pickedUpAt: null,
      cancelledAt: null,
      cylinders: [],
      allowedActions: ['CANCEL'],
    });
    const stored = await db.fillingOrder.findUniqueOrThrow({ where: { id: first.body.id } });
    expect([stored.refillNo, stored.clientRequestId]).toEqual([1, K1]);

    // Step 2.
    const again = await refills.create(std.DA, body(), K1).expect(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body).toMatchObject({ id: first.body.id, shortCode: 'AG-R001' });
    expect(await db.fillingOrder.count()).toBe(1);
    // The key is compared lower-cased (§4.2).
    const upper = await refills.create(std.DA, body(), K1.toUpperCase()).expect(200);
    expect([upper.headers['idempotent-replay'], upper.body.id]).toEqual(['true', first.body.id]);

    // Step 3.
    const conflict = await refills.create(std.DA, { ...body(), requestedCount: 3 }, K1).expect(409);
    expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', message: 'This was already sent with different details. Start again.' });
    expect(await db.fillingOrder.count()).toBe(1);

    // Step 4.
    const [a, b] = await Promise.all([refills.create(std.DA, body(), randomUUID()), refills.create(std.DA, body(), randomUUID())]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.shortCode, b.body.shortCode].sort()).toEqual(['AG-R002', 'AG-R003']);

    // Step 5.
    const bilal = await refills.create(std.DB, body(), randomUUID()).expect(201);
    expect(bilal.body).toMatchObject({ shortCode: 'BG-R001', refillNo: 1 });

    // Step 6.
    const mine = await refills.mine(std.DA).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);
    const codes = (mine.body as Array<{ shortCode: string }>).map((r) => r.shortCode);
    expect([...codes].sort()).toEqual(['AG-R001', 'AG-R002', 'AG-R003']);
    // Newest first: the two made at the same moment, then the first one.
    expect(codes[2]).toBe('AG-R001');
    // Lists leave the cylinder list out; the counters moved on with no gap.
    expect((mine.body as Array<Record<string, unknown>>).every((r) => !('cylinders' in r))).toBe(true);
    const counters = await db.distributor.findMany({ where: { id: { in: [std.DA.id, std.DB.id] } }, select: { id: true, nextRefillNo: true } });
    expect(Object.fromEntries(counters.map((d) => [d.id, d.nextRefillNo]))).toEqual({ [std.DA.id]: 4, [std.DB.id]: 2 });
    expect(await db.auditLog.count({ where: { action: 'refill.create' } })).toBe(4);
    // No money: no ledger row, the balances unchanged.
    expect(await w.ledgerCount()).toBe(ledger);
    expect(await w.balance()).toBe(500_000n);
    await w.walletClean();
  });

  it('REF-013 Two creates with the same key at the same moment make one refill, and the other gets its replay', async () => {
    const { std, db, refills } = w;
    const K = randomUUID();
    const [a, b] = await Promise.all([refills.create(std.DA, body(), K), refills.create(std.DA, body(), K)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    const replay = a.status === 200 ? a : b;
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(await db.fillingOrder.count()).toBe(1);
    expect(a.body.shortCode).toBe('AG-R001');
    // The refused twin rolled its number back: the next request is AG-R002.
    expect((await refills.create(std.DA, body(), randomUUID()).expect(201)).body.shortCode).toBe('AG-R002');
    // Another shop may use the same key: keys are per shop.
    expect((await refills.create(std.DB, body(), K).expect(201)).body.shortCode).toBe('BG-R001');
  });

  it('REF-013 A retry gets the first refill even when the request would now be refused, and a refused request keeps its key free', async () => {
    const { std, db, refills } = w;
    const K = randomUUID();
    const first = await refills.create(std.DA, body(), K).expect(201);
    // The station stops taking refills: a new request is refused, but the retry is still the first refill.
    await db.fillingStation.update({ where: { id: w.station.id }, data: { isActive: false } });
    const retry = await refills.create(std.DA, body(), K).expect(200);
    expect([retry.headers['idempotent-replay'], retry.body.id]).toEqual(['true', first.body.id]);
    const K2 = randomUUID();
    const refused = await refills.create(std.DA, body(), K2).expect(409);
    expect(refused.body).toMatchObject({ code: 'REFILL_STATION_INACTIVE', message: messageOf('REFILL_STATION_INACTIVE') });
    // Nothing was stored with K2, so it can be sent again once the station is back.
    await db.fillingStation.update({ where: { id: w.station.id }, data: { isActive: true } });
    expect((await refills.create(std.DA, body(), K2).expect(201)).body.shortCode).toBe('AG-R002');
    // A key that isn't a UUID is refused on the header.
    const bad = await refills.create(std.DA, body(), 'not-a-uuid').expect(400);
    expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: [{ path: 'Idempotency-Key', code: 'INVALID_ID' }] } });
    // An installed app sends no key: still one refill per request, numbered.
    const keyless = await refills.create(std.DA, body()).expect(201);
    expect(keyless.body.shortCode).toBe('AG-R003');
    expect((await db.fillingOrder.findUniqueOrThrow({ where: { id: keyless.body.id } })).clientRequestId).toBeNull();
  });
});
