/**
 * [review23 holder-scans] A cylinder lost from a van (API_CONTRACT §10.2 MARK_LOST: "State LOST, holder
 * unchanged"; §10.5 summary: "a LOST cylinder is in none of" in store / on vans / with customers).
 *
 * Once the office approves "Missing" for a cylinder recorded on a van, nothing can take it off that van
 * except a store receive of a cylinder the shop doesn't have (a false scan) or a "MOVE_TO_STORE" the shop
 * would have to invent: the run can't finish (TRIP_VAN_NOT_EMPTY lists the lost cylinder), the van can't
 * change driver (VEHICLE_HAS_CYLINDERS), and the next sheet already says "Missing", so no fix is left.
 * Meanwhile the day-end summary says it is on no van.
 */
import type { INestApplication } from '@nestjs/common';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createOrder, createTrip, placeWithCustomer } from '../../helpers/runs';
import {
  API,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  D21,
  approve,
  createDayEndApp,
  freshWorld,
  submittedDay,
  vanOf,
  type DayWorld,
} from '../../inc3/dayend/support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('review23 holder-scans: a cylinder marked lost while it is on a van', () => {
  let app: INestApplication;
  let w: DayWorld;

  beforeAll(async () => {
    app = await createDayEndApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    w = await freshWorld(app);
  });

  it("after the office accepts it is lost, Kashif's run can finish and his van can change driver", async () => {
    const { std, scans } = w;
    // Sana has AG-C0003 from an earlier delivery; today Kashif brings her 1 x 11.8 kg and takes AG-C0003 back.
    await placeWithCustomer({ cylinder: w.ag(3), client: std.C1, actor: std.DR1 });
    const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] });
    const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
    const stop = trip.deliveryStopFor(order.id);
    await scans.tripScan(std.DR1, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: w.ag(10).qrCode }).expect(201);
    await scans.finishStop(std.DR1, trip.id, trip.pickupStopId).expect(200);
    await scans.tripScan(std.DR1, trip.id, { stopId: stop, action: 'HANDOVER', code: w.ag(10).qrCode }).expect(201);
    await scans.tripScan(std.DR1, trip.id, { stopId: stop, action: 'TAKE_BACK', code: w.ag(3).qrCode, returnState: 'EMPTY' }).expect(201);
    await scans.finishStop(std.DR1, trip.id, stop).expect(200);

    // On the way back AG-C0003 falls off the van. The shop's day-end says "Missing"; the office approves.
    const day = await submittedDay(w, { 'AG-C0003': { where: 'Missing', why: 'Driver lost it on the way back' } });
    await approve(w, day.id, day.version);
    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: w.ag(3).id } })).toMatchObject({
      custodyType: 'VEHICLE',
      custodyId: vanOf(w, 'DR1'),
      state: 'LOST',
    });
    const summary = (await w.calls.day(std.DA, D21).expect(200)).body.summary;

    // The run, the van and the summary after that approval.
    const finish = await scans.finishTrip(std.DR1, trip.id, {});
    const change = await http(app).patch(`${API}/drivers/${std.DR1.id}/vehicle`).set(authHeader(std.SA1.actor)).send({ vehicleId: null });
    expect({
      summaryOnVans: summary.onVans,
      finish: finish.status,
      finishCode: finish.body.code,
      vanChange: change.status,
      vanChangeCode: change.body.code,
    }).toEqual({ summaryOnVans: 0, finish: 200, finishCode: undefined, vanChange: 200, vanChangeCode: undefined });
  });
});
