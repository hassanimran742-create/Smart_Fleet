/**
 * Review 23 (robustness, jobs and operations): a cylinder the day-end marks Missing while the app has it
 * on a van keeps the van as its holder (MARK_LOST, "state LOST, holder unchanged", G09-03). Nothing
 * removes it from the van afterwards, so from then on:
 * - every later run of that van fails "Finish trip" with 409 TRIP_VAN_NOT_EMPTY (the lost cylinder is a
 *   SPARE from an earlier run; `trip.allowFinishWithLeftovers` is off by default), and the driver's Unload
 *   waits for the store to scan in a cylinder nobody has;
 * - the 03:00 van check raises or refreshes VAN_NOT_EMPTY for that van every night;
 * - the van's driver can't be changed (VEHICLE_HAS_CYLINDERS).
 * The only way out is the shop "receiving" a cylinder it doesn't have, by typing its number.
 */
import type { INestApplication } from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { createTrip, dayEndCalls, describeDb, fillDaySheet, getTestPrisma, placeOnVanFromEarlierRun } from '../../helpers';
import { VanCheckJob } from '../../../src/modules/custody/van-check.job';
import { DayEndCore } from '../../../src/modules/day-end/day-end-core';
import { buildWorld, Y1, type World } from '../../inc2/scan/support/world';
import { stubStorage } from '../../inc3/dayend/support';

describeDb('review23 robustness: a cylinder marked Missing on a van blocks that van from then on', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
    stubStorage(app);
    w = await buildWorld(app);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('after an approved Missing fix of a van cylinder, the next run on that van can still finish', async () => {
    const db = getTestPrisma();
    // Yesterday's run left AG-C0010 on Kashif's van (LEA-101); tonight the shop can't find it anywhere.
    const earlier = await createTrip({ driver: w.std.DR1, distributor: w.std.DA, status: TripStatus.COMPLETED });
    await placeOnVanFromEarlierRun({ cylinder: w.ag(10), vehicleId: w.std.DR1.vehicleId as string, earlierTripId: earlier.id, actor: w.std.DR1 });

    const days = dayEndCalls(app);
    const date = await app.get(DayEndCore).today();
    const sheet = await days.sheet(w.std.DA, date);
    expect(sheet.status).toBe(200);
    const filled = await fillDaySheet(sheet.body as Buffer, { rows: { 'AG-C0010': { where: 'Missing', why: 'Not on the van, not in the shop' } } });
    const upload = await days.upload(w.std.DA, date, filled);
    expect(upload.status).toBe(200);
    expect((await days.submit(w.std.DA, date, { version: upload.body.version })).status).toBe(200);
    const day = await db.dayClose.findFirstOrThrow({ where: { distributorId: w.std.DA.id } });
    expect((await days.approve(w.std.SA1, day.id, { version: upload.body.version })).status).toBe(200);
    const lost = await w.holder(10);
    expect(lost).toMatchObject({ custodyType: 'VEHICLE', custodyId: w.std.DR1.vehicleId, state: 'LOST' });

    // The next morning Kashif runs an ordinary delivery on LEA-101.
    const order = await w.placeOrder(Y1);
    const trip = await w.assign(order, w.std.DR1);
    await w.load(w.std.DR1, trip, [1]);
    await w.doneLoading(w.std.DR1, trip);
    await w.hand(w.std.DR1, trip, order, [1]);
    expect((await w.finishVisit(w.std.DR1, trip, order)).status).toBe(200);
    const finish = await w.scans.finishTrip(w.std.DR1, trip.id);
    const vanCheck = await app.get(VanCheckJob).run();
    // eslint-disable-next-line no-console
    console.log(
      `[lost on van] Finish trip: ${finish.status} ${finish.body?.code ?? ''} ${JSON.stringify(finish.body?.details?.cylinders ?? [])}; ` +
        `03:00 van check vans=${vanCheck.vans} ${vanCheck.plates.join(',')}`,
    );
    expect(finish.status).toBe(200);
    expect(vanCheck.vans).toBe(0);
  });
});
