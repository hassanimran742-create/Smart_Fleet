/**
 * [review23 holder-scans] Refill and delivery on one van (TEST_CASES G08-09; API_CONTRACT §10.5): cylinders on
 * an open refill line "don't block a delivery trip's Finish trip". §9.12: the trip's `allowedActions` offer
 * COMPLETE "once every stop is closed and the van is empty, or leftovers are allowed", and the driver app's
 * next step (tripModel.nextStep) is Unload while `van.total` > 0, else Finish trip.
 *
 * `allowedActions` and `van.total` count the refill cylinders, `van.cylinders` and the finish don't: the
 * server accepts "Finish trip" while it never offers it, and the app keeps saying "Unload at store" with
 * nothing of the trip's left to unload.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { refillCalls } from '../../helpers/inc3-calls';
import { createRefill, createStation } from '../../helpers/refills';
import { setCylinderState } from '../../helpers/runs';
import { buildWorld, Y1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

/* eslint-disable @typescript-eslint/no-var-requires */
const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');
const { nextStep } = require(path.join(MOBILE_SRC, 'screens', 'driver', 'tripModel.ts')) as typeof import('../../../../mobile/src/screens/driver/tripModel');
/* eslint-enable @typescript-eslint/no-var-requires */

describeDb('review23 holder-scans: a refill and a delivery run on one van', () => {
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

  it('once every visit is done, the trip offers Finish trip although a refill cylinder rides on the same van', async () => {
    const { std, scans } = w;
    const refills = refillCalls(app);
    const station = await createStation();
    await setCylinderState(w.ag(6).id, 'EMPTY');
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, station, assignTo: std.DR1 });
    await refills.scan(std.DR1, refill.id, { phase: 'PICKUP', code: w.ag(6).qrCode }).expect(201);

    const y1 = await w.placeOrder(Y1);
    const t1 = await w.assign(y1, std.DR1);
    await w.load(std.DR1, t1, [1]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, y1, [1]);
    expect((await w.finishVisit(std.DR1, t1, y1)).status).toBe(200);

    const view = await scans.trip(std.DR1, t1.id).expect(200);
    // Nothing of the trip is on the van: the refill cylinder isn't the trip's (§9.13).
    expect(view.body.van.cylinders).toEqual([]);
    const offered = view.body.allowedActions as string[];
    // What the driver app shows next for this very answer (apps/mobile tripModel.nextStep).
    const appNext = nextStep(view.body).kind;
    // The server finishes the trip now, so it must have offered it, and the app's next step must be Finish
    // trip (the counts still include the refill cylinder, §9.13, which is what the app's Unload step reads).
    const finish = await scans.finishTrip(std.DR1, t1.id, {});
    expect({ offered, appNext, vanTotal: view.body.van.total, finish: finish.status }).toEqual({
      offered: ['COMPLETE'],
      appNext: 'FINISH',
      vanTotal: 1,
      finish: 200,
    });
  });
});
