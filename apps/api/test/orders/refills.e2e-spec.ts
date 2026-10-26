/**
 * Refills, Inc 1 (ADR-16, API_CONTRACT §7.11, §8.4): no money anywhere, do-it-yourself retired, one
 * size up to `refill.maxCylinders`, exact roles, the assigned driver's steps, and the office's assign
 * and complete. The office has no cancel.
 */
import type { INestApplication } from '@nestjs/common';
import { RELEASE_INCREMENT } from '../../src/modules/settings/registry';
import { NEW_SHOP_APP } from '../helpers/app-headers';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData } from '../helpers/standard-data';
import { API, OrdersFixture, newKey } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';

jest.setTimeout(300_000);

const SECRET_KEYS = ['passwordHash', 'cnic', 'cnicEncrypted', 'cnicIndex', 'codeHash', 'tokenHash'];

async function createStation(name: string, opts: { active?: boolean; pricePaisa?: bigint } = {}): Promise<string> {
  const rows = await getTestPrisma().$queryRaw<Array<{ id: string }>>`
    INSERT INTO filling_stations (id, name, address, location, price_per_cylinder_paisa, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), ${name}, 'Ferozepur Road, Lahore', ST_SetSRID(ST_MakePoint(74.33, 31.48), 4326),
            ${opts.pricePaisa ?? 0n}, ${opts.active ?? true}, now(), now())
    RETURNING id`;
  return rows[0].id;
}

describeDb('api-orders: refills', () => {
  let app: INestApplication;
  let f: OrdersFixture;
  let station: string;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
    station = await createStation('Lahore Filling Station');
  });

  afterAll(async () => {
    await app?.close();
  });

  // The shop's request comes from the Inc 3 shop app (the 0.1.0 JS gets 426 APP_RESTART_TO_UPDATE, Appendix A).
  const request = (who: Parameters<OrdersFixture['as']>[0], body: Record<string, unknown>) => f.as(who).post('/filling-orders').set(NEW_SHOP_APP).send(body);
  const refillOf = (count: number, cylinderTypeId = f.std.sizes.kg11_8) => ({ fillingStationId: station, cylinderTypeId, requestedCount: count });
  const newRefill = async (count = 2) => (await request(f.std.DA, refillOf(count)).expect(201)).body as { id: string; status: string };
  const assign = (id: string, driverId = f.std.DR1.id) => f.as(f.std.SA1).patch(`/filling-orders/${id}/assign`).send({ driverId });

  it('REF-001 a refill request takes no money and needs no balance', async () => {
    const { std, db } = f;
    const ledgerBefore = await db.ledgerEntry.count();
    // Step 1.
    const first = await f
      .as(std.DA)
      .post('/filling-orders')
      .set(NEW_SHOP_APP)
      .set('Idempotency-Key', newKey())
      .send({ ...refillOf(5), pickupStoreId: std.DB.homeStoreId })
      .expect(201);
    expect(first.body).toMatchObject({ status: 'PENDING', requestedCount: 5, stage: 'NEEDS_DRIVER', pricePerCylinderPaisa: '0', totalCostPaisa: '0' });
    const created = await f.audits('refill.create', first.body.id);
    expect(created).toHaveLength(1);
    expect(created[0].actorUserId).toBe(std.DA.userId);
    // Step 2.
    expect((await f.as(std.DA).get(`/filling-orders/${first.body.id}`).expect(200)).body.id).toBe(first.body.id);
    const row = await db.fillingOrder.findUniqueOrThrow({ where: { id: first.body.id } });
    expect([row.pricePerCylinderPaisa, row.totalCostPaisa, row.pickupStoreId]).toEqual([0n, 0n, std.DA.homeStoreId]);
    // Step 3.
    const bilal = await request(std.DB, refillOf(3, std.sizes.kg15)).expect(201);
    expect((await f.audits('refill.create', bilal.body.id))[0].actorUserId).toBe(std.DB.userId);
    // Step 4.
    expect(await f.balance(std.DA)).toBe(500_000n);
    expect(await f.balance(std.DB)).toBe(0n);
    expect(await db.ledgerEntry.count()).toBe(ledgerBefore);
    expect(await db.ledgerEntry.count({ where: { OR: [{ entryType: 'DEBIT_REFILL' }, { fillingOrderId: { not: null } }] } })).toBe(0);
    await f.expectWalletsConsistent();
  });

  it('REF-002 a do-it-yourself refill is refused with 410', async () => {
    const { std } = f;
    const refused = [
      { serviceType: 'DIY', ownStationName: 'My own station', cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 },
      { serviceType: 'DIY', fillingStationId: station, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 },
    ];
    for (const body of refused) {
      const res = await request(std.DA, body).expect(410);
      expect(res.body).toMatchObject({ code: 'REFILL_DIY_RETIRED', message: 'Do-it-yourself refills are no longer used. Request a refill instead.' });
    }
    const mine = await f.as(std.DA).get('/filling-orders/mine').expect(200);
    expect(mine.body).toEqual([]);
    expect(await f.db.ledgerEntry.count({ where: { entryType: { not: 'ADJUSTMENT' } } })).toBe(0);
  });

  it('REF-003 a refill is one size and 1 to refill.maxCylinders cylinders: 30 by default, 31 refused', async () => {
    const { std, db } = f;
    // Step 1 (no stock check: only 0 such cylinders are registered).
    await request(std.DA, refillOf(30)).expect(201);
    // Step 2.
    const tooMany = await request(std.DA, refillOf(31)).expect(400);
    expect(tooMany.body).toMatchObject({ code: 'REFILL_TOO_MANY', details: { max: 30 }, message: 'Too many cylinders. A refill can have at most 30.' });
    // Step 3.
    for (const count of [0, -1]) {
      const res = await request(std.DA, refillOf(count)).expect(400);
      expect(res.body).toMatchObject({ code: 'REFILL_INVALID_COUNT', message: 'Check the number of cylinders.' });
    }
    // Step 4.
    const twoSizes = await request(std.DA, {
      fillingStationId: station,
      lines: [
        { cylinderTypeId: std.sizes.kg11_8, count: 2 },
        { cylinderTypeId: std.sizes.kg15, count: 2 },
      ],
    }).expect(400);
    expect(twoSizes.body.code).toBe('VALIDATION_FAILED');
    expect(await db.fillingOrder.count()).toBe(1);
    // Step 5.
    await f.as(std.SA1).patch('/settings/refill.maxCylinders').send({ value: 10, reason: 'Pilot test of a lower limit' }).expect(200);
    const audit = (await f.audits('setting.update')).at(-1);
    expect(audit?.diff).toMatchObject({ key: 'refill.maxCylinders', from: 30, to: 10 });
    expect((await http(app).get(`${API}/app/config`).expect(200)).body.refill.maxCylinders).toBe(10);
    // Step 6.
    expect((await request(std.DA, refillOf(11)).expect(400)).body.message).toBe('Too many cylinders. A refill can have at most 10.');
    await request(std.DA, refillOf(10)).expect(201);
    // Step 7.
    const invalid = await f.as(std.SA1).patch('/settings/refill.maxCylinders').send({ value: 31, reason: 'Back to default' }).expect(400);
    expect(invalid.body).toMatchObject({ code: 'SETTING_INVALID_VALUE', message: "This value isn't allowed here." });
    await f.as(std.SA1).patch('/settings/refill.maxCylinders').send({ value: 30, reason: 'Back to default' }).expect(200);
  });

  it('REF-004 refill money stays off: station prices read as 0 and a sent price is ignored', async () => {
    const { std, db } = f;
    await db.$executeRaw`UPDATE filling_stations SET price_per_cylinder_paisa = 50000 WHERE id = ${station}::uuid`;
    // Step 1.
    const settings = await f.as(std.SA1).get('/settings').expect(200);
    const rows = (Array.isArray(settings.body) ? settings.body : settings.body.items) as Array<{ key: string; value: unknown; editable: boolean }>;
    expect(rows.find((row) => row.key === 'refill.deliveryCost')).toMatchObject({ value: { enabled: false, basePaisa: 0, perCylinderPaisa: 0 }, editable: false });
    // Step 2.
    const locked = await f.as(std.SA1).patch('/settings/refill.deliveryCost').send({ value: { enabled: true, basePaisa: 10000, perCylinderPaisa: 0 }, reason: 'Try to switch on' }).expect(403);
    expect(locked.body.code).toBe('SETTING_NOT_EDITABLE');
    expect(await f.audits('setting.update')).toEqual([]);
    // Step 3.
    const config = await http(app).get(`${API}/app/config`).expect(200);
    expect(JSON.stringify(config.body)).not.toContain('deliveryCost');
    expect(config.body.refill.maxCylinders).toBe(30);
    // Step 4.
    const list = await f.as(std.DA).get('/filling-stations').expect(200);
    const listed = (list.body as Array<{ id: string; pricePerCylinderPaisa: string; price_per_cylinder_paisa: string }>).find((s) => s.id === station);
    expect([listed?.pricePerCylinderPaisa, listed?.price_per_cylinder_paisa]).toEqual(['0', '0']);
    expect(JSON.stringify(list.body)).not.toContain('50000');
    // Steps 5 and 6.
    const updated = await f.as(std.SA1).patch(`/filling-stations/${station}`).send({ name: 'Lahore Filling Station', pricePerCylinderPaisa: 75000 }).expect(200);
    expect(updated.body.pricePerCylinderPaisa).toBe('0');
    expect((await f.as(std.SA1).get(`/filling-stations/${station}`).expect(200)).body.pricePerCylinderPaisa).toBe('0');
    const stored = await db.$queryRaw<Array<{ price: bigint }>>`SELECT price_per_cylinder_paisa AS price FROM filling_stations WHERE id = ${station}::uuid`;
    expect(stored[0].price).toBe(50_000n);
  });

  it('REF-005 the office and drivers cannot request or cancel a refill (403)', async () => {
    const { std, db } = f;
    const R = await newRefill(2);
    // Steps 1 and 2.
    for (const who of [std.SA1, std.DR1]) {
      const res = await request(who, { ...refillOf(2), distributorId: std.DA.id }).expect(403);
      expect(res.body).toMatchObject({ code: 'PERMISSION_DENIED', message: "Your account can't do this." });
    }
    // Steps 3 and 4.
    for (const [who, reason] of [
      [std.SA1, 'Office cancel attempt'],
      [std.DR1, 'Driver cancel attempt'],
    ] as const) {
      expect((await f.as(who).patch(`/filling-orders/${R.id}/cancel`).send({ reason }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    // Step 5.
    expect(((await f.as(std.DA).get('/filling-orders/mine').expect(200)).body as unknown[]).length).toBe(1);
    expect((await f.as(std.DA).get(`/filling-orders/${R.id}`).expect(200)).body.status).toBe('PENDING');
    expect(await db.auditLog.count({ where: { action: 'refill.cancel' } })).toBe(0);
  });

  it('REF-006 another shop and an unassigned driver get 404 for Ahmed Gas refill', async () => {
    const { std } = f;
    const R = await newRefill(2);
    await assign(R.id).expect(200);
    // Steps 1 and 2.
    const notFound = await f.as(std.DB).get(`/filling-orders/${R.id}`).expect(404);
    expect(notFound.body).toMatchObject({ code: 'NOT_FOUND', message: "We couldn't find this. It may have been removed." });
    expect((await f.as(std.DB).patch(`/filling-orders/${R.id}/cancel`).send({ reason: 'Not mine' }).expect(404)).body.code).toBe('NOT_FOUND');
    // Step 3.
    expect(((await f.as(std.DB).get('/filling-orders/mine').expect(200)).body as Array<{ id: string }>).map((r) => r.id)).not.toContain(R.id);
    // Step 4.
    expect((await f.as(std.DR2).get(`/filling-orders/${R.id}`).expect(404)).body.code).toBe('NOT_FOUND');
    expect(((await f.as(std.DR2).get('/filling-orders/driver/mine').expect(200)).body as Array<{ id: string }>).map((r) => r.id)).not.toContain(R.id);
    // Step 5.
    expect((await f.as(std.DR2).patch(`/filling-orders/${R.id}/picked-empties`).send({ emptyCount: 2 }).expect(404)).body.code).toBe('NOT_FOUND');
    const row = await f.db.fillingOrder.findUniqueOrThrow({ where: { id: R.id } });
    expect([row.status, row.pickedUpEmptyCount]).toEqual(['ASSIGNED', null]);
    // Step 6.
    const bodies: unknown[] = [];
    for (const who of [std.DR1, std.SA1]) {
      const res = await f.as(who).get(`/filling-orders/${R.id}`).expect(200);
      expect(res.body.assignedDriver).toEqual({ id: std.DR1.id, name: 'Kashif', phone: expect.any(String) });
      bodies.push(res.body);
    }
    // Step 7.
    const text = JSON.stringify(bodies);
    for (const key of SECRET_KEYS) expect({ key, found: text.includes(`"${key}"`) }).toEqual({ key, found: false });
  });

  it('REF-007 the owner cancels a refill before pickup, with a reason, once', async () => {
    const { std, db } = f;
    const R1 = await newRefill(2);
    const R2 = await newRefill(1);
    await assign(R2.id).expect(200);
    const ledgerBefore = await db.ledgerEntry.count();
    const cancel = (id: string, body: Record<string, unknown>) => f.as(std.DA).patch(`/filling-orders/${id}/cancel`).send(body);
    // Step 1.
    expect((await cancel(R1.id, {}).expect(400)).body.code).toBe('VALIDATION_FAILED');
    expect((await db.fillingOrder.findUniqueOrThrow({ where: { id: R1.id } })).status).toBe('PENDING');
    // Step 2.
    expect((await cancel(R1.id, { reason: 'Empties not ready' }).expect(200)).body.status).toBe('CANCELLED');
    // Step 3.
    const again = await cancel(R1.id, { reason: 'Empties not ready' }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    // Step 4.
    expect((await cancel(R2.id, { reason: 'Station closed today' }).expect(200)).body.status).toBe('CANCELLED');
    // Step 5.
    for (const [refill, reason] of [
      [R1, 'Empties not ready'],
      [R2, 'Station closed today'],
    ] as const) {
      const rows = await f.audits('refill.cancel', refill.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorUserId: std.DA.userId, reason });
    }
    // Step 6.
    expect(await f.balance()).toBe(500_000n);
    expect(await db.ledgerEntry.count()).toBe(ledgerBefore);
  });

  it('REF-008 the Inc 1 count steps run to the office complete with no money', async () => {
    const { std, db } = f;
    const R = await newRefill(3);
    await assign(R.id).expect(200);
    const ledgerBefore = await db.ledgerEntry.count();
    const step = (path: string, body: Record<string, unknown> = {}) => f.as(std.DR1).patch(`/filling-orders/${R.id}/${path}`).send(body);
    if (RELEASE_INCREMENT >= 3) {
      // From Inc 3 every refill step is a scan and the store's last receive completes a refill (API_CONTRACT
      // §10.1 "Retired"; REF-024): the count steps and the office's complete answer 410 and change nothing.
      for (const [path, body] of [
        ['picked-empties', { emptyCount: 3 }],
        ['at-station', {}],
        ['filled', { filledCount: 3 }],
        ['returned', {}],
      ] as const) {
        expect({ path, code: (await step(path, body).expect(410)).body.code }).toEqual({ path, code: 'REFILL_USE_SCANS' });
      }
      expect((await f.as(std.SA1).patch(`/filling-orders/${R.id}/complete`).expect(410)).body.code).toBe('REFILL_AUTO_COMPLETES');
      const row = await db.fillingOrder.findUniqueOrThrow({ where: { id: R.id } });
      expect([row.status, row.pickedUpEmptyCount, row.filledCount, row.completedAt]).toEqual(['ASSIGNED', null, null, null]);
      // The owner can still cancel it: nothing was picked up.
      expect((await f.as(std.DA).patch(`/filling-orders/${R.id}/cancel`).send({ reason: 'Not needed now' }).expect(200)).body.status).toBe('CANCELLED');
      expect(await f.audits('refill.complete', R.id)).toEqual([]);
      expect(await db.ledgerEntry.count()).toBe(ledgerBefore);
      expect(await f.balance()).toBe(500_000n);
      await f.expectWalletsConsistent();
      return;
    }
    // Step 1.
    for (const emptyCount of [0, 4]) {
      const res = await step('picked-empties', { emptyCount }).expect(400);
      expect(res.body).toMatchObject({ code: 'REFILL_INVALID_COUNT', message: 'Check the number of cylinders.' });
    }
    // Step 2.
    expect((await step('picked-empties', { emptyCount: 3 }).expect(200)).body).toMatchObject({ status: 'EMPTIES_PICKED', stage: 'PICKED_UP', counts: { picked: 3 } });
    // Step 3.
    const late = await f.as(std.DA).patch(`/filling-orders/${R.id}/cancel`).send({ reason: 'Too late' }).expect(409);
    expect(late.body).toMatchObject({ code: 'REFILL_NOT_CANCELLABLE', message: "This refill can't be cancelled after pickup." });
    // Step 4.
    await step('at-station').expect(200);
    expect((await step('filled', { filledCount: 4 }).expect(400)).body.code).toBe('REFILL_INVALID_COUNT');
    await step('filled', { filledCount: 3 }).expect(200);
    expect((await step('returned').expect(200)).body).toMatchObject({ status: 'RETURNED', stage: 'BACK_AT_STORE', counts: { received: 3 } });
    // Step 5.
    const done = await f.as(std.SA1).patch(`/filling-orders/${R.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', stage: 'DONE' });
    const again = await f.as(std.SA1).patch(`/filling-orders/${R.id}/complete`).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    const audits = await f.audits('refill.complete', R.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(std.SA1.id);
    // Step 6.
    expect(await db.ledgerEntry.count()).toBe(ledgerBefore);
    expect(await f.balance()).toBe(500_000n);
    await f.expectWalletsConsistent();
    // Completing from any other step is refused.
    const other = await newRefill(1);
    expect((await f.as(std.SA1).patch(`/filling-orders/${other.id}/complete`).expect(409)).body).toMatchObject({ code: 'REFILL_WRONG_STEP', details: { currentStatus: 'PENDING' } });
  });

  it('REF-011 only the office assigns a refill, only while it waits, and only to an active driver with a van', async () => {
    const { std, db } = f;
    const R1 = await newRefill(2);
    const R2 = await newRefill(2);
    await f.as(std.DA).patch(`/filling-orders/${R2.id}/cancel`).send({ reason: 'Not needed now' }).expect(200);
    await db.driver.update({ where: { id: std.DR2.id }, data: { currentVehicleId: null } });
    // Step 1.
    for (const who of [std.DA, std.DR1]) {
      expect((await f.as(who).patch(`/filling-orders/${R1.id}/assign`).send({ driverId: std.DR1.id }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    // Step 2.
    expect((await assign(R2.id).expect(409)).body).toMatchObject({ code: 'REFILL_WRONG_STEP', details: { currentStatus: 'CANCELLED' } });
    // Step 3.
    const noVan = await assign(R1.id, std.DR2.id).expect(409);
    expect(noVan.body).toMatchObject({ code: 'ASSIGN_DRIVER_NO_VEHICLE', message: 'Imran has no van. Give them a van first.' });
    expect((await db.fillingOrder.findUniqueOrThrow({ where: { id: R1.id } })).status).toBe('PENDING');
    // Step 4.
    const assigned = await assign(R1.id).expect(200);
    expect(assigned.body).toMatchObject({ status: 'ASSIGNED', assignedDriver: { id: std.DR1.id, name: 'Kashif' }, assignedVehicle: { plateNo: 'LEA-101' } });
    const repeat = await assign(R1.id).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    const audits = await f.audits('refill.assign', R1.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(std.SA1.id);
    // Step 5.
    expect(((await f.as(std.DR1).get('/filling-orders/driver/mine').expect(200)).body as Array<{ id: string }>).map((r) => r.id)).toContain(R1.id);
    expect((await f.as(std.DR2).get(`/filling-orders/${R1.id}`).expect(404)).body.code).toBe('NOT_FOUND');
    await db.driver.update({ where: { id: std.DR2.id }, data: { currentVehicleId: std.DR2.vehicleId } });
  });

  it('REF-012 a refill to a station that is not taking refills is refused', async () => {
    const { std } = f;
    const closed = await createStation('Closed Station', { active: false });
    // Step 1.
    const refused = await f.as(std.DA).post('/filling-orders').set(NEW_SHOP_APP).set('Idempotency-Key', newKey()).send({ ...refillOf(2), fillingStationId: closed }).expect(409);
    expect(refused.body).toMatchObject({ code: 'REFILL_STATION_INACTIVE', message: "This station isn't taking refills." });
    // Step 2.
    const ok = await f.as(std.DA).post('/filling-orders').set(NEW_SHOP_APP).set('Idempotency-Key', newKey()).send(refillOf(2)).expect(201);
    // Step 3.
    expect(((await f.as(std.DA).get('/filling-orders/mine').expect(200)).body as Array<{ id: string }>).map((r) => r.id)).toEqual([ok.body.id]);
  });
});
