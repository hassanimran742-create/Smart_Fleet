/**
 * [review23 verify holder-money] The premises of two fixes, kept as checks of the fixed behaviour:
 *
 * - holder-scans-01: the van change was also unsafe from the other side. When the office gave a van to
 *   another driver, the driver who lost it kept his PLANNED trip on it, and his later loads landed on the new
 *   driver's van. The guard now looks at every run on either van (lead decision 1): giving LEA-101 away is
 *   refused with DRIVER_HAS_OPEN_RUN, and Kashif's load lands on the van he still drives.
 * - holder-scans-05: a LOST cylinder can really be on a van (TAKE_BACK keeps FAULTY and LOST, §9.2 step 9),
 *   so the fix leaves out only one an approved day-end fix marked lost there with no move since; a lost one
 *   found and taken back still blocks Finish trip and shows as coming back.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

describeDb('review23 verify: premises of the holder-scans fixes', () => {
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

  it("REV23 holder-scans-01 giving LEA-101 to Imran while Kashif has a PLANNED trip on it is refused, and Kashif's load lands on the van he drives", async () => {
    const { std, scans } = w;
    const lea101 = std.DR1.vehicleId as string;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1); // PLANNED on LEA-101, nothing loaded
    expect(t1.vehicleId).toBe(lea101);

    // The office tries to give LEA-101 straight to Imran: both vans are empty, but Kashif's T1 is on it.
    const give = await w.as(std.SA1).patch(`/drivers/${std.DR2.id}/vehicle`).send({ vehicleId: lea101 });
    expect({ status: give.status, code: give.body.code, details: give.body.details, message: give.body.message }).toEqual({
      status: 409,
      code: 'DRIVER_HAS_OPEN_RUN',
      details: { driver: 'Kashif', plateNo: 'LEA-101', run: 'TRIP' },
      message: "Finish or reassign Kashif's trip on LEA-101 first.",
    });
    const kashifBefore = await scans.driverHome(std.DR1).expect(200);
    expect(kashifBefore.body.vehicle?.plateNo).toBe('LEA-101');

    // Kashif loads on his trip, and the cylinder goes onto LEA-101, the van he still drives; Imran's van is untouched.
    const load = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode });
    const imran = await scans.driverHome(std.DR2).expect(200);
    const holder = await w.holder(1);
    // eslint-disable-next-line no-console
    console.log(`[verify-01-symmetric] give ${give.status}; load ${load.status}; Imran ${imran.body.vehicle?.plateNo} total ${imran.body.van.total}; holder ${holder.custodyType}`);
    expect({ load: load.status, imranPlate: imran.body.vehicle?.plateNo, imranVanTotal: imran.body.van.total, holderVan: holder.custodyId }).toEqual({
      load: 201,
      imranPlate: 'LEB-202',
      imranVanTotal: 0,
      holderVan: lea101,
    });
  });

  it('REV23 holder-scans-05 a LOST cylinder taken back is physically on the van: it still blocks Finish trip and shows as coming back', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    await w.markState(11, 'LOST'); // e.g. an earlier day-end said Missing; Kashif now finds it at Sana's
    const order = await w.placeOrder([{ size: '11.8', full: 1, back: 1 }]);
    const t1 = await w.assign(order, std.DR1);
    await w.load(std.DR1, t1, [1]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, order, [1]);
    await w.takeBack(std.DR1, t1, order, 11, 'EMPTY'); // 201: TAKE_BACK goes ahead and keeps LOST
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: t1.vehicleId, state: 'LOST' });
    expect((await w.finishVisit(std.DR1, t1, order)).status).toBe(200);

    const finish = await scans.finishTrip(std.DR1, t1.id, {});
    const incoming = await scans.storeIncoming(std.DA).expect(200);
    const listed = (incoming.body.vans as Array<{ cylinders: Array<{ shortCode: string; state: string; came: string }> }>).flatMap((van) => van.cylinders);
    expect({ finish: finish.status, code: finish.body.code, cylinders: finish.body.details?.cylinders }).toEqual({
      finish: 409,
      code: 'TRIP_VAN_NOT_EMPTY',
      cylinders: [expect.objectContaining({ shortCode: 'AG-C0011', state: 'LOST', came: 'TAKEN_BACK' })],
    });
    expect(listed).toEqual([expect.objectContaining({ shortCode: 'AG-C0011', state: 'LOST', came: 'TAKEN_BACK' })]);
  });
});
