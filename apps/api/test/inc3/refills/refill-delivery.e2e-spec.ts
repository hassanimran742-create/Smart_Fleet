/**
 * [Inc 3] A refill run beside the delivery runs (API_CONTRACT §10.1, §9.2, §9.3, §9.5; DATA_MODEL §3.6;
 * G08-09): a refill pickup is no load scan of any trip, so it never stamps `load_started_at`, never keeps
 * an idle trip open and never takes the refund away; refill cylinders count for a van's driver change, but
 * they don't block a delivery trip's finish.
 */
import {  randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { resetDb } from '../../helpers/db';
import { onOpenRefillLine } from '../../helpers/refills';
import { x1OrderBody } from '../../helpers/standard-data';
import { buildRefillWorld, messageOf, type RefillWorld } from './support/refill-world';

jest.setTimeout(180_000);

describeDb('inc3 refills: beside the delivery runs', () => {
  let app: INestApplication;
  let w: RefillWorld;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildRefillWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Ahmed Gas places X1 for Sana (Rs 250) and the office gives it to Kashif: trip PLANNED, nothing loaded. */
  async function x1ForKashif(): Promise<{ orderId: string; tripId: string }> {
    const { std } = w;
    const placed = await w.as(std.DA).post('/orders').set('Idempotency-Key', randomUUID()).send(x1OrderBody(std)).expect(201);
    const assigned = await w.as(std.SA1).post(`/orders/${placed.body.id}/assign-driver`).send({ driverId: std.DR1.id }).expect(200);
    return { orderId: placed.body.id, tripId: assigned.body.tripId };
  }

  it('REF-022 A refill pickup never counts as the start of a delivery', async () => {
    const { std, db } = w;
    expect(await app.get(SettingsService).get('orders.deliveryStartedAt')).toBe('FIRST_LOAD_SCAN');
    const x1 = await x1ForKashif();
    expect(await w.balance()).toBe(475_000n);
    await w.empty(1);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });

    // Step 1.
    await w.pickup(std.DR1, r1, 1).expect(201);

    // Step 2.
    const order = await w.as(std.DA).get(`/orders/${x1.orderId}`).expect(200);
    expect(order.body).toMatchObject({ loadStartedAt: null, stage: 'DRIVER_ASSIGNED', cancel: { allowed: true, refundPaisa: '25000', noRefundReason: null } });
    expect((await db.order.findUniqueOrThrow({ where: { id: x1.orderId } })).loadStartedAt).toBeNull();

    // Step 3.
    const cancel = await w
      .as(std.DA)
      .post(`/orders/${x1.orderId}/cancel`)
      .set('Idempotency-Key', randomUUID())
      .send({ reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: '25000' })
      .expect(200);
    expect(cancel.body.refundedPaisa).toBe('25000');
    const reversals = await db.ledgerEntry.findMany({ where: { orderId: x1.orderId, entryType: 'CREDIT_ORDER_REVERSAL' } });
    expect(reversals.map((row) => [row.idempotencyKey, row.amountPaisa])).toEqual([[`order:${x1.orderId}:reversal`, 25_000n]]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'order.cancel', resourceId: x1.orderId } });
    expect(audit.diff).toMatchObject({ refunded: true, refundPaisa: '25000', startedRule: 'FIRST_LOAD_SCAN' });

    // Step 4.
    const wallet = await w.as(std.DA).get('/wallet').expect(200);
    expect(wallet.body.balancePaisa).toBe('500000');
    expect((await db.trip.findUniqueOrThrow({ where: { id: x1.tripId } })).status).toBe('ABORTED');
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
    expect(await onOpenRefillLine(w.ag(1).id)).toBe(true);
    expect(await db.cylinderEvent.count({ where: { tripId: x1.tripId } })).toBe(0);

    // Step 5.
    const change = await w.as(std.SA1).patch(`/drivers/${std.DR1.id}/vehicle`).send({ vehicleId: null }).expect(409);
    expect(change.body).toMatchObject({ code: 'VEHICLE_HAS_CYLINDERS', details: { count: 1 }, message: messageOf('VEHICLE_HAS_CYLINDERS', { count: 1 }) });
    expect((await db.driver.findUniqueOrThrow({ where: { id: std.DR1.id } })).currentVehicleId).toBe(std.DR1.vehicleId);
    await w.walletClean();
  });

  it('REF-022 A refill pickup is no load of a trip: the trip stays reassignable and its loading needs real loads', async () => {
    const { std, db, scans } = w;
    const x1 = await x1ForKashif();
    await w.empty(1);
    const r1 = await w.refill({ count: 1, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    // The office may still give X1 to Imran: no load scan on its trip.
    const view = await w.as(std.SA1).get(`/orders/${x1.orderId}`).expect(200);
    expect(view.body.allowedActions).toContain('REASSIGN');
    // A delivery hand-over of the refill cylinder is refused: it was never loaded on this run (no IN, no OUT).
    const trip = await db.trip.findUniqueOrThrow({ where: { id: x1.tripId }, include: { stops: true } });
    const pickupStop = trip.stops.find((stop) => stop.stopType === 'STORE_PICKUP');
    const deliveryStop = trip.stops.find((stop) => stop.stopType === 'DELIVERY');
    const hand = await scans.tripScan(std.DR1, x1.tripId, { stopId: deliveryStop!.id, action: 'HANDOVER', code: w.ag(1).qrCode }).expect(409);
    expect(hand.body.code).toBe('SCAN_NOT_ON_YOUR_VAN');
    // And it doesn't count as loaded at the store stop.
    const stop = await scans.stop(std.DR1, x1.tripId, pickupStop!.id).expect(200);
    expect(stop.body.progress).toMatchObject({ type: 'STORE_PICKUP', doneCount: 0, neededCount: 3 });
    expect((await db.order.findUniqueOrThrow({ where: { id: x1.orderId } })).loadStartedAt).toBeNull();
  });

  it('REF-022 A cylinder on an open refill line does not block a delivery trip from finishing', async () => {
    const { std, db, scans } = w;
    await w.empty(1);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);

    // Step 6: a new order for Kashif on LEA-101, delivered in full, then "Finish trip".
    const placed = await w
      .as(std.DA)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ clientId: std.C1.id, addressId: std.C1.addressId, deliveryLabel: "Sana's house", lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 0 }] })
      .expect(201);
    const assigned = await w.as(std.SA1).post(`/orders/${placed.body.id}/assign-driver`).send({ driverId: std.DR1.id }).expect(200);
    const tripId = assigned.body.tripId as string;
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).vehicleId).toBe(std.DR1.vehicleId);
    const stops = await db.tripStop.findMany({ where: { tripId }, orderBy: { seq: 'asc' } });
    await scans.tripScan(std.DR1, tripId, { stopId: stops[0].id, action: 'LOAD', code: w.ag(2).qrCode }).expect(201);
    await scans.finishStop(std.DR1, tripId, stops[0].id).expect(200);
    await scans.tripScan(std.DR1, tripId, { stopId: stops[1].id, action: 'HANDOVER', code: w.ag(2).qrCode }).expect(201);
    await scans.finishStop(std.DR1, tripId, stops[1].id).expect(200);
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });

    const finish = await scans.finishTrip(std.DR1, tripId, {}).expect(200);
    expect(finish.body.status).toBe('COMPLETED');
    expect(await onOpenRefillLine(w.ag(1).id)).toBe(true);
    // The refill cylinder still counts for the van: no driver change while it is on it.
    expect((await w.as(std.SA1).patch(`/drivers/${std.DR1.id}/vehicle`).send({ vehicleId: null }).expect(409)).body.details).toEqual({ count: 1 });
  });
});
