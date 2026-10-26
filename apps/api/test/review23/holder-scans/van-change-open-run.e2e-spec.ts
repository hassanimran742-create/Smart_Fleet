/**
 * [review23 holder-scans] A van change while the driver has an open run (ADR-13 "one holder: the store,
 * the van (the driver) or the customer"; API_CONTRACT §9.5 `PATCH /drivers/:id/vehicle`).
 *
 * The guard only refuses a change while either van HOLDS cylinders. A PLANNED trip (or an ASSIGNED refill)
 * keeps the van it was made with (`trips.vehicle_id`, `filling_orders.assigned_vehicle_id`), and every later
 * scan of that run puts cylinders on that old van, which may by then be another driver's. The holder record
 * then names the wrong van: the driver carrying the cylinder sees an empty van, another driver's van shows it,
 * and that other driver's run can't finish because of it.
 *
 * Either fix passes these tests: refuse the van change while the driver has an open run on the old van, or
 * move the open runs to the new van.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { refillCalls } from '../../helpers/inc3-calls';
import { createRefill, createStation } from '../../helpers/refills';
import { setCylinderState } from '../../helpers/runs';
import { buildWorld, X1, Y1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

describeDb('review23 holder-scans: van change while a run is open', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function newVan(plateNo: string): Promise<string> {
    const van = await w.db.vehicle.create({
      data: { plateNo, capacityUnits: 40, homeZoneId: w.std.zones.North.id, status: 'ACTIVE' },
      select: { id: true },
    });
    return van.id;
  }

  async function giveVan(driverId: string, vehicleId: string) {
    return w.as(w.std.SA1).patch(`/drivers/${driverId}/vehicle`).send({ vehicleId });
  }

  it('a load after the office moved Kashif to another van lands on his old van (now Imran\'s)', async () => {
    const { std, scans } = w;
    const lea101 = std.DR1.vehicleId as string;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1); // PLANNED on LEA-101, nothing loaded

    // LEA-101 breaks down before loading: the office gives Kashif LEC-303, and later LEA-101 to Imran.
    const lec303 = await newVan('LEC-303');
    const kashifMoved = await giveVan(std.DR1.id, lec303);
    if (kashifMoved.status === 409) return; // fixed by refusing the change while a run is open
    expect(kashifMoved.status).toBe(200);
    expect((await giveVan(std.DR2.id, lea101)).status).toBe(200);

    // Kashif loads AG-C0001 into the van he is driving, LEC-303.
    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    const kashif = await scans.driverHome(std.DR1).expect(200);
    const imran = await scans.driverHome(std.DR2).expect(200);
    const holder = await w.holder(1);

    // One holder, and it must be the van of the driver who scanned it IN.
    expect({ plate: kashif.body.vehicle.plateNo, vanTotal: kashif.body.van.total }).toEqual({ plate: 'LEC-303', vanTotal: 1 });
    expect({ plate: imran.body.vehicle.plateNo, vanTotal: imran.body.van.total }).toEqual({ plate: 'LEA-101', vanTotal: 0 });
    expect(holder).toMatchObject({ custodyType: 'VEHICLE', custodyId: lec303 });
  });

  it("Imran can't finish his own run on LEA-101 because of the cylinder Kashif loaded after his van change", async () => {
    const { std, scans } = w;
    const lea101 = std.DR1.vehicleId as string;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const lec303 = await newVan('LEC-303');
    const kashifMoved = await giveVan(std.DR1.id, lec303);
    if (kashifMoved.status === 409) return;
    expect((await giveVan(std.DR2.id, lea101)).status).toBe(200);
    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);

    // Imran's own run on LEA-101: load, deliver, finish the visit, finish the trip.
    const y1 = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(y1, std.DR2);
    expect(t2.vehicleId).toBe(lea101);
    await w.load(std.DR2, t2, [5]);
    await w.doneLoading(std.DR2, t2);
    await w.hand(std.DR2, t2, y1, [5]);
    expect((await w.finishVisit(std.DR2, t2, y1)).status).toBe(200);
    const finish = await scans.finishTrip(std.DR2, t2.id, {});
    // Imran's van holds nothing of his: his run must finish.
    expect({ status: finish.status, code: finish.body?.code, details: finish.body?.details }).toEqual({
      status: 200,
      code: undefined,
      details: undefined,
    });
  });

  it('a refill pickup after the office moved the driver to another van lands on the old van', async () => {
    const { std } = w;
    const refills = refillCalls(app);
    const station = await createStation();
    await setCylinderState(w.ag(6).id, 'EMPTY');
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, station });
    await refills.assign(std.SA1, refill.id, std.DR1.id).expect(200); // the refill's van: LEA-101

    const lec303 = await newVan('LEC-303');
    const kashifMoved = await giveVan(std.DR1.id, lec303);
    if (kashifMoved.status === 409) return;
    expect(kashifMoved.status).toBe(200);

    await refills.scan(std.DR1, refill.id, { phase: 'PICKUP', code: w.ag(6).qrCode }).expect(201);
    const kashif = await w.scans.driverHome(std.DR1).expect(200);
    expect({ plate: kashif.body.vehicle.plateNo, vanTotal: kashif.body.van.total }).toEqual({ plate: 'LEC-303', vanTotal: 1 });
    expect(await w.holder(6)).toMatchObject({ custodyType: 'VEHICLE', custodyId: lec303 });
  });
});
