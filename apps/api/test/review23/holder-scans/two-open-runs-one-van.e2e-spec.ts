/**
 * [review23 holder-scans] Two open runs of one driver on one van. assign-driver v2 (API_CONTRACT §9.5)
 * appends an order to the driver's PLANNED trip only while it has no load scan, "otherwise a new trip is
 * created": an order assigned while Kashif is still loading at the store becomes a second run on the same
 * van, and he loads both. §9.3 lists SPARE as "a cylinder loaded for an order cancelled after loading, or
 * one left on the van from an earlier run"; the shop's incoming list leaves out cylinders "out for delivery"
 * (§9.13). Here the second run's cylinders are neither spare nor leftovers: they are out for delivery.
 *
 * What the driver is told after his first run's last visit: the trip's van lists the other run's cylinder,
 * the app's next step is "Unload at store", and "Finish trip" is refused with TRIP_VAN_NOT_EMPTY. If the
 * shop scans it in as asked, Usman's cylinder can't be delivered by scan any more.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, Y1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

/* eslint-disable @typescript-eslint/no-var-requires */
const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');
const { nextStep } = require(path.join(MOBILE_SRC, 'screens', 'driver', 'tripModel.ts')) as typeof import('../../../../mobile/src/screens/driver/tripModel');
/* eslint-enable @typescript-eslint/no-var-requires */

describeDb('review23 holder-scans: two open runs of one driver on one van', () => {
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

  it("after Sana's visit, the run doesn't ask Kashif to unload Usman's cylinder that is out for delivery", async () => {
    const { std, scans } = w;
    const sana = await w.placeOrder(Y1, 'C1');
    const t1 = await w.assign(sana, std.DR1);
    await w.load(std.DR1, t1, [1]);
    // While Kashif is still at the store, the office assigns Usman's order: a second run on LEA-101.
    const usman = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(usman, std.DR1);
    expect(t2.id).not.toBe(t1.id);
    expect(t2.vehicleId).toBe(t1.vehicleId);
    await w.doneLoading(std.DR1, t1);
    await w.load(std.DR1, t2, [2]);
    await w.doneLoading(std.DR1, t2);

    // Sana first: her visit is done; AG-C0002 is still on the van for Usman.
    await w.hand(std.DR1, t1, sana, [1]);
    expect((await w.finishVisit(std.DR1, t1, sana)).status).toBe(200);

    const view = await scans.trip(std.DR1, t1.id).expect(200);
    const incoming = await scans.storeIncoming(std.DA).expect(200);
    const finish = await scans.finishTrip(std.DR1, t1.id, {});
    expect({
      // The shop is told nothing is coming back from LEA-101 (AG-C0002 is out for delivery)...
      shopComingBack: incoming.body.vans.length,
      // ...so the driver must not be sent to unload it, and his finished run must close.
      tripVanList: view.body.van.cylinders.map((c: { shortCode: string; came: string }) => `${c.shortCode} ${c.came}`),
      appNext: nextStep(view.body).kind,
      finish: finish.status,
    }).toEqual({ shopComingBack: 0, tripVanList: [], appNext: 'FINISH', finish: 200 });
  });
});
