/**
 * [Inc 3] The retirements (API_CONTRACT §10.1 "Retired", §10.4, Appendix A): the Inc 1 count steps answer
 * 410 REFILL_USE_SCANS and the office's "Mark complete" 410 REFILL_AUTO_COMPLETES, changing nothing; the
 * stations keep sending a "0" price to every app version; and the driver's old reconciliation form answers
 * 410 RECONCILIATION_RETIRED (the day-end sheet replaces it).
 */
import type { INestApplication } from '@nestjs/common';
import {  createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { resetDb } from '../../helpers/db';
import { http } from '../../helpers/http';
import { authHeader } from '../../helpers/auth';
import { API, buildRefillWorld, type RefillWorld } from './support/refill-world';

jest.setTimeout(180_000);

describeDb('inc3 refills: retired routes', () => {
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

  it('REF-024 Old count-based refill routes answer 410 after the scan release', async () => {
    const { std, db, refills } = w;
    await w.empty(1, 2);
    await db.$executeRaw`UPDATE filling_stations SET price_per_cylinder_paisa = 50000 WHERE id = ${w.station.id}::uuid`;
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    await w.pickup(std.DR1, r1, 2).expect(201);
    const before = await db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } });
    const eventsBefore = await db.cylinderEvent.count();
    const ledger = await w.ledgerCount();

    // Step 1 (the 0.1.0 driver app's calls, FillingOrdersScreen.tsx).
    for (const [step, body] of [
      ['picked-empties', { emptyCount: 2 }],
      ['at-station', {}],
      ['filled', { filledCount: 2 }],
      ['returned', {}],
    ] as const) {
      const res = await refills.legacyStep(std.DR1, r1.id, step, body).expect(410);
      expect({ step, code: res.body.code, message: res.body.message }).toEqual({ step, code: 'REFILL_USE_SCANS', message: 'Update the app to continue.' });
    }
    // Another driver still gets 404 (the refill isn't theirs), and the office 403 (driver routes).
    expect((await refills.legacyStep(std.DR2, r1.id, 'picked-empties', { emptyCount: 2 }).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await refills.legacyStep(std.SA1, r1.id, 'at-station').expect(403)).body.code).toBe('PERMISSION_DENIED');

    // Step 2.
    const complete = await refills.complete(std.SA1, r1.id).expect(410);
    expect(complete.body).toMatchObject({ code: 'REFILL_AUTO_COMPLETES', message: 'Refills now finish by themselves when the store scans them in.' });
    expect((await refills.complete(std.DR1, r1.id).expect(403)).body.code).toBe('PERMISSION_DENIED');

    // Step 3.
    const view = await refills.get(std.SA1, r1.id).expect(200);
    expect(view.body).toMatchObject({ status: 'ASSIGNED', counts: { picked: 2, filled: 0, received: 0 }, pickedUpEmptyCount: null, filledCount: null, completedAt: null });
    const after = await db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } });
    expect(after).toEqual(before);
    expect(await db.cylinderEvent.count()).toBe(eventsBefore);
    expect(await db.auditLog.count({ where: { action: 'refill.complete' } })).toBe(0);
    for (const version of ['0.2.0', '0.1.0']) {
      const stations = await http(app).get(`${API}/filling-stations`).set(authHeader(std.DA.actor)).set('X-App-Version', version).expect(200);
      const listed = (stations.body as Array<Record<string, unknown>>).find((station) => station.id === w.station.id);
      expect({ version, price: listed?.pricePerCylinderPaisa, legacy: listed?.price_per_cylinder_paisa }).toEqual({ version, price: '0', legacy: '0' });
    }
    expect(await w.ledgerCount()).toBe(ledger);
  });

  it('REF-031 The old reconciliation form is retired: POST /reconciliations answers 410', async () => {
    const { std, db } = w;
    const rows = await db.reconciliation.count();
    const balance = await w.balance();

    // Step 1 (the body the driver's Reconcile screen sends).
    const res = await w
      .as(std.DR1)
      .post('/reconciliations')
      .send({ forDate: '2026-10-22', submittedCashPaisa: 125000, cylindersDelivered: 6, cylindersReturned: 4 })
      .expect(410);
    expect(res.body).toMatchObject({ code: 'RECONCILIATION_RETIRED', message: 'The day-end sheet replaces this form.' });

    // Step 2.
    expect(await db.reconciliation.count()).toBe(rows);
    expect(await w.balance()).toBe(balance);
    // The route stays the driver's: other roles are still refused first (403).
    for (const who of [std.SA1, std.DA]) {
      expect((await w.as(who).post('/reconciliations').send({ forDate: '2026-10-22', submittedCashPaisa: 0, cylindersDelivered: 0, cylindersReturned: 0 }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    await w.walletClean();
  });
});
