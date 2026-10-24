/**
 * REVIEW (contract-compat): API_CONTRACT §7.6 assign rule 4 refuses a driver change only when the order's
 * trip has "any load scan or loadStartedAt", and §1.6 offers REASSIGN while the order is ASSIGNED with
 * `loadStartedAt` null. The server used to refuse the reassign after any cylinder event on the trip, so
 * an unload (SCAN_IN) of yesterday's empties at the store made the offered REASSIGN fail with 409
 * ASSIGN_ORDER_LOADED ("Cylinders are already loaded…"), though nothing was loaded; and a cancel left the
 * trip open with nothing on it (§7.6 cancel step 6 aborts a trip with "no load scan").
 *
 * Fixed (contract-compat-02): a hand-back (SCAN_IN) no longer counts for assign rule 4 or for the abort of
 * an idle trip. Any other event still does: a DELIVERED scan needs no load on the trip in Inc 1 (a full
 * left on the van), so a cylinder already with the customer still blocks a driver change, and REASSIGN
 * isn't offered then. The office's own abort (§7.7) is still refused after any event, a SCAN_IN included.
 * REASSIGN follows the same check as rule 4, so an empty taken back from the customer before anything
 * was loaded hides it too.
 *
 * Increment 2 (API_CONTRACT §9.2, §9.10): the store's own receive (POST /store/scans, no trip_id) is the
 * hand-back now, and the legacy SCAN_IN answers 403 SCAN_USE_STORE_RECEIVE, so these cases hand the empties
 * back the Inc 2 way. A hand-over without a load can't happen any more ("no IN, no OUT", 409
 * SCAN_NOT_ON_YOUR_VAN); that case was retired for 'ASG-012 (Inc 2)' in
 * test/inc2/scan/assign-and-steps-inc2.e2e-spec.ts, where a real hand-over blocks the driver change.
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderState } from '@prisma/client';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../../helpers/standard-data';

const API = '/api/v1';

describeDb('REVIEW contract-compat: reassign after an unload scan', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  beforeAll(async () => {
    app = await createTestApp();
  });

  // Fresh data per case: from Inc 2 an order assigned to a driver joins that driver's PLANNED trip while
  // it has no load (API_CONTRACT §9.5), so one case's reassigned order would otherwise share the next
  // case's trip.
  beforeEach(async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  let scanNo = 0;
  /** The shop scans a cylinder in from a van (the Inc 2 hand-back, API_CONTRACT §9.4). */
  function storeReceive(qrCode: string) {
    scanNo += 1;
    return http(app)
      .post(`${API}/store/scans`)
      .set(authHeader(std.DA.actor))
      .send({ scanId: `cccccccc-cccc-4ccc-8ccc-${String(scanNo).padStart(12, '0')}`, code: qrCode, entryMethod: 'QR' });
  }

  /** A cylinder left on a driver's van from an earlier run (no event on today's trip). */
  function leftover(serial: string, state: CylinderState, vehicleId: string) {
    return db().cylinder.create({
      data: {
        serial,
        qrCode: `${serial}-QR`,
        distributorId: std.DA.id,
        cylinderTypeId: std.sizes.kg11_8,
        state,
        custodyType: CustodyType.VEHICLE,
        custodyId: vehicleId,
      },
    });
  }

  it('REV contract-compat-02 REASSIGN is offered after a SCAN_IN of leftover empties, and assign-driver does it', async () => {
    const office = authHeader(std.SA1.actor);
    const placed = await http(app).post(`${API}/orders`).set(authHeader(std.DA.actor)).send(x1OrderBody(std)).expect(201);
    const orderId: string = placed.body.id;
    const assigned = await http(app).post(`${API}/orders/${orderId}/assign-driver`).set(office).send({ driverId: std.DR1.id }).expect(200);
    const tripId: string = assigned.body.tripId;

    // An empty left on DR1's van from an earlier run; the store scans it in while today's trip waits. The
    // old driver app's SCAN_IN is refused from Inc 2: the store receives.
    const empty = await leftover('AG-C0950', CylinderState.EMPTY, std.DR1.vehicleId as string);
    const legacy = await http(app)
      .post(`${API}/custody/scan`)
      .set(authHeader(std.DR1.actor))
      .send({ qrCode: empty.qrCode, eventType: 'SCAN_IN', tripId })
      .expect(403);
    expect(legacy.body.code).toBe('SCAN_USE_STORE_RECEIVE');
    await storeReceive(empty.qrCode).expect(201);

    // Nothing was loaded: the order is still ASSIGNED, refundable, and the office is offered REASSIGN.
    const view = await http(app).get(`${API}/orders/${orderId}`).set(office).expect(200);
    expect(view.body).toMatchObject({ status: 'ASSIGNED', loadStartedAt: null, stage: 'DRIVER_ASSIGNED' });
    expect(view.body.cancel).toMatchObject({ allowed: true, refundPaisa: '48000' });
    expect(view.body.allowedActions).toContain('REASSIGN');

    // The offered REASSIGN works (§7.6 rule 4: "any load scan or loadStartedAt"), and the old trip, left
    // with no open order and no load, is aborted. (The store's receive carries no trip, so nothing happened
    // on the trip at all.)
    const reassign = await http(app).post(`${API}/orders/${orderId}/assign-driver`).set(office).send({ driverId: std.DR2.id });
    expect({ status: reassign.status, from: reassign.body.reassignedFromTripId, driver: reassign.body.driverId }).toEqual({
      status: 200,
      from: tripId,
      driver: std.DR2.id,
    });
    expect((await db().trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe('ABORTED');
    const after = await http(app).get(`${API}/orders/${orderId}`).set(office).expect(200);
    expect(after.body).toMatchObject({ status: 'ASSIGNED', trip: { driver: { id: std.DR2.id } } });
  });

  it('REV contract-compat-02 a cancel before loading aborts the trip, a SCAN_IN of leftover empties notwithstanding (§7.6 step 6)', async () => {
    const placed = await http(app).post(`${API}/orders`).set(authHeader(std.DA.actor)).send(x1OrderBody(std)).expect(201);
    const assigned = await http(app).post(`${API}/orders/${placed.body.id}/assign-driver`).set(authHeader(std.SA1.actor)).send({ driverId: std.DR2.id }).expect(200);
    const empty = await leftover('AG-C0951', CylinderState.EMPTY, std.DR2.vehicleId as string);
    await storeReceive(empty.qrCode).expect(201);

    const cancelled = await http(app).post(`${API}/orders/${placed.body.id}/cancel`).set(authHeader(std.DA.actor)).send({ reasonCode: 'DUPLICATE' }).expect(200);
    expect(cancelled.body.refundedPaisa).toBe('48000');
    const trip = await db().trip.findUniqueOrThrow({ where: { id: assigned.body.tripId } });
    // No other open order and no load scan: the trip is ABORTED, so the old driver app can't pick it as the current delivery.
    expect(trip.status).toBe('ABORTED');
  });

  // 'REV contract-compat-02 a cylinder handed to the customer without a load still blocks a driver change …'
  // was retired at Increment 2 (see the header): the hand-over it starts from is refused now.

  it('REV contract-compat-02 an empty taken back from the customer before anything was loaded hides REASSIGN, as assign-driver refuses it', async () => {
    const office = authHeader(std.SA1.actor);
    const placed = await http(app).post(`${API}/orders`).set(authHeader(std.DA.actor)).send(x1OrderBody(std)).expect(201);
    const orderId: string = placed.body.id;
    const assigned = await http(app).post(`${API}/orders/${orderId}/assign-driver`).set(office).send({ driverId: std.DR1.id }).expect(200);
    // A cylinder Sana kept from an earlier delivery; DR1 takes it back first, before loading anything.
    const kept = await db().cylinder.create({
      data: {
        serial: 'AG-C0953',
        qrCode: 'AG-C0953-QR',
        distributorId: std.DA.id,
        cylinderTypeId: std.sizes.kg11_8,
        state: CylinderState.FULL,
        custodyType: CustodyType.CLIENT,
        custodyId: std.C1.id,
      },
    });
    await http(app)
      .post(`${API}/custody/scan`)
      .set(authHeader(std.DR1.actor))
      .send({ qrCode: kept.qrCode, eventType: 'PICKED_UP_EMPTY', tripId: assigned.body.tripId, orderId })
      .expect(201);
    const row = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    expect({ loadStartedAt: row.loadStartedAt, status: row.status }).toEqual({ loadStartedAt: null, status: 'ASSIGNED' });

    // Nothing loaded and nothing handed over, but a cylinder moved on the trip: rule 4 refuses, so REASSIGN isn't offered.
    const view = await http(app).get(`${API}/orders/${orderId}`).set(office).expect(200);
    expect(view.body.allowedActions).not.toContain('REASSIGN');
    const reassign = await http(app).post(`${API}/orders/${orderId}/assign-driver`).set(office).send({ driverId: std.DR2.id });
    expect({ status: reassign.status, code: reassign.body.code }).toEqual({ status: 409, code: 'ASSIGN_ORDER_LOADED' });
  });
});
