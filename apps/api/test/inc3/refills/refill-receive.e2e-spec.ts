/**
 * [Inc 3] The return is the store's receive scan (API_CONTRACT §10.1, §9.2 STORE_RECEIVE, §9.4): VAN → STORE
 * with the refill on the event, FULL when the line was filled, the line RETURNED, and the refill COMPLETED
 * in the same transaction as its last receive, filled or not (G08-07), with `refill.complete` (actor SYSTEM)
 * and no money. The store's views name the refill: `came: REFILL` in GET /store/incoming, `refill` in the
 * cylinder history, and the 03:00 van check leaves refill cylinders out (§9.9).
 *
 * These need the custody wiring this lane asked the gate for (ScanService.storeScanTx → refill-receive.ts,
 * van.ts, van-check.job.ts, store.service.ts, history.service.ts), so they wait on the gate.
 */
import type { INestApplication } from '@nestjs/common';
import {  VanCheckJob } from '../../../src/modules/custody/van-check.job';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { resetDb } from '../../helpers/db';
import { refillLines } from '../../helpers/refills';
import { recordMove } from '../../helpers/runs';
import { buildRefillWorld, scanId, type RefillWorld } from './support/refill-world';

jest.setTimeout(180_000);

describeDb('inc3 refills: the store receives them back', () => {
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

  /** A refill of AG-C0001 and AG-C0002 run by Kashif up to "Leave station", both filled (the REF-020 start). */
  async function filledRefill() {
    const { std } = w;
    await w.empty(1, 2);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    await w.pickup(std.DR1, r1, 2).expect(201);
    await w.advance(std.DR1, r1, 'EMPTIES_PICKED').expect(200);
    await w.fill(std.DR1, r1, 1).expect(201);
    await w.fill(std.DR1, r1, 2).expect(201);
    await w.advance(std.DR1, r1, 'FILLED').expect(200);
    return r1;
  }

  it('REF-017 The store receives end the run: the refill completes when every picked cylinder is back, filled or not', async () => {
    const { std } = w;
    await w.empty(1, 2, 7);
    const r = await w.refill({ count: 3, assignTo: std.DR1 });
    await w.pickup(std.DR1, r, 1).expect(201);
    await w.pickup(std.DR1, r, 2).expect(201);
    await w.advance(std.DR1, r, 'EMPTIES_PICKED').expect(200);
    await w.fill(std.DR1, r, 1).expect(201);
    await w.advance(std.DR1, r, 'FILLED').expect(200);

    // Step 7.
    const one = await w.receive(1).expect(201);
    expect(one.body.cylinder).toMatchObject({ shortCode: 'AG-C0001', state: 'FULL', holder: { type: 'STORE', label: 'Ahmed Gas Store' } });
    const half = await w.refills.get(std.DA, r.id).expect(200);
    expect(half.body).toMatchObject({ status: 'FILLED', stage: 'BACK_AT_STORE', counts: { picked: 2, filled: 1, received: 1 } });
    const two = await w.receive(2).expect(201);
    expect(two.body.cylinder).toMatchObject({ shortCode: 'AG-C0002', state: 'EMPTY', holder: { type: 'STORE' } });
    const done = await w.refills.get(std.DA, r.id).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', stage: 'DONE', counts: { requested: 3, picked: 2, filled: 1, received: 2 } });
    expect(done.body.completedAt).toEqual(expect.any(String));
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'EMPTY' });
    expect(await w.holder(7)).toMatchObject({ custodyType: 'STORE', state: 'EMPTY' });
    const lines = await refillLines(r.id);
    expect(lines.map((line) => [line.cylinderId, line.status, line.filledAt !== null])).toEqual([
      [w.ag(1).id, 'RETURNED', true],
      [w.ag(2).id, 'RETURNED', false],
    ]);
  });

  it("REF-020 The store's receive scans make the cylinders full and complete the refill, with no money", async () => {
    const { std, db } = w;
    const r1 = await filledRefill();
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId, state: 'EMPTY' });
    expect(await w.balance()).toBe(500_000n);
    const ledger = await w.ledgerCount();
    const statementBefore = (await w.as(std.DA).get('/wallet/statement').expect(200)).body;

    // Step 1.
    const first = await w.receive(1).expect(201);
    expect(first.body).toMatchObject({
      result: 'RECORDED',
      scan: { action: 'STORE_RECEIVE' },
      cylinder: { shortCode: 'AG-C0001', state: 'FULL', holder: { type: 'STORE', label: 'Ahmed Gas Store' } },
      stop: null,
      fromVan: { plateNo: 'LEA-101', driver: { id: std.DR1.id, name: 'Kashif' } },
    });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });
    const receive = await db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: 'SCAN_IN' } });
    expect(receive).toMatchObject({
      fromCustodyType: 'VEHICLE',
      fromCustodyId: std.DR1.vehicleId,
      toCustodyType: 'STORE',
      toCustodyId: std.DA.homeStoreId,
      fromState: 'EMPTY',
      toState: 'FULL',
      fillingOrderId: r1.id,
      tripId: null,
      actorUserId: std.DA.userId,
    });
    const line1 = (await refillLines(r1.id)).find((line) => line.cylinderId === w.ag(1).id);
    expect(line1).toMatchObject({ status: 'RETURNED' });
    expect(line1?.returnedAt?.getTime()).toBe(receive.createdAt.getTime());
    expect(line1?.filledAt).not.toBeNull();

    // Step 2.
    const half = await w.refills.get(std.DA, r1.id).expect(200);
    expect(half.body).toMatchObject({ status: 'FILLED', stage: 'BACK_AT_STORE', counts: { picked: 2, filled: 2, received: 1 }, completedAt: null });

    // Step 3.
    await w.receive(2).expect(201);
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', state: 'FULL' });

    // Step 4.
    const done = await w.refills.get(std.DA, r1.id).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', stage: 'DONE', counts: { picked: 2, filled: 2, received: 2 } });
    const last = await db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(2).id, eventType: 'SCAN_IN' } });
    // Completed in the same transaction as the last receive: one instant for the event, the line and the refill.
    expect(Date.parse(done.body.completedAt)).toBe(last.createdAt.getTime());
    const audits = await w.as(std.SA1).get('/audit-logs?action=refill.complete').expect(200);
    expect(audits.body.items).toHaveLength(1);
    expect(audits.body.items[0]).toMatchObject({
      action: 'refill.complete',
      actor: { kind: 'SYSTEM', label: 'scan:store-receive' },
      resourceType: 'refill',
      resourceId: r1.id,
      distributorId: std.DA.id,
      diff: { refill: 'AG-R001', picked: 2, filled: 2, receivedBy: std.DA.userId, eventId: last.id },
    });
    // No money: the ledger, the balance and the statement are as they were; there is no DEBIT_REFILL.
    expect(await w.ledgerCount()).toBe(ledger);
    expect(await db.ledgerEntry.count({ where: { OR: [{ entryType: 'DEBIT_REFILL' }, { fillingOrderId: { not: null } }] } })).toBe(0);
    const office = await w.as(std.SA1).get(`/admin/distributors/${std.DA.id}/wallet`).expect(200);
    expect(office.body).toMatchObject({ balancePaisa: '500000', integrity: { ok: true } });
    const statement = (await w.as(std.DA).get('/wallet/statement').expect(200)).body;
    expect(statement).toEqual(statementBefore);
    expect(JSON.stringify(statement)).not.toContain('REFILL');
    await w.walletClean();
  });

  it('REF-021 A repeated scan is recorded once, and a reused scan ID is refused (the store receives)', async () => {
    const { std, db } = w;
    const r1 = await filledRefill();
    const T1 = scanId();

    // Step 5.
    await w.receive(1, T1).expect(201);
    const resend = await w.receive(1, T1).expect(200);
    expect(resend.headers['idempotent-replay']).toBe('true');
    expect(resend.body).toMatchObject({ result: 'ALREADY_RECORDED', scan: { scanId: T1, action: 'STORE_RECEIVE' } });
    const counts = async () => (await w.refills.get(std.DA, r1.id).expect(200)).body.counts;
    expect((await counts()).received).toBe(1);
    expect(await db.cylinderEvent.count({ where: { cylinderId: w.ag(1).id, eventType: 'SCAN_IN' } })).toBe(1);
    expect((await refillLines(r1.id)).filter((line) => line.status === 'RETURNED')).toHaveLength(1);
    // The receive's scan id used for another cylinder is refused.
    expect((await w.receive(2, T1).expect(409)).body.code).toBe('SCAN_ID_REUSED');

    // Step 6.
    const again = await w.receive(1, scanId()).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body.result).toBe('ALREADY_RECORDED');
    expect(await db.cylinderEvent.count({ where: { cylinderId: w.ag(1).id, eventType: 'SCAN_IN' } })).toBe(1);
    expect((await counts()).received).toBe(1);
    expect((await db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe('FILLED');
  });

  it('REF-020 Two phones scanning in the last two cylinders at once complete the refill exactly once', async () => {
    const { std, db } = w;
    const r1 = await filledRefill();
    const [a, b] = await Promise.all([w.receive(1), w.receive(2)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const row = await db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } });
    expect(row.status).toBe('COMPLETED');
    expect(await db.auditLog.count({ where: { action: 'refill.complete', resourceId: r1.id } })).toBe(1);
    expect((await refillLines(r1.id)).map((line) => line.status)).toEqual(['RETURNED', 'RETURNED']);
    for (const n of [1, 2]) expect(await w.holder(n)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });
  });

  it('REF-020 A cylinder brought back before the station keeps its state, and the refill completes once nothing is left out', async () => {
    const { std, db } = w;
    await w.empty(1);
    await w.markState(2, 'PART_FILLED');
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    await w.pickup(std.DR1, r1, 2).expect(201);
    // The driver hands one back at the store before leaving: its line is RETURNED, the refill stays open.
    const back = await w.receive(2).expect(201);
    expect(back.body.cylinder.state).toBe('PART_FILLED');
    expect((await db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe('ASSIGNED');
    const view = await w.refills.get(std.DR1, r1.id).expect(200);
    expect(view.body).toMatchObject({ counts: { picked: 2, received: 1 }, allowedActions: ['LEAVE_STORE'] });
    // The other one comes back too, unfilled ("Bring back unfilled"): the refill completes from ASSIGNED.
    await w.receive(1).expect(201);
    const done = await w.refills.get(std.DA, r1.id).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', stage: 'DONE', counts: { picked: 2, filled: 0, received: 2 } });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE', state: 'EMPTY' });
  });

  it('REF-016 A cylinder the store took back off the refill van can be picked up again: its one line opens again, never twice', async () => {
    const { std, db } = w;
    await w.empty(1, 2, 3);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    await w.pickup(std.DR1, r1, 2).expect(201);
    await w.receive(2).expect(201);
    // The request is full: a third cylinder is refused, but AG-C0002 itself may go again.
    expect((await w.pickup(std.DR1, r1, 3).expect(409)).body.code).toBe('REFILL_COUNT_REACHED');
    const again = await w.pickup(std.DR1, r1, 2).expect(201);
    expect(again.body.refill).toMatchObject({ status: 'ASSIGNED', picked: 2, received: 0 });
    const lines = await refillLines(r1.id);
    expect(lines.map((line) => [line.cylinderId, line.status, line.returnedAt])).toEqual(
      expect.arrayContaining([
        [w.ag(1).id, 'PICKED_UP', null],
        [w.ag(2).id, 'PICKED_UP', null],
      ]),
    );
    expect(lines).toHaveLength(2);
    expect(await db.fillingOrderCylinder.count({ where: { cylinderId: w.ag(2).id } })).toBe(1);
  });

  it('REF-014 The cylinder history names the refill of each refill move, and the store sees refill vans as REFILL', async () => {
    const { std, scans } = w;
    await w.empty(1, 2);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    await w.pickup(std.DR1, r1, 2).expect(201);
    await w.advance(std.DR1, r1, 'EMPTIES_PICKED').expect(200);
    await w.fill(std.DR1, r1, 1).expect(201);

    // GET /store/incoming: the refill van, its cylinders with came REFILL and the refill's number.
    const incoming = await scans.storeIncoming(std.DA).expect(200);
    expect(incoming.body.vans).toHaveLength(1);
    expect(incoming.body.vans[0]).toMatchObject({ vehicle: { plateNo: 'LEA-101' }, driver: { id: std.DR1.id, name: 'Kashif' }, trip: null });
    const onVan = [...(incoming.body.vans[0].cylinders as Array<{ shortCode: string }>)].sort((a, b) => a.shortCode.localeCompare(b.shortCode));
    expect(onVan).toEqual([
      { shortCode: 'AG-C0001', sizeLabel: '11.8 kg', state: 'EMPTY', came: 'REFILL', from: null, refill: { shortCode: 'AG-R001' } },
      { shortCode: 'AG-C0002', sizeLabel: '11.8 kg', state: 'EMPTY', came: 'REFILL', from: null, refill: { shortCode: 'AG-R001' } },
    ]);
    expect(incoming.body.vans[0].counts).toMatchObject({ total: 2, received: 0 });

    await w.receive(1).expect(201);
    const history = await scans.cylinderHistory(std.DA, '1').expect(200);
    expect((history.body.events as Array<{ action: string; refill: unknown; order: unknown }>).map((event) => [event.action, event.refill, event.order])).toEqual([
      ['REGISTERED', null, null],
      ['SCAN_OUT', { shortCode: 'AG-R001' }, null],
      ['FILLED', { shortCode: 'AG-R001' }, null],
      ['SCAN_IN', { shortCode: 'AG-R001' }, null],
    ]);
    expect(history.body.holder).toMatchObject({ type: 'STORE', responsible: null });
  });

  it('REF-022 The 03:00 van check leaves cylinders on an open refill line out', async () => {
    const { std, db } = w;
    await w.empty(1);
    const r1 = await w.refill({ count: 1, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    const run = await app.get(VanCheckJob).run();
    expect(run).toEqual({ vans: 0, plates: [] });
    expect(await db.alert.count({ where: { alertType: 'VAN_NOT_EMPTY' } })).toBe(0);
    // Any other cylinder left on the van still raises it, counted without the refill one.
    await w.markState(3, 'EMPTY');
    await recordMove({
      cylinderId: w.ag(3).id,
      eventType: 'SCAN_OUT',
      actorUserId: std.DR1.userId,
      from: { type: 'STORE', id: std.DA.homeStoreId },
      to: { type: 'VEHICLE', id: std.DR1.vehicleId as string },
      fromState: 'EMPTY',
      toState: 'EMPTY',
    });
    expect(await app.get(VanCheckJob).run()).toEqual({ vans: 1, plates: ['LEA-101'] });
    const alert = await db.alert.findFirstOrThrow({ where: { alertType: 'VAN_NOT_EMPTY' } });
    expect(alert.context).toMatchObject({ plateNo: 'LEA-101', count: 1 });
  });
});
