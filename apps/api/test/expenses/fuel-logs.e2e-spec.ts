/**
 * EXP-018: driver fuel logging is off by default, the fuel-log reads are office only, and the office
 * totals count fuel logs beside Petrol, never inside it, whatever the switch says (ADR-04, ADR-14;
 * API_CONTRACT §3.4, §6, §7.2 "/fuel-refills/*", §7.12 fuelLogs).
 *
 * The summary half is the expenses module's; the driver routes' switch and the office-only, safe-select
 * reads are fuel-refills.controller.ts's.
 */
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authHeader } from '../helpers/auth';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import type { StandardData } from '../helpers/standard-data';
import { BOOT_TIMEOUT_MS, createExpensesApp, expensesApi, freshStandardData, OCT_22, typeIds } from './expense-kit';

const SECRET_KEYS = ['passwordHash', 'cnic', 'cnicEncrypted', 'cnicIndex', 'codeHash', 'tokenHash', 'tokenVersion'];

/** Every key name anywhere in a JSON value. */
function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysIn(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key);
      keysIn(inner, out);
    }
  }
  return out;
}

describeDb('expenses: driver fuel logs', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    ({ app } = await createExpensesApp());
  }, BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    std = await freshStandardData(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const db = () => getTestPrisma();
  const lea101 = () => std.DR1.vehicleId as string;

  /** The old fuel log of the case: LEA-101, Kashif, Rs 1,500, this morning. */
  const oldLog = () =>
    db().fuelRefill.create({
      data: {
        vehicleId: lea101(),
        driverId: std.DR1.id,
        litres: new Prisma.Decimal(5),
        costPaisa: 150000n,
        odometerKm: 1000,
        refillAt: new Date('2026-10-22T04:00:00Z'),
      },
    });

  const setSwitch = (value: boolean, reason: string) =>
    http(app).patch('/api/v1/settings/features.fuelRefills').set(authHeader(std.SA1.actor)).send({ value, reason });

  it('EXP-018 the office summary counts driver fuel logs under fuelLogs, never inside Petrol, whatever features.fuelRefills says', async () => {
    // Step 1: off by default.
    const config = await http(app).get('/api/v1/app/config').expect(200);
    expect(config.body.features.fuelRefills).toBe(false);

    await oldLog();
    const types = await typeIds();
    await expensesApi(app)
      .createExpense(std.SA1.actor, { expenseDate: OCT_22, amountPaisa: '250000', typeId: types.PETROL, description: 'Fuel' })
      .expect(201);

    const expected = {
      totalPaisa: '250000',
      count: 1,
      byType: [{ typeId: types.PETROL, code: 'PETROL', name: 'Petrol', totalPaisa: '250000', count: 1 }],
      fuelLogs: { totalPaisa: '150000', count: 1, byMonth: [{ month: '2026-10', totalPaisa: '150000', count: 1 }] },
    };
    const off = await expensesApi(app).summary(std.SA1.actor).expect(200);
    expect(off.body).toMatchObject(expected);

    // The switch gates only the drivers' own routes: the office totals read the same with it on.
    await setSwitch(true, 'Fuel log test').expect(200);
    const on = await expensesApi(app).summary(std.SA1.actor).expect(200);
    expect(on.body).toMatchObject(expected);
    await setSwitch(false, 'Fuel log test over').expect(200);
  });

  it('EXP-018 driver fuel logging is off by default, and the fuel-log reads are office only', async () => {
    const old = await oldLog();
    const driverBody = { vehicleId: lea101(), litres: 12.5, costPaisa: 120000, odometerKm: 1100 };

    // Step 1.
    const config = await http(app).get('/api/v1/app/config').expect(200);
    expect(config.body.features.fuelRefills).toBe(false);

    // Step 2.
    const refused = await http(app).post('/api/v1/fuel-refills').set(authHeader(std.DR1.actor)).send(driverBody).expect(403);
    expect(refused.body).toMatchObject({ code: 'FEATURE_DISABLED', message: "This isn't available yet." });
    expect(refused.headers['x-feature-disabled']).toBe('fuelRefills');
    const mine = await http(app).get('/api/v1/fuel-refills/mine').set(authHeader(std.DR1.actor)).expect(200);
    expect(mine.body).toEqual([]);
    expect(mine.headers['x-feature-disabled']).toBe('fuelRefills');
    expect(await db().fuelRefill.count()).toBe(1);

    // Step 3.
    const reads = [`/api/v1/fuel-refills/vehicle/${lea101()}`, `/api/v1/fuel-refills/driver/${std.DR1.id}`];
    for (const person of [std.DA, std.DR1]) {
      for (const url of reads) {
        const res = await http(app).get(url).set(authHeader(person.actor)).expect(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
      }
    }

    // Step 4: the office reads answer whatever the switch says, with safe fields only.
    for (const url of reads) {
      const res = await http(app).get(url).set(authHeader(std.SA1.actor)).expect(200);
      expect(res.body.map((log: { id: string }) => log.id)).toEqual([old.id]);
      const keys = keysIn(res.body);
      for (const secret of SECRET_KEYS) expect(keys.has(secret)).toBe(false);
      // Not the driver's whole user row (safe selects, API_CONTRACT §7.2).
      const driver = res.body[0].driver as { user?: Record<string, unknown> } | undefined;
      for (const column of ['role', 'status', 'createdAt', 'updatedAt']) expect(driver?.user ?? {}).not.toHaveProperty(column);
    }

    // Step 5.
    await setSwitch(true, 'Fuel log test').expect(200);
    const logged = await http(app).post('/api/v1/fuel-refills').set(authHeader(std.DR1.actor)).send(driverBody).expect(201);
    const summary = await expensesApi(app).summary(std.SA1.actor).expect(200);
    expect(summary.body.fuelLogs).toMatchObject({ totalPaisa: '270000', count: 2 });
    expect(summary.body.byType.find((t: { code: string }) => t.code === 'PETROL')).toBeUndefined();
    expect(await db().fuelRefill.findUniqueOrThrow({ where: { id: logged.body.id } })).toMatchObject({ driverId: std.DR1.id });
    await setSwitch(false, 'Fuel log test over').expect(200);
    const again = await http(app)
      .post('/api/v1/fuel-refills')
      .set(authHeader(std.DR1.actor))
      .send({ ...driverBody, odometerKm: 1200 })
      .expect(403);
    expect(again.body.code).toBe('FEATURE_DISABLED');
    const settingRows = await db().auditLog.findMany({ where: { action: 'setting.update' } });
    expect(settingRows).toHaveLength(2);
  });
});
