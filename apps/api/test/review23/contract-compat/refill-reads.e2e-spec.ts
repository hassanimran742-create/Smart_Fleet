/**
 * REVIEW23 (contract-compat): two Inc 3 refill reads the new screens rely on.
 *
 * - `GET /store/incoming` (§9.4, §9.13; UX_MOBILE §7.3), REV23-CC-05 (contract-compat-03, REFUTED): the
 *   review held that empties the driver has just picked up for a refill, on their way out to the station,
 *   shouldn't be "coming back". The verifier refuted it: G08-09 (settled) lists every cylinder on an open
 *   refill line, picked up or filled, with `came` REFILL, and §10.1 completes a refill at the receive that
 *   leaves no picked line un-received, filled or not (the receive is also how a wrong pickup is undone).
 *   The test pins that documented behaviour; "Out for refill" outside the count would be an owner's design
 *   change (G08-09, §9.4, UX_MOBILE §7.3).
 * - `GET /filling-orders` (office), REV23-CC-06 (contract-compat-06): the website's Refills page used to
 *   build its "Needs a driver" tab from one capped bare array, while Today's "Refills need a driver" card
 *   counts every PENDING refill. The bare array now keeps every open refill (and the page reads one tab at
 *   a time).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { refillCalls } from '../../helpers/inc3-calls';
import { createRefill, createStation } from '../../helpers/refills';
import { buildWorld, type World } from '../../inc2/scan/support/world';

jest.setTimeout(240_000);

describeDb('REVIEW23 contract-compat: Inc 3 refill reads', () => {
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

  it('REV23-CC-05 (contract-compat-03, refuted) empties picked up for a refill are listed as coming back from a refill, and receiving them completes it unfilled', async () => {
    const { std } = w;
    const refills = refillCalls(app);
    await w.markState(3, 'EMPTY');
    await w.markState(4, 'EMPTY');
    const station = await createStation();
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, station, assignTo: std.DR1 });

    // Kashif picks up the two empties at Ahmed Gas's store; he hasn't even left the store.
    for (const n of [3, 4]) {
      await refills.scan(std.DR1, refill.id, { phase: 'PICKUP', code: w.ag(n).qrCode }).expect(201);
    }

    // The shop's Home polls this. G08-09: a cylinder on an open refill line, picked up or filled, is listed
    // with came REFILL (it will come back through the store).
    const incoming = await w.as(std.DA).get('/store/incoming').expect(200);
    const listed = incoming.body.vans.flatMap((van: { cylinders: Array<{ shortCode: string; came: string }> }) => van.cylinders);
    expect(listed.map((c: { shortCode: string; came: string }) => ({ shortCode: c.shortCode, came: c.came }))).toEqual([
      { shortCode: 'AG-C0003', came: 'REFILL' },
      { shortCode: 'AG-C0004', came: 'REFILL' },
    ]);

    // §10.1: the store receive that leaves no picked line un-received completes the refill, whether or not
    // every cylinder was filled; the driver can't pick up for it again.
    for (const n of [3, 4]) expect((await w.receive(n)).status).toBe(201);
    const after = await refills.get(std.DA, refill.id).expect(200);
    expect({ status: after.body.status, filled: after.body.counts.filled, received: after.body.counts.received }).toEqual({ status: 'COMPLETED', filled: 0, received: 2 });
    const again = await refills.scan(std.DR1, refill.id, { phase: 'PICKUP', code: w.ag(3).qrCode });
    expect({ status: again.status, code: again.body.code }).toEqual({ status: 409, code: 'REFILL_WRONG_STEP' });
    expect((await w.as(std.DA).get('/store/incoming').expect(200)).body.vans).toEqual([]);
  });

  it('REV23-CC-06 the office Refills list still shows the oldest refill waiting for a driver once there are 200 newer ones', async () => {
    const { std } = w;
    const station = await createStation();
    const waiting = await createRefill({
      distributor: std.DA,
      cylinderTypeId: std.sizes.kg11_8,
      requestedCount: 2,
      station,
      createdAt: new Date(Date.now() - 40 * 24 * 3600_000),
    });
    for (let i = 0; i < 200; i++) {
      await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, station, status: 'COMPLETED' });
    }

    const today = await w.as(std.SA1).get('/admin/summary').expect(200);
    expect(today.body.refills.needsDriver).toBe(1);

    // The website's Refills page (features/refills/api.ts:33) sorts this array into its tabs.
    const list = await w.as(std.SA1).get('/filling-orders').expect(200);
    expect(list.body.map((row: { id: string }) => row.id)).toContain(waiting.id);
  });
});
