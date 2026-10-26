/**
 * Switched-off modules (ADR-03, ADR-04, API_CONTRACT §3.4, §7.2): SEC-020, and the fuel-log switch
 * that gates only the drivers' own routes (G13-03).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';
import { http, type TestResponse } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

const ANY_ID = '11111111-2222-4333-8444-555555555555';

describeDb('switched-off modules', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  function expectOff(res: TestResponse, name: string, kind: 'write' | 'list'): void {
    if (kind === 'write') {
      expect({ status: res.status, code: res.body.code, message: res.body.message }).toEqual({
        status: 403,
        code: 'FEATURE_DISABLED',
        message: "This isn't available yet.",
      });
    } else {
      expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [] });
    }
    expect(res.headers['x-feature-disabled']).toBe(name);
  }

  beforeAll(async () => {
    app = await createTestApp();
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData({ cylinders: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SEC-020 switched-off modules refuse writes and return empty lists, and a switch can be turned on and off again', async () => {
    const office = authHeader(std.SA1.actor);
    const shop = authHeader(std.DA.actor);
    const driver = authHeader(std.DR1.actor);
    const cylinder = await db().cylinder.findFirstOrThrow({ where: { distributorId: std.DA.id } });
    // Step 1.
    expectOff(await http(app).get('/api/v1/transfers/mine').set(driver), 'transfers', 'list');
    expectOff(
      await http(app).post('/api/v1/transfers').set(office).send({ fromStoreId: std.DA.homeStoreId, toStoreId: std.DB.homeStoreId, cylinderIds: [cylinder.id] }),
      'transfers',
      'write',
    );
    expectOff(await http(app).post(`/api/v1/transfers/${ANY_ID}/scan`).set(office).send({ qrCode: cylinder.qrCode, phase: 'PICKUP' }), 'transfers', 'write');
    // Step 2.
    expectOff(await http(app).get('/api/v1/accessories').set(office), 'accessories', 'list');
    expectOff(await http(app).post('/api/v1/accessories').set(office).send({ code: 'PIPE', name: 'Pipe', category: 'PIPE', unit: 'm' }), 'accessories', 'write');
    // Step 3.
    expectOff(await http(app).post('/api/v1/support').set(shop).send({ subject: 'Help', body: 'Module switch test message' }), 'support', 'write');
    expectOff(await http(app).get('/api/v1/support').set(shop), 'support', 'list');
    // Step 4.
    expectOff(await http(app).get('/api/v1/client-portal/orders').set(office), 'clientApp', 'list');
    expectOff(await http(app).post(`/api/v1/client-portal/orders/${ANY_ID}/confirm-delivery`).set(office), 'clientApp', 'write');
    // Nothing was created and no cylinder moved.
    expect({
      transfers: await db().transfer.count(),
      accessories: await db().accessory.count(),
      tickets: await db().supportTicket.count(),
    }).toEqual({ transfers: 0, accessories: 0, tickets: 0 });
    expect(await db().cylinder.findUniqueOrThrow({ where: { id: cylinder.id } })).toMatchObject({
      custodyType: 'STORE',
      custodyId: std.DA.homeStoreId,
    });
    expect(await db().cylinderEvent.count()).toBe(0);

    // Step 5: switched on, the ticket is created; switched off again, refused.
    const setSupport = (value: boolean, reason: string) =>
      http(app).patch('/api/v1/settings/features.support').set(office).send({ value, reason }).expect(200);
    await setSupport(true, 'Module switch test');
    const ticket = await http(app).post('/api/v1/support').set(shop).send({ subject: 'Help', body: 'Module switch test message' }).expect(201);
    expect(ticket.body).toMatchObject({ reporterUserId: std.DA.userId, subject: 'Help' });
    expect((await http(app).get('/api/v1/app/config').expect(200)).body.features.support).toBe(true);
    const mine = await http(app).get('/api/v1/support').set(shop).expect(200);
    expect((mine.body as Array<{ id: string }>).map((t) => t.id)).toEqual([ticket.body.id]);
    // Another user sees only their own tickets.
    expect((await http(app).get('/api/v1/support').set(authHeader(std.DB.actor)).expect(200)).body).toEqual([]);
    await setSupport(false, 'Module switch test over');
    expectOff(await http(app).post('/api/v1/support').set(shop).send({ subject: 'Help', body: 'Module switch test message' }), 'support', 'write');
    expect(await db().auditLog.count({ where: { action: 'setting.update' } })).toBe(2);
  });

  it('SEC-020 driver fuel logs: the switch gates only the drivers\' own routes; the office always reads them', async () => {
    const office = authHeader(std.SA1.actor);
    const driver = authHeader(std.DR1.actor);
    const shop = authHeader(std.DA.actor);
    const body = { vehicleId: std.DR1.vehicleId, litres: 20.5, costPaisa: 650000, odometerKm: 1200, fuelStation: 'PSO Canal' };
    expectOff(await http(app).post('/api/v1/fuel-refills').set(driver).send(body), 'fuelRefills', 'write');
    expectOff(await http(app).get('/api/v1/fuel-refills/mine').set(driver), 'fuelRefills', 'list');
    // The office reads older logs whatever the switch; nobody else may.
    await db().fuelRefill.create({
      data: { vehicleId: std.DR1.vehicleId as string, driverId: std.DR1.id, litres: 10, costPaisa: 300000n, odometerKm: 1000 },
    });
    for (const url of ['/api/v1/fuel-refills', `/api/v1/fuel-refills/vehicle/${std.DR1.vehicleId}`, `/api/v1/fuel-refills/driver/${std.DR1.id}`]) {
      const res = await http(app).get(url).set(office).expect(200);
      expect({ url, count: (res.body as unknown[]).length }).toEqual({ url, count: 1 });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|cnic/);
      for (const as of [driver, shop]) expect((await http(app).get(url).set(as).expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    // Switched on, the driver's own routes work, with the driver from the token.
    await http(app).patch('/api/v1/settings/features.fuelRefills').set(office).send({ value: true, reason: 'Fuel log switch test' }).expect(200);
    const created = await http(app).post('/api/v1/fuel-refills').set(driver).send({ ...body, driverId: std.DR2.id }).expect(201);
    expect(created.body).toMatchObject({ driverId: std.DR1.id, vehicleId: std.DR1.vehicleId });
    expect((await http(app).get('/api/v1/fuel-refills/mine').set(driver).expect(200)).body).toHaveLength(2);
    // The odometer can't go backwards; the office can't log fuel as a driver.
    const backwards = await http(app).post('/api/v1/fuel-refills').set(driver).send({ ...body, odometerKm: 900 }).expect(400);
    expect(backwards.body.details.fields).toEqual([expect.objectContaining({ path: 'odometerKm', code: 'TOO_SMALL' })]);
    expect((await http(app).post('/api/v1/fuel-refills').set(office).send(body).expect(403)).body.code).toBe('PERMISSION_DENIED');
  });
});
