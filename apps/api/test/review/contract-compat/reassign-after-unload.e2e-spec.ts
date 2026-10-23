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
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderState } from '@prisma/client';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma } from '../../helpers/db';
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
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
  });

  afterAll(async () => {
    await app?.close();
  });

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

    // An empty left on DR1's van from an earlier run; DR1 hands it back at the store on today's trip.
    const empty = await leftover('AG-C0950', CylinderState.EMPTY, std.DR1.vehicleId as string);
    await http(app)
      .post(`${API}/custody/scan`)
      .set(authHeader(std.DR1.actor))
      .send({ qrCode: empty.qrCode, eventType: 'SCAN_IN', tripId })
      .expect(201);

    // Nothing was loaded: the order is still ASSIGNED, refundable, and the office is offered REASSIGN.
    const view = await http(app).get(`${API}/orders/${orderId}`).set(office).expect(200);
    expect(view.body).toMatchObject({ status: 'ASSIGNED', loadStartedAt: null, stage: 'DRIVER_ASSIGNED' });
    expect(view.body.cancel).toMatchObject({ allowed: true, refundPaisa: '48000' });
    expect(view.body.allowedActions).toContain('REASSIGN');

    // The office's own abort is still refused after any event on the trip (§7.7) ...
    const tripBefore = await http(app).get(`${API}/trips/${tripId}`).set(office).expect(200);
    expect(tripBefore.body.allowedActions).toEqual([]);

    // ... but the offered REASSIGN works (§7.6 rule 4: "any load scan or loadStartedAt"), and the old trip,
    // left with no open order and no load, is aborted.
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
    await http(app).post(`${API}/custody/scan`).set(authHeader(std.DR2.actor)).send({ qrCode: empty.qrCode, eventType: 'SCAN_IN', tripId: assigned.body.tripId }).expect(201);

    const cancelled = await http(app).post(`${API}/orders/${placed.body.id}/cancel`).set(authHeader(std.DA.actor)).send({ reasonCode: 'DUPLICATE' }).expect(200);
    expect(cancelled.body.refundedPaisa).toBe('48000');
    const trip = await db().trip.findUniqueOrThrow({ where: { id: assigned.body.tripId } });
    // No other open order and no load scan: the trip is ABORTED, so the old driver app can't pick it as the current delivery.
    expect(trip.status).toBe('ABORTED');
  });

  it('REV contract-compat-02 a cylinder handed to the customer without a load still blocks a driver change (409 ASSIGN_ORDER_LOADED), and REASSIGN is not offered', async () => {
    const office = authHeader(std.SA1.actor);
    const placed = await http(app).post(`${API}/orders`).set(authHeader(std.DA.actor)).send(x1OrderBody(std)).expect(201);
    const orderId: string = placed.body.id;
    const assigned = await http(app).post(`${API}/orders/${orderId}/assign-driver`).set(office).send({ driverId: std.DR1.id }).expect(200);
    // A full left on DR1's van is handed over at Sana's: Inc 1 needs no load on this trip for that.
    const full = await leftover('AG-C0952', CylinderState.FULL, std.DR1.vehicleId as string);
    await http(app)
      .post(`${API}/custody/scan`)
      .set(authHeader(std.DR1.actor))
      .send({ qrCode: full.qrCode, eventType: 'DELIVERED', tripId: assigned.body.tripId, orderId })
      .expect(201);
    expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).loadStartedAt).toBeNull();
    // REASSIGN is no longer offered: the button would only answer the 409 below.
    const view = await http(app).get(`${API}/orders/${orderId}`).set(office).expect(200);
    expect(view.body.allowedActions).not.toContain('REASSIGN');
    expect(view.body.allowedActions).toContain('MANUAL_DELIVERY');

    const reassign = await http(app).post(`${API}/orders/${orderId}/assign-driver`).set(office).send({ driverId: std.DR2.id });
    expect({ status: reassign.status, code: reassign.body.code }).toEqual({ status: 409, code: 'ASSIGN_ORDER_LOADED' });
    expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).tripId).toBe(assigned.body.tripId);
  });

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
