/**
 * REVIEW23 (contract-compat): the installed 0.1.0 shop and driver apps (the JS at af889bf, still on every
 * phone until the over-the-air update lands) replayed against the Inc 2/3 server with the Inc 2/3 settings
 * on. Every call is sent exactly as the old screens send it: the token and JSON only, no X-App-* header,
 * no Idempotency-Key, no scan id, the old bodies:
 *
 * - driver ScanScreen.tsx:58          POST /custody/scan { qrCode, eventType, tripId, orderId }
 * - driver DeliveryStepsScreen.tsx:58  PATCH /trips/stops/:id/arrive
 * - driver DeliveryStepsScreen.tsx:62  PATCH /trips/stops/:id/depart        ("Done loading", "Done")
 * - driver DeliveryStepsScreen.tsx:66  PATCH /orders/:id/status DELIVERED    ("All delivered")
 * - driver ActiveTripScreen.tsx:22     PATCH /trips/:id/status { status }     ("Start trip", "Finish")
 * - shop: no screen of the 0.1.0 shop app scans anything (no Receive).
 *
 * Each test states the contract and fails while the server breaks it.
 */
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStation } from '../../helpers/refills';
import { buildWorld, type World } from '../../inc2/scan/support/world';
import { JS_RELEASE_VERSION } from '../../../../mobile/src/api/release';

jest.setTimeout(240_000);

const API = '/api/v1';

describeDb('REVIEW23 contract-compat: the 0.1.0 apps on the Inc 2/3 server', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
    // The Inc 2/3 settings on: confirmation (support phone first, §9.1); typed entry and day-end are on by default.
    await w.setting('support.phone', '+923331000009');
    await w.setting('confirmation.enabled', true);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** The 0.1.0 axios client (api/client.ts at af889bf): the token and JSON, nothing else. */
  const oldApp = (caller: { actor: Parameters<typeof authHeader>[0] }) => ({ ...authHeader(caller.actor), 'Content-Type': 'application/json' });

  /**
   * The 0.1.0 DeliverySteps run, step by step as its phases offer them: LOAD ("Scan cylinder" ×N, "Done
   * loading"), DRIVE ("I arrived"), DELIVER ("Scan delivered" ×N, "All delivered"), EMPTIES ("Scan empty",
   * "Done"). Returns the trip and order.
   */
  async function oldDriverRun(opts: { give: number[]; back: number[] }) {
    const { std } = w;
    const order = await w.placeOrder([{ size: '11.8', full: opts.give.length, back: Math.max(1, opts.back.length) }]);
    const trip = await w.assign(order, std.DR1);
    const h = oldApp(std.DR1);
    const api = http(app);
    const view = (await api.get(`${API}/trips/${trip.id}`).set(h).expect(200)).body;
    const storeStop = view.stops.find((s: { stopType: string }) => s.stopType === 'STORE_PICKUP');
    const visit = view.stops.find((s: { stopType: string }) => s.stopType === 'DELIVERY');
    for (const n of opts.give) {
      await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(n).qrCode, eventType: 'SCAN_OUT', tripId: trip.id, orderId: storeStop.orderId }).expect(201);
    }
    await api.patch(`${API}/trips/stops/${storeStop.id}/depart`).set(h).expect(200);
    await api.patch(`${API}/trips/stops/${visit.id}/arrive`).set(h).expect(200);
    for (const n of opts.give) {
      await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(n).qrCode, eventType: 'DELIVERED', tripId: trip.id, orderId: order.id }).expect(201);
    }
    // "✓ All delivered": the order is DELIVERED; with returns expected the visit stays open (§9.12).
    await api.patch(`${API}/orders/${order.id}/status`).set(h).send({ status: 'DELIVERED' }).expect(200);
    // EMPTIES phase: "📷 Scan empty" for each empty the customer hands back, then "✓ Done".
    for (const n of opts.back) {
      await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(n).qrCode, eventType: 'PICKED_UP_EMPTY', tripId: trip.id, orderId: order.id }).expect(201);
    }
    await api.patch(`${API}/trips/stops/${visit.id}/depart`).set(h).expect(200);
    return { order, trip, visitId: visit.id as string, h };
  }

  it('REV23-CC-01 a 0.1.0 delivery with confirmation on: the customer is shown the empty the driver took back', async () => {
    // Sana has AG-C0011 from an earlier delivery; the order expects 1 back.
    await w.withCustomer(11, 'C1');
    const { order, visitId } = await oldDriverRun({ give: [1, 2], back: [11] });

    // The visit's own record: AG-C0011 was taken back on it (the shop's order screen and the van agree).
    const rows = await w.db.stopCylinder.findMany({ where: { tripStopId: visitId, direction: 'TAKEN_BACK' } });
    expect(rows).toHaveLength(1);
    expect((await w.holder(11)).custodyType).toBe('VEHICLE');

    // CUSTOMER_PAGE §1 issues the confirmation once "the take-back list is done", and §3's takenBack is the
    // stop's TAKEN_BACK list. The page and the shop's answer card read only this snapshot.
    const confirmation = await w.db.deliveryConfirmation.findUniqueOrThrow({ where: { orderId: order.id } });
    const snapshot = confirmation.snapshot as { takenBack: Array<{ size: string; state: string; count: number }> };
    expect(snapshot.takenBack).toEqual([expect.objectContaining({ size: '11.8 kg', state: 'EMPTY', count: 1 })]);

    const card = await http(app).get(`${API}/orders/${order.id}/confirmation`).set(authHeader(w.std.DA.actor)).expect(200);
    expect(card.body.takenBack).toEqual([expect.objectContaining({ size: '11.8 kg', count: 1 })]);
  });

  it("REV23 contract-compat-04 a 0.1.0 tap that keeps the visit open issues no link; the visit's close issues it once, with the take-back list, expiring from the tap", async () => {
    const { std } = w;
    await w.withCustomer(11, 'C1');
    const order = await w.placeOrder([{ size: '11.8', full: 1, back: 1 }]);
    const trip = await w.assign(order, std.DR1);
    const h = oldApp(std.DR1);
    const api = http(app);
    const view = (await api.get(`${API}/trips/${trip.id}`).set(h).expect(200)).body;
    const storeStop = view.stops.find((s: { stopType: string }) => s.stopType === 'STORE_PICKUP');
    const visit = view.stops.find((s: { stopType: string }) => s.stopType === 'DELIVERY');
    await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(1).qrCode, eventType: 'SCAN_OUT', tripId: trip.id, orderId: storeStop.orderId }).expect(201);
    await api.patch(`${API}/trips/stops/${storeStop.id}/depart`).set(h).expect(200);
    await api.patch(`${API}/trips/stops/${visit.id}/arrive`).set(h).expect(200);
    await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(1).qrCode, eventType: 'DELIVERED', tripId: trip.id, orderId: order.id }).expect(201);

    // "All delivered" with the empty still to scan: the order is DELIVERED, the visit stays open, no link yet.
    await api.patch(`${API}/orders/${order.id}/status`).set(h).send({ status: 'DELIVERED' }).expect(200);
    const delivered = await w.db.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, deliveredAt: true } });
    expect(delivered.status).toBe('DELIVERED');
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: visit.id } })).status).not.toBe('DONE');
    expect(await w.db.deliveryConfirmation.count({ where: { orderId: order.id } })).toBe(0);

    // "Scan empty", then "Done": the visit's close issues the link, once the take-back list is done.
    await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(11).qrCode, eventType: 'PICKED_UP_EMPTY', tripId: trip.id, orderId: order.id }).expect(201);
    await api.patch(`${API}/trips/stops/${visit.id}/depart`).set(h).expect(200);
    const confirmation = await w.db.deliveryConfirmation.findUniqueOrThrow({ where: { orderId: order.id } });
    expect((confirmation.snapshot as { takenBack: unknown[] }).takenBack).toEqual([expect.objectContaining({ size: '11.8 kg', state: 'EMPTY', count: 1 })]);
    // The link still expires linkTtlHours after the tap's deliveredAt (CUSTOMER_PAGE §1).
    const ttlHours = await app.get(SettingsService).get('confirmation.linkTtlHours');
    expect(confirmation.expiresAt.getTime()).toBe((delivered.deliveredAt as Date).getTime() + ttlHours * 3_600_000);

    // A repeated "Done" is a repeat: no second link, no second text.
    const again = await api.patch(`${API}/trips/stops/${visit.id}/depart`).set(h).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(await w.db.deliveryConfirmation.count({ where: { orderId: order.id } })).toBe(1);
    expect(await w.db.outboundMessage.count({ where: { confirmationId: confirmation.id, channel: 'SMS' } })).toBe(1);
  });

  it('REV23-CC-02 a 0.1.0 Finish the 0.1.0 apps can never complete is told to update, and the updated app finishes the run', async () => {
    await w.withCustomer(11, 'C1');
    const { trip, h } = await oldDriverRun({ give: [1], back: [11] });
    const api = http(app);
    const restart = { status: 426, code: 'APP_RESTART_TO_UPDATE', message: 'Close the app and open it again to update.' };
    const answer = (res: { status: number; body: { code?: string; message?: string } }) => ({ status: res.status, code: res.body.code, message: res.body.message });

    // "✓ Finish" (ActiveTripScreen.tsx:55): the van holds the take-back, which only the Inc 2/3 shop app can
    // scan in, and the 0.1.0 Finish can't give a leftover reason. Instead of a 409 the 0.1.0 apps can't act
    // on, the 0.1.0 JS is told how to get the update (the 0.1.0 screens show the answer's message).
    expect(answer(await api.patch(`${API}/trips/${trip.id}/status`).set(h).send({ status: 'COMPLETED' }))).toEqual(restart);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe('IN_PROGRESS');

    // The 0.1.0 driver can't hand it back (the store must scan it in): that answer is plain and kept.
    const handBack = await api.post(`${API}/custody/scan`).set(h).send({ qrCode: w.ag(11).qrCode, eventType: 'SCAN_IN', tripId: trip.id });
    expect(handBack.status).toBe(403);
    expect(handBack.body.code).toBe('SCAN_USE_STORE_RECEIVE');

    // Leftovers allowed doesn't let a Finish through without the driver's reason (§9.3): still refused, nothing written.
    await w.setting('trip.allowFinishWithLeftovers', true);
    expect(answer(await api.patch(`${API}/trips/${trip.id}/status`).set(h).send({ status: 'COMPLETED' }))).toEqual(restart);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe('IN_PROGRESS');

    // After the restart the same phone runs the over-the-air JS: the documented refusal, then the finish with a reason.
    const ota = { ...h, 'X-App-Variant': 'driver', 'X-App-Version': JS_RELEASE_VERSION };
    const refused = await api.post(`${API}/trips/${trip.id}/finish`).set(ota).send({});
    expect({ status: refused.status, code: refused.body.code, leftoversAllowed: refused.body.details?.leftoversAllowed }).toEqual({
      status: 409,
      code: 'TRIP_VAN_NOT_EMPTY',
      leftoversAllowed: true,
    });
    await api.post(`${API}/trips/${trip.id}/finish`).set(ota).send({ leftoverReason: 'Empty AG-C0011 on the van' }).expect(200);
    expect((await w.db.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe('COMPLETED');
    // The cylinder stays on the van until the store receives it: one holder, no silent move.
    expect((await w.holder(11)).custodyType).toBe('VEHICLE');
  });

  it('REV23 contract-compat-01 a 0.1.0 refill request is told to update and makes nothing; the over-the-air JS makes it', async () => {
    const api = http(app);
    const station = await createStation();
    // RequestFillingScreen.tsx (0.1.0): OUR_SERVICE, one request per cart line. From Inc 3 a refill is run on
    // scans and received by the store's scans, which only the Inc 3 apps can do (Appendix A, Inc 3: "the scan
    // flow is required (update app)"), so the 0.1.0 JS is answered before anything is made.
    const body = { fillingStationId: station.id, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 2, serviceType: 'OUR_SERVICE' };
    const old = await api.post(`${API}/filling-orders`).set(oldApp(w.std.DA)).send(body);
    expect({ status: old.status, code: old.body.code, message: old.body.message }).toEqual({
      status: 426,
      code: 'APP_RESTART_TO_UPDATE',
      message: 'Close the app and open it again to update.',
    });
    expect(await w.db.fillingOrder.count()).toBe(0);
    // The same phone after the restart, on the over-the-air JS: the refill is made.
    const ota = await api
      .post(`${API}/filling-orders`)
      .set({ ...oldApp(w.std.DA), 'X-App-Variant': 'distributor', 'X-App-Version': JS_RELEASE_VERSION })
      .send(body);
    expect({ status: ota.status, shortCode: ota.body.shortCode, status2: ota.body.status }).toEqual({ status: 201, shortCode: 'AG-R001', status2: 'PENDING' });
    // The 0.1.0 list still reads it (GET /filling-orders/mine is not refused).
    const mine = await api.get(`${API}/filling-orders/mine`).set(oldApp(w.std.DA)).expect(200);
    expect(mine.body.map((row: { id: string }) => row.id)).toEqual([ota.body.id]);
  });

  it('REV23-CC-03 app.minVersion.driver can retire the 0.1.0 JS without locking out the over-the-air JS', async () => {
    const api = http(app);
    // The 0.1.0 JS sends no X-App-* header; the over-the-air Inc 2/3 JS on the same 0.1.0 APK sends
    // X-App-Variant: driver and X-App-Version: its own JS release (apps/mobile/src/api/release.ts, through
    // appInfo.ts APP_VERSION and client.ts appHeaders), never the APK's 0.1.0.
    expect(JS_RELEASE_VERSION).not.toBe('0.1.0');
    const oldJs = () => api.get(`${API}/trips/mine`).set(oldApp(w.std.DR1));
    const otaJs = () => api.get(`${API}/trips/mine`).set({ ...oldApp(w.std.DR1), 'X-App-Variant': 'driver', 'X-App-Version': JS_RELEASE_VERSION });

    const outcomes: Record<string, { oldJs: number; otaJs: number }> = {};
    for (const minimum of ['0.0.0', '0.1.0', '0.1.1', '0.2.0']) {
      await w.setting('app.minVersion.driver', minimum);
      outcomes[minimum] = { oldJs: (await oldJs()).status, otaJs: (await otaJs()).status };
    }
    // The over-the-air release itself, the minimum the switch-over sets (§8.5).
    await w.setting('app.minVersion.driver', JS_RELEASE_VERSION);
    const retired = await oldJs();
    outcomes[JS_RELEASE_VERSION] = { oldJs: retired.status, otaJs: (await otaJs()).status };
    await w.setting('app.minVersion.driver', '0.0.0');
    // Some minimum must answer the old JS 426 (so its screens stop) while the over-the-air JS keeps working:
    // the over-the-air release's own version does.
    const separating = Object.entries(outcomes).filter(([, o]) => o.oldJs === 426 && o.otaJs === 200);
    expect({ outcomes, separating: separating.map(([v]) => v) }).toEqual({ outcomes, separating: expect.arrayContaining([JS_RELEASE_VERSION]) });
    // REV23 contract-compat-02: the 0.1.0 screens show the answer's message, and a restart fetches the update.
    expect({ code: retired.body.code, message: retired.body.message }).toEqual({
      code: 'APP_RESTART_TO_UPDATE',
      message: 'Close the app and open it again to update.',
    });
  });
});
