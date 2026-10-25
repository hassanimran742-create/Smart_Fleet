/**
 * [review23 holder-scans-06, REFUTED] ADR-13: "What is given and what is taken back are two separate lists.
 * A cylinder given on a visit can't be taken back on the same visit" (the owner's same-cylinder swap
 * loophole). The check (`SCAN_GIVEN_THIS_VISIT`) reads the GIVEN rows of the current stop only. The review
 * found that two orders of one customer on one run (assign-driver v2 appends the second order to the
 * driver's PLANNED trip) are two stops at the same door, so the cylinder given on the first can be taken
 * back on the second.
 *
 * The verifier refuted it: the rule is documented per visit (§9.2 TAKE_BACK "Not given on this visit",
 * ADR-13 "on the same visit", TEST_CASES DRV-027 step 4 expects 201 on a later visit: "the rule is per
 * visit"), and a visit is a DELIVERY stop (§9.3), one per order. This test pins that documented behaviour.
 * Widening the rule to every stop of one customer on one run is an owner's rule change (ADR-13, §9.2,
 * DRV-027) and would flip the last assertion.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

describeDb('review23 holder-scans: a cylinder given at one stop and taken back at the next stop of the same customer', () => {
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

  it('REV23 holder-scans-06 (refuted) the swap rule is per visit: refused on the visit that gave it, accepted at her next visit of the run', async () => {
    const { std, scans } = w;
    // Ahmed Gas places two orders for Sana: 1 x 11.8 kg, then 1 x 11.8 kg with 1 back.
    const first = await w.placeOrder([{ size: '11.8', full: 1 }]);
    const second = await w.placeOrder([{ size: '11.8', full: 1, back: 1 }]);
    const t1 = await w.assign(first, std.DR1);
    const t2 = await w.assign(second, std.DR1);
    expect(t2.id).toBe(t1.id); // appended: one run, two stops at Sana's door
    await w.load(std.DR1, t1, [1, 2]);
    await w.doneLoading(std.DR1, t1);

    await w.hand(std.DR1, t1, first, [1]);
    // On the visit that gave it, AG-C0001 can't come back (ADR-13, §9.2 TAKE_BACK).
    const firstStop = await t1.stopFor(first.id);
    const same = await scans.tripScan(std.DR1, t1.id, { stopId: firstStop, action: 'TAKE_BACK', code: w.ag(1).qrCode, returnState: 'EMPTY' });
    expect({ status: same.status, code: same.body.code }).toEqual({ status: 409, code: 'SCAN_GIVEN_THIS_VISIT' });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id, state: 'FULL' });
    expect((await w.finishVisit(std.DR1, t1, first)).status).toBe(200);

    // Her second order is its own visit, so the rule doesn't reach it (DRV-027 step 4: "the rule is per visit").
    const secondStop = await t1.stopFor(second.id);
    const back = await scans.tripScan(std.DR1, t1.id, { stopId: secondStop, action: 'TAKE_BACK', code: w.ag(1).qrCode, returnState: 'EMPTY' });
    expect(back.status).toBe(201);
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: t1.vehicleId, state: 'EMPTY' });
  });
});
