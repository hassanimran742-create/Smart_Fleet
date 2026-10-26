/**
 * REVIEW23 (contract-compat): `PATCH /drivers/:id/vehicle` (§9.5) only refuses a van that holds cylinders.
 * A trip (and an Inc 3 refill) keeps the van it was created with (`trips.vehicle_id`,
 * `filling_orders.assigned_vehicle_id`), and every LOAD / refill PICKUP goes onto that stored van. So a van
 * change between assignment and the first load sends the driver's scans onto a van they no longer drive,
 * and the driver's own screens (GET /driver/home, GET /inventory/my-vehicle) disagree with the trip.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(180_000);

describeDb('REVIEW23 contract-compat: a van change after assignment', () => {
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

  it('REV23-CC-04 the run follows the van the driver has when loading, or the office is told why the van can\'t change', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1); // trip on LEA-101 (DR1's van at assignment)
    const zone = await w.db.zone.findFirstOrThrow();
    const spare = await w.db.vehicle.create({ data: { plateNo: 'LEC-303', capacityUnits: 40, homeZoneId: zone.id, status: 'ACTIVE' } });

    // The office gives Kashif another van before he loads (LEA-101 is empty, so this is allowed).
    const change = await w.as(std.SA1).patch(`/drivers/${std.DR1.id}/vehicle`).send({ vehicleId: spare.id });
    if (change.status === 409) return; // refusing the change while a run waits on the old van is an acceptable fix

    expect(change.status).toBe(200);
    await w.load(std.DR1, t1, [1]);

    const home = await w.as(std.DR1).get('/driver/home').expect(200);
    const trip = await w.as(std.DR1).get(`/trips/${t1.id}`).expect(200);
    const mine = await w.as(std.DR1).get('/inventory/my-vehicle').expect(200);
    const holder = await w.holder(1);

    // One van, one truth: the cylinder Kashif just loaded is on the van he drives, and all three of his
    // screens say so.
    expect({
      holderVan: holder.custodyId,
      homeVan: home.body.vehicle?.id,
      homeCount: home.body.van.total,
      tripVanCount: trip.body.van.total,
      myVehicle: { id: mine.body.vehicleId, full: mine.body.totalFull },
    }).toEqual({
      holderVan: spare.id,
      homeVan: spare.id,
      homeCount: 1,
      tripVanCount: 1,
      myVehicle: { id: spare.id, full: 1 },
    });
  });
});
