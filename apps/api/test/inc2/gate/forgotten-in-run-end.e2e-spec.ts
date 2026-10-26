/**
 * Increment 2 gate: a run with a forgotten IN still closes (API_CONTRACT §9.3, §9.5, §9.12; ADR-13).
 *
 * The driver loads two of an order's three cylinders and forgets to scan the third IN at the store, so
 * "Done loading" is refused and, at the door, the hand-over of the third is refused too (no IN, no OUT).
 * The office's manual delivery names the cylinders and hands the third straight from the home store.
 * That order's need is then met on the trip, so "Done loading" and "Finish trip" close the run; the
 * one-holder rule and the money are untouched.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, type World } from '../scan/support/world';

jest.setTimeout(240_000);

const REASON = 'Not scanned IN at the store; the driver called from the door';

describeDb('Inc 2 gate: a forgotten IN still lets the run close', () => {
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

  it("HLD-004 (run end) after a forgotten IN and the office's manual delivery, Done loading and Finish trip close the run", async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const balance = await w.balance();
    const t1 = await w.assign(x1, std.DR1);

    // Kashif loads AG-C0001 and AG-C0031 and leaves without scanning AG-C0002.
    await w.load(std.DR1, t1, [1, 31]);
    const early = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId);
    expect({ status: early.status, code: early.body.code, done: early.body.details?.done, total: early.body.details?.total }).toEqual({
      status: 409,
      code: 'LOAD_INCOMPLETE',
      done: 2,
      total: 3,
    });

    // At Sana's: the two loaded cylinders go over; the third is refused (no IN, no OUT).
    const stopId = await t1.stopFor(x1.id);
    await w.hand(std.DR1, t1, x1, [1, 31]);
    const refused = await scans.tripScan(std.DR1, t1.id, { stopId, action: 'HANDOVER', code: w.ag(2).qrCode });
    expect({ status: refused.status, code: refused.body.code }).toEqual({ status: 409, code: 'SCAN_NOT_ON_YOUR_VAN' });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });

    // The office names all three: the two already given count as named, AG-C0002 comes from the store.
    const manual = await scans.manualDelivery(std.SA1, x1.id, { reason: REASON, cylinders: [1, 2, 31].map((n) => ({ code: w.ag(n).qrCode })) });
    expect(manual.status).toBe(200);
    expect(manual.body).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'MANUAL' });
    for (const n of [1, 2, 31]) expect(await w.holder(n)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    expect(await w.eventCount(2, 'DELIVERED')).toBe(1);
    expect(await w.eventCount(1, 'DELIVERED')).toBe(1);

    // The run closes: the order's three cylinders were handed over on this trip, from the van or the store.
    const done = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId);
    expect(done.status).toBe(200);
    const pickup = await w.db.tripStop.findUniqueOrThrow({ where: { id: t1.pickupStopId } });
    expect(pickup.status).toBe('DONE');
    const finished = await scans.finishTrip(std.DR1, t1.id, {});
    expect(finished.status).toBe(200);
    expect(finished.body.status).toBe('COMPLETED');

    // No money moved after placement, and the wallet check is clean.
    expect(await w.balance()).toBe(balance);
    expect(await w.db.ledgerEntry.count({ where: { orderId: x1.id } })).toBe(1);
    await w.walletClean();
  });

  it("HLD-004 (run end) when everything was loaded, the office's manual delivery from the van also leaves the run closable, each need counted once", async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    // Everything loaded; the office still delivers by hand (the driver's phone died at the door).
    await w.load(std.DR1, t1, [1, 2, 31]);
    const manual = await scans.manualDelivery(std.SA1, x1.id, { reason: REASON, cylinders: [1, 2, 31].map((n) => ({ code: w.ag(n).qrCode })) });
    expect(manual.status).toBe(200);
    const done = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId);
    expect(done.status).toBe(200);
    const progress = await scans.trip(std.DR1, t1.id).expect(200);
    const pickup = (progress.body.stops as Array<{ type: string; progress: { doneCount: number; neededCount: number } }>).find((s) => s.type === 'STORE_PICKUP');
    expect(pickup?.progress).toMatchObject({ doneCount: 3, neededCount: 3 });
    expect((await scans.finishTrip(std.DR1, t1.id, {})).status).toBe(200);
    await w.walletClean();
  });
});
