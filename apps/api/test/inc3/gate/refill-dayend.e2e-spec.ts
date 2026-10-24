/**
 * [Inc 3 gate] Refills and day-end together (API_CONTRACT §10.1, §10.2, §10.4; TEST_CASES FEE-028):
 * - FEE-028: a refill run on scans that the store's receives complete, and a day-end approval, move no money;
 * - an approved MOVE_TO_STORE fix of a cylinder still on an open refill line brings it back for its refill, as
 *   the store's receive would: the line is RETURNED and the last one completes the refill (refill.complete,
 *   SYSTEM `day-end:approve`); a SET_STATE fix keeps the cylinder on the van and its line open.
 */
import type { INestApplication } from '@nestjs/common';
import { CylinderEventSource, CylinderEventType, CylinderState } from '@prisma/client';
import { randomUUID } from 'crypto';
import { authHeader } from '../../helpers/auth';
import { walletMismatches } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { refillCalls, type RefillCalls } from '../../helpers/inc3-calls';
import { createStation, refillLines, type TestStation } from '../../helpers/refills';
import { setCylinderState } from '../../helpers/runs';
import { API, BOOT_TIMEOUT_MS, CASE_TIMEOUT_MS, D21, approve, createDayEndApp, freshWorld, holderOf, submittedDay, type DayWorld } from '../dayend/support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('inc3 gate: refills and day-end together move no money', () => {
  let app: INestApplication;
  let w: DayWorld;
  let refills: RefillCalls;
  let station: TestStation;

  beforeAll(async () => {
    app = await createDayEndApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    w = await freshWorld(app);
    refills = refillCalls(app);
    station = await createStation();
  });

  const office = () => http(app);
  const balanceOf = async () => (await w.db.distributor.findUniqueOrThrow({ where: { id: w.std.DA.id } })).advanceBalancePaisa;
  const ledgerOf = () => w.db.ledgerEntry.count({ where: { distributorId: w.std.DA.id } });
  const audits = async (action: string) =>
    (await office().get(`${API}/audit-logs?action=${action}`).set(authHeader(w.std.SA1.actor)).expect(200)).body.items as Array<Record<string, unknown>>;

  /** Ahmed Gas asks for a refill of `count` × 11.8 kg and the office gives it to Kashif. */
  async function assignedRefill(count: number): Promise<string> {
    const created = await refills
      .create(w.std.DA, { fillingStationId: station.id, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: count }, randomUUID())
      .expect(201);
    expect(created.body).toMatchObject({ shortCode: 'AG-R001', status: 'PENDING' });
    await refills.assign(w.std.SA1, created.body.id, w.std.DR1.id).expect(200);
    return created.body.id as string;
  }

  it('FEE-028 Inc 3: a refill finished by store receive scans and a day-end approval move no money', async () => {
    // Before: two of Ahmed Gas's 11.8 kg cylinders are EMPTY in its store; the balance and ledger rows noted.
    await setCylinderState(w.ag(1).id, CylinderState.EMPTY);
    await setCylinderState(w.ag(2).id, CylinderState.EMPTY);
    const balance = await balanceOf();
    const ledger = await ledgerOf();
    expect(balance).toBe(500_000n);

    // Step 1: the request, and the office assigns Kashif.
    const id = await assignedRefill(2);

    // Step 2: pickup both, Leave store, fill both, Leave station.
    for (const n of [1, 2]) await refills.scan(w.std.DR1, id, { phase: 'PICKUP', code: w.ag(n).qrCode }).expect(201);
    await refills.advance(w.std.DR1, id, 'EMPTIES_PICKED').expect(200);
    for (const n of [1, 2]) await refills.scan(w.std.DR1, id, { phase: 'FILL', code: w.ag(n).qrCode }).expect(201);
    expect((await refills.advance(w.std.DR1, id, 'FILLED').expect(200)).body.status).toBe('FILLED');

    // Step 3: the shop receives both; the last receive completes the refill. The office's complete is retired.
    await w.scans.storeScan(w.std.DA, { code: w.ag(1).qrCode }).expect(201);
    expect((await refills.get(w.std.DA, id).expect(200)).body.status).toBe('FILLED');
    const last = await w.scans.storeScan(w.std.DA, { code: w.ag(2).qrCode }).expect(201);
    expect(last.body.cylinder).toMatchObject({ shortCode: 'AG-C0002', state: 'FULL', holder: { type: 'STORE' } });
    expect((await refills.get(w.std.DA, id).expect(200)).body).toMatchObject({ status: 'COMPLETED', counts: { picked: 2, filled: 2, received: 2 } });
    const complete = await refills.complete(w.std.SA1, id).expect(410);
    expect(complete.body.code).toBe('REFILL_AUTO_COMPLETES');
    const done = await audits('refill.complete');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ actor: { kind: 'SYSTEM', label: 'scan:store-receive' }, resourceType: 'refill', resourceId: id });

    // Step 4: today's day-end sheet with one row changed, uploaded and submitted; the office approves it.
    const day = await submittedDay(w, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } });
    const approved = await approve(w, day.id, day.version);
    expect(approved.body.day).toMatchObject({ businessDate: D21, status: 'APPROVED', stage: 'APPROVED' });
    const row = await w.db.dayClose.findUniqueOrThrow({ where: { id: day.id } });
    expect(row.lockedAt).not.toBeNull();
    expect(await holderOf(w.db, w.ag(5).id)).toMatchObject({ custodyType: 'STORE', state: 'FAULTY' });

    // Step 5: the balance and the ledger rows are exactly as at the start.
    expect(await balanceOf()).toBe(balance);
    expect(await ledgerOf()).toBe(ledger);
    expect(await w.db.ledgerEntry.count({ where: { OR: [{ entryType: 'DEBIT_REFILL' }, { fillingOrderId: { not: null } }] } })).toBe(0);
    expect(await walletMismatches()).toEqual([]);
  });

  it('DAY-009 (gate) an approved "In my store" fix of a cylinder still on an open refill line returns its line and completes the refill', async () => {
    // AG-C0001 and AG-C0002 picked up for AG-R001 and filled; AG-C0002 is received by scan, AG-C0001 isn't.
    await setCylinderState(w.ag(1).id, CylinderState.EMPTY);
    await setCylinderState(w.ag(2).id, CylinderState.EMPTY);
    const id = await assignedRefill(2);
    for (const n of [1, 2]) await refills.scan(w.std.DR1, id, { phase: 'PICKUP', code: w.ag(n).qrCode }).expect(201);
    await refills.advance(w.std.DR1, id, 'EMPTIES_PICKED').expect(200);
    for (const n of [1, 2]) await refills.scan(w.std.DR1, id, { phase: 'FILL', code: w.ag(n).qrCode }).expect(201);
    await refills.advance(w.std.DR1, id, 'FILLED').expect(200);
    await w.scans.storeScan(w.std.DA, { code: w.ag(2).qrCode }).expect(201);
    expect(await holderOf(w.db, w.ag(1).id)).toMatchObject({ custodyType: 'VEHICLE', state: 'EMPTY' });
    const ledger = await ledgerOf();

    // The shop counts AG-C0001 in its store (no state given) and the office approves.
    const day = await submittedDay(w, { 'AG-C0001': { where: 'In my store', why: 'Back from the station, not scanned' } });
    const review = await w.calls.adminDay(w.std.SA1, day.id).expect(200);
    expect(review.body.fixesToApply.map((line: { shortCode: string; fix: string }) => [line.shortCode, line.fix])).toEqual([['AG-C0001', 'MOVE_TO_STORE']]);
    await approve(w, day.id, day.version);

    // In the store, FULL as its filled line says (the receive's rule), by one ADJUSTED move that names the refill.
    expect(await holderOf(w.db, w.ag(1).id)).toMatchObject({ custodyType: 'STORE', custodyId: w.std.DA.homeStoreId, state: 'FULL' });
    const fix = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: CylinderEventType.ADJUSTED } });
    expect(fix).toMatchObject({
      source: CylinderEventSource.DAY_END_FIX,
      fromCustodyType: 'VEHICLE',
      toCustodyType: 'STORE',
      fromState: 'EMPTY',
      toState: 'FULL',
      fillingOrderId: id,
      reason: 'Back from the station, not scanned',
      actorUserId: w.std.SA1.id,
    });
    // The line is RETURNED at the fix and the refill COMPLETED in the same transaction, with no money.
    const lines = await refillLines(id);
    expect(lines.map((line) => [line.cylinderId, line.status])).toEqual([
      [w.ag(1).id, 'RETURNED'],
      [w.ag(2).id, 'RETURNED'],
    ]);
    expect(lines.find((line) => line.cylinderId === w.ag(1).id)?.returnedAt?.getTime()).toBe(fix.createdAt.getTime());
    const refill = (await refills.get(w.std.DA, id).expect(200)).body;
    expect(refill).toMatchObject({ status: 'COMPLETED', counts: { picked: 2, filled: 2, received: 2 } });
    expect(Date.parse(refill.completedAt)).toBe(fix.createdAt.getTime());
    const completed = await audits('refill.complete');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      actor: { kind: 'SYSTEM', label: 'day-end:approve' },
      resourceId: id,
      diff: { refill: 'AG-R001', picked: 2, filled: 2, receivedBy: w.std.SA1.id, eventId: fix.id },
    });
    // The cylinder history names the refill on the fix, and the van holds nothing of it any more.
    const history = await office().get(`${API}/cylinders/AG-C0001/history`).set(authHeader(w.std.SA1.actor)).expect(200);
    expect(history.body.events.at(-1)).toMatchObject({ source: 'DAY_END_FIX', refill: { shortCode: 'AG-R001' } });
    expect(await ledgerOf()).toBe(ledger);
    expect(await walletMismatches()).toEqual([]);
  });

  it('DAY-009 (gate) a state fix of a refill cylinder on the van keeps its refill line open until the store receives it', async () => {
    await setCylinderState(w.ag(1).id, CylinderState.EMPTY);
    const id = await assignedRefill(1);
    await refills.scan(w.std.DR1, id, { phase: 'PICKUP', code: w.ag(1).qrCode }).expect(201);

    // The shop's count: on the van, but Damaged (a SET_STATE fix: the holder stays the van).
    const day = await submittedDay(w, { 'AG-C0001': { state: 'Damaged', why: 'Kashif says the valve broke' } });
    await approve(w, day.id, day.version);
    expect(await holderOf(w.db, w.ag(1).id)).toMatchObject({ custodyType: 'VEHICLE', state: 'FAULTY' });
    const fix = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: CylinderEventType.ADJUSTED } });
    expect(fix.fillingOrderId).toBeNull();
    expect((await refillLines(id)).map((line) => line.status)).toEqual(['PICKED_UP']);
    expect((await refills.get(w.std.DA, id).expect(200)).body.status).toBe('ASSIGNED');

    // The store's receive later closes the line (a damaged cylinder keeps its state) and completes the refill.
    const back = await w.scans.storeScan(w.std.DA, { code: w.ag(1).qrCode }).expect(201);
    expect(back.body.cylinder).toMatchObject({ state: 'FAULTY', holder: { type: 'STORE' } });
    expect((await refills.get(w.std.DA, id).expect(200)).body.status).toBe('COMPLETED');
    expect(await walletMismatches()).toEqual([]);
  });
});
