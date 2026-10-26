/**
 * [Inc 3] Day-end, the office's side (API_CONTRACT §10.2, DATA_MODEL §5.4; TEST_CASES DAY-007, DAY-009…
 * DAY-015): approval applies every listed fix (never NOTE_ONLY) with its reason, who asked and who
 * approved, in one transaction, skipping cylinders that moved since the sheet; then the day locks. Approve,
 * send-back and reopen have fixed repeat answers, a locked day refuses day-end changes but never a scan,
 * and nothing moves money.
 */
import type { INestApplication } from '@nestjs/common';
import { CylinderEventSource, CylinderEventType } from '@prisma/client';
import { authHeader } from '../../helpers/auth';
import { dayCloseLines, dayCloseOf, karachiTime } from '../../helpers/day-end';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import {
  API,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  D21,
  D22,
  approve,
  byShortCode,
  createDayEndApp,
  download,
  errorOf,
  fill,
  freshWorld,
  holderOf,
  holderSnapshot,
  linesByKey,
  loadScan,
  onVan,
  pinClock,
  receiveScan,
  rowCounts,
  sendSheet,
  sheetRowsByNumber,
  standardFixture,
  submittedDay,
  tripNeeding,
  upload,
  vanOf,
  type DayWorld,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('day-end: approve, send back, reopen and the lock (office)', () => {
  let app: INestApplication;
  let w: DayWorld;

  beforeAll(async () => {
    app = await createDayEndApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    w = await freshWorld(app);
  });

  /** Moves written by an approval: ADJUSTED events, by cylinder id. */
  async function adjustedEvents() {
    return w.db.cylinderEvent.findMany({ where: { eventType: CylinderEventType.ADJUSTED }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  it("DAY-007 extra cylinders: an unknown number is added on approval, and another shop's number is never touched", async () => {
    // DA's next cylinder number is 36; BG-C0001 (11.8 kg, Full) is in Bilal Gas's store.
    expect((await w.db.distributor.findUniqueOrThrow({ where: { id: w.std.DA.id } })).nextCylinderNo).toBe(36);
    expect(await w.db.cylinder.count({ where: { distributorId: w.std.DA.id, shortNo: 99 } })).toBe(0);
    const bg1 = await holderOf(w.db, w.bg(1).id);
    expect(bg1).toMatchObject({ custodyType: 'STORE', custodyId: w.std.DB.homeStoreId, state: 'FULL' });
    const bgEvents = await w.db.cylinderEvent.findMany({ where: { cylinderId: w.bg(1).id } });
    const bgHistory = await http(app).get(`${API}/cylinders/BG-C0001/history`).set(authHeader(w.std.DB.actor)).expect(200);
    const sheet = await download(w);

    // Steps 1-2: the extra numbers AG-C0099 (row 2) and BG-C0001 (row 3).
    const withBilal = await fill(sheet, {}, {
      extra: [
        { number: 'AG-C0099', size: '11.8 kg', state: 'Empty' },
        { number: 'BG-C0001', size: '11.8 kg', state: 'Full' },
      ],
    });
    const refused = await upload(w, withBilal);
    expect(errorOf(refused)).toEqual({ status: 422, code: 'DAY_SHEET_ROW_ERRORS' });
    expect(refused.body.details).toEqual({
      rows: [{ sheet: 'EXTRA', row: 3, code: 'OTHER_SHOP_NUMBER', message: "Another shop's label. Call the office." }],
      total: 1,
    });
    const text = JSON.stringify(refused.body);
    expect(text).not.toContain(w.std.DB.id);
    expect(text).not.toContain(w.bg(1).id);
    expect(text).not.toContain('Bilal');
    expect((await dayCloseOf(w.std.DA.id, D21))?.uploadVersion).toBe(0);

    // Step 3: without the BG-C0001 row.
    const ok = await upload(w, await fill(sheet, {}, { extra: [{ number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }] })).expect(200);
    expect(ok.body.differences).toEqual([
      {
        id: expect.any(String),
        diff: 'UNKNOWN_CYLINDER',
        fix: 'REGISTER',
        shortCode: 'AG-C0099',
        sizeLabel: '11.8 kg',
        app: null,
        sheet: { place: 'STORE', state: 'EMPTY' },
        note: null,
        movedSinceSheet: false,
      },
    ]);
    const day = await dayCloseOf(w.std.DA.id, D21);
    const line = (await linesByKey(day?.id as string)).get('AG-C0099');
    expect(line).toMatchObject({ cylinderId: null, diff: 'UNKNOWN_CYLINDER', cylinderTypeId: w.std.sizes.kg11_8, reportedState: 'EMPTY' });

    // Step 4: sent and approved.
    await w.calls.submit(w.std.DA, D21, { version: ok.body.version }).expect(200);
    const approved = await approve(w, day?.id as string, ok.body.version);
    expect(approved.body.registered).toEqual([
      { id: expect.any(String), code: expect.any(String), shortNo: 36, shortCode: 'AG-C0036', sizeLabel: '11.8 kg' },
    ]);

    // Step 5: a new 11.8 kg Empty AG-C0036 in Ahmed Gas Store with one REGISTERED event; the line keeps the sheet's number.
    const made = await w.db.cylinder.findUniqueOrThrow({ where: { id: approved.body.registered[0].id } });
    expect(made).toMatchObject({
      distributorId: w.std.DA.id,
      cylinderTypeId: w.std.sizes.kg11_8,
      shortNo: 36,
      state: 'EMPTY',
      custodyType: 'STORE',
      custodyId: w.std.DA.homeStoreId,
      qrCode: approved.body.registered[0].code,
    });
    const events = await w.db.cylinderEvent.findMany({ where: { cylinderId: made.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'REGISTERED', source: 'REGISTRATION', toCustodyType: 'STORE', toCustodyId: w.std.DA.homeStoreId, toState: 'EMPTY', actorUserId: w.std.SA1.id });
    expect(made.lastEventId).toBe(events[0].id);
    const after = (await linesByKey(day?.id as string)).get('AG-C0099');
    expect(after).toMatchObject({ sheetKey: 'AG-C0099', cylinderId: null, appliedEventId: events[0].id });
    expect((await w.db.distributor.findUniqueOrThrow({ where: { id: w.std.DA.id } })).nextCylinderNo).toBe(37);
    expect(await w.db.cylinder.count({ where: { distributorId: w.std.DA.id, shortNo: 99 } })).toBe(0);

    // BG-C0001 is untouched, and Bilal Gas's day-end too.
    expect(await holderOf(w.db, w.bg(1).id)).toEqual(bg1);
    expect(await w.db.cylinderEvent.findMany({ where: { cylinderId: w.bg(1).id } })).toEqual(bgEvents);
    expect(await w.db.dayClose.count({ where: { distributorId: w.std.DB.id } })).toBe(0);
    const history = await http(app).get(`${API}/cylinders/BG-C0001/history`).set(authHeader(w.std.DB.actor)).expect(200);
    expect(history.body).toEqual(bgHistory.body);
  });

  it('DAY-009 approval applies every listed fix with its reason, who asked and who approved, locks the day and moves no money', async () => {
    await standardFixture(w);
    // SUBMITTED at version 2 with five differences.
    const d = await submittedDay(
      w,
      {
        'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' },
        'AG-C0010': { where: 'In my store', why: 'Driver left it, not scanned' },
        'AG-C0012': { state: 'Empty', why: 'Used at the shop' },
        'AG-C0013': { where: "On driver's van", why: 'Kashif said he has it' },
        'AG-C0016': { where: 'Missing', why: 'Not found in the store' },
      },
      { versions: 2 },
    );
    expect(d.version).toBe(2);
    const wallet = async () => (await http(app).get(`${API}/admin/distributors/${w.std.DA.id}/wallet`).set(authHeader(w.std.SA1.actor)).expect(200)).body;
    expect((await wallet()).balancePaisa).toBe('500000');
    const counts = await rowCounts(w.db);
    const holders = await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id]);

    // Step 1: the review.
    const review = await w.calls.adminDay(w.std.SA1, d.id).expect(200);
    expect(review.body).toMatchObject({
      id: d.id,
      businessDate: D21,
      distributor: { id: w.std.DA.id, businessName: 'Ahmed Gas' },
      status: 'SUBMITTED',
      stage: 'WAITING_FOR_APPROVAL',
      version: 2,
      differences: 5,
      uploadedBy: { id: w.std.DA.userId, name: 'Ahmed Gas' },
      allowedActions: ['APPROVE', 'SEND_BACK'],
      approvedAt: null,
      approvedBy: null,
    });
    expect(review.body.lines.map((l: { shortCode: string; fix: string }) => [l.shortCode, l.fix])).toEqual([
      ['AG-C0005', 'SET_STATE'],
      ['AG-C0010', 'MOVE_TO_STORE'],
      ['AG-C0012', 'SET_STATE'],
      ['AG-C0013', 'NOTE_ONLY'],
      ['AG-C0016', 'MARK_LOST'],
    ]);
    expect(review.body.fixesToApply.map((l: { shortCode: string }) => l.shortCode)).toEqual(['AG-C0005', 'AG-C0010', 'AG-C0012', 'AG-C0016']);
    for (const l of review.body.lines) expect(l).toMatchObject({ movedSinceSheet: false, lastScanAt: expect.any(String) });
    expect(review.body.files).toEqual({ sheetFileId: expect.any(String), uploadFileId: expect.any(String) });
    expect(byShortCode(review.body.lines as Array<{ shortCode: string }>).get('AG-C0010')).toMatchObject({ app: { place: 'VAN', plateNo: 'LEA-101' } });
    expect(review.body.summary).toMatchObject({ inStore: { total: 32 }, onVans: 1, withCustomers: 1 });

    // Step 2: approve version 2.
    const res = await approve(w, d.id, 2);
    expect(res.headers['x-already-applied']).toBeUndefined();
    expect(res.body.registered).toEqual([]);
    expect(res.body.day).toMatchObject({ id: d.id, status: 'APPROVED', stage: 'APPROVED', allowedActions: ['REOPEN'], approvedBy: { id: w.std.SA1.id, name: 'Owner' } });
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row).toMatchObject({ status: 'APPROVED', approvedByUserId: w.std.SA1.id, uploadedByUserId: w.std.DA.userId });
    expect(row?.lockedAt).toBeInstanceOf(Date);
    expect(row?.approvedAt).toBeInstanceOf(Date);

    // Step 3: four ADJUSTED events (DAY_END_FIX, the sheet's reasons, the approver); AG-C0013 untouched.
    const adjusted = await adjustedEvents();
    expect(adjusted).toHaveLength(4);
    for (const event of adjusted) expect(event).toMatchObject({ source: CylinderEventSource.DAY_END_FIX, actorUserId: w.std.SA1.id });
    const byCylinder = new Map(adjusted.map((event) => [event.cylinderId, event]));
    const store = { custodyType: 'STORE', custodyId: w.std.DA.homeStoreId };
    expect(byCylinder.get(w.ag(5).id)).toMatchObject({ reason: 'Valve leaking', fromState: 'FULL', toState: 'FAULTY', toCustodyType: 'STORE', toCustodyId: w.std.DA.homeStoreId });
    expect(byCylinder.get(w.ag(10).id)).toMatchObject({
      reason: 'Driver left it, not scanned',
      fromCustodyType: 'VEHICLE',
      fromCustodyId: w.std.DR1.vehicleId,
      toCustodyType: 'STORE',
      toCustodyId: w.std.DA.homeStoreId,
      fromState: 'FULL',
      toState: 'FULL',
    });
    expect(byCylinder.get(w.ag(12).id)).toMatchObject({ reason: 'Used at the shop', toState: 'EMPTY' });
    expect(byCylinder.get(w.ag(16).id)).toMatchObject({ reason: 'Not found in the store', toState: 'LOST', toCustodyType: 'STORE', toCustodyId: w.std.DA.homeStoreId });
    expect(await holderOf(w.db, w.ag(5).id)).toMatchObject({ ...store, state: 'FAULTY' });
    expect(await holderOf(w.db, w.ag(10).id)).toMatchObject({ ...store, state: 'FULL' });
    expect(await holderOf(w.db, w.ag(12).id)).toMatchObject({ ...store, state: 'EMPTY' });
    expect(await holderOf(w.db, w.ag(16).id)).toMatchObject({ ...store, state: 'LOST' });
    const lines = await linesByKey(d.id);
    for (const n of [5, 10, 12, 16]) {
      const key = `AG-C${String(n).padStart(4, '0')}`;
      expect(lines.get(key)?.appliedEventId).toBe(byCylinder.get(w.ag(n).id)?.id);
      expect((await holderOf(w.db, w.ag(n).id)).lastEventId).toBe(byCylinder.get(w.ag(n).id)?.id);
    }
    expect(lines.get('AG-C0013')).toMatchObject({ appliedEventId: null, skippedMovedAt: null });
    const fixedIds = new Set([5, 10, 12, 16].map((n) => w.ag(n).id));
    const now = await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id]);
    expect(now.filter((c) => !fixedIds.has(c.id))).toEqual(holders.filter((c) => !fixedIds.has(c.id)));
    expect(await w.db.cylinderEvent.count()).toBe(counts.events + 4);

    // Step 4: the history shows the fix as a day-end fix by Owner, with its reason.
    const history = await http(app).get(`${API}/cylinders/AG-C0005/history`).set(authHeader(w.std.SA1.actor)).expect(200);
    const last = history.body.events[history.body.events.length - 1];
    expect(last).toMatchObject({
      action: 'ADJUSTED',
      source: 'DAY_END_FIX',
      actor: { name: 'Owner', role: 'SUPER_ADMIN' },
      reason: 'Valve leaking',
      from: 'Ahmed Gas Store',
      to: 'Ahmed Gas Store',
      at: byCylinder.get(w.ag(5).id)?.createdAt.toISOString(),
    });
    expect(history.body.cylinder.state).toBe('FAULTY');

    // Step 5: one day.approve row by SA1; no ledger row; the balance and its check unchanged.
    const audit = await http(app).get(`${API}/audit-logs?action=day.approve`).set(authHeader(w.std.SA1.actor)).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0]).toMatchObject({
      actor: { kind: 'USER', userId: w.std.SA1.id },
      resourceType: 'DayClose',
      resourceId: d.id,
      distributorId: w.std.DA.id,
      diff: { applied: 4, skipped: 0, unchanged: 1, registered: 0, version: 2 },
    });
    expect(await w.db.ledgerEntry.count()).toBe(counts.ledger);
    const money = await wallet();
    expect(money.balancePaisa).toBe('500000');
    expect(money.integrity.ok).toBe(true);
    // The DAY_END_SUBMITTED alert is resolved by the approval.
    expect(await w.db.alert.findMany({ where: { alertType: 'DAY_END_SUBMITTED' }, select: { status: true, resolvedByUserId: true } })).toEqual([
      { status: 'RESOLVED', resolvedByUserId: w.std.SA1.id },
    ]);
    // The locked day's summary is the one frozen at approval.
    const shopView = await w.calls.day(w.std.DA, D21).expect(200);
    expect(shopView.body).toMatchObject({ status: 'APPROVED', stage: 'APPROVED', allowedActions: [], summary: { inStore: { total: 32 }, onVans: 0, withCustomers: 1 } });
    expect(row?.totals).toMatchObject({ fixes: { applied: 4, skipped: 0, unchanged: 1, registered: 0 }, cylinders: 35, byPlace: { STORE: 32, VAN: 0, CUSTOMER: 1, NOT_FOUND: 2 } });
  });

  it('DAY-010 approving an old version is refused and changes nothing', async () => {
    const d = await submittedDay(
      w,
      {
        'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' },
        'AG-C0012': { state: 'Empty', why: 'Used at the shop' },
      },
      { versions: 2 },
    );
    // SA1 has read it at version 2.
    expect((await w.calls.adminDay(w.std.SA1, d.id).expect(200)).body.version).toBe(2);

    // Step 1: SA2 sends it back.
    await w.calls.sendBack(w.std.SA2, d.id, { reason: 'Recheck AG-C0012' }).expect(200);

    // Step 2: version 3 is uploaded and sent.
    const v3 = await sendSheet(w, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } });
    expect(v3.body.version).toBe(3);
    await w.calls.submit(w.std.DA, D21, { version: 3 }).expect(200);

    // Step 3: SA1 approves the version it read.
    const old = await w.calls.approve(w.std.SA1, d.id, { version: 2 });
    expect(errorOf(old)).toEqual({ status: 409, code: 'DAY_VERSION_CHANGED' });
    expect(old.body.message).toBe('A newer sheet was uploaded. Load the new version.');
    expect(await adjustedEvents()).toHaveLength(0);
    expect((await dayCloseOf(w.std.DA.id, D21))?.status).toBe('SUBMITTED');

    // Step 4: the new version, then its approval: only version 3's fix.
    const review = await w.calls.adminDay(w.std.SA1, d.id).expect(200);
    expect(review.body.version).toBe(3);
    expect(review.body.lines.map((l: { shortCode: string }) => l.shortCode)).toEqual(['AG-C0005']);
    await approve(w, d.id, 3);
    const adjusted = await adjustedEvents();
    expect(adjusted.map((event) => event.cylinderId)).toEqual([w.ag(5).id]);
    expect(await holderOf(w.db, w.ag(5).id)).toMatchObject({ state: 'FAULTY' });
    expect(await holderOf(w.db, w.ag(12).id)).toMatchObject({ state: 'FULL' });
  });

  it('DAY-011 approving twice, or by two super admins at once, applies the fixes once', async () => {
    // 2026-10-21 SUBMITTED at version 2 with 3 differences; 2026-10-22 SUBMITTED at version 1 with 2.
    const first = await submittedDay(
      w,
      {
        'AG-C0001': { state: 'Empty', why: 'Used at the shop' },
        'AG-C0002': { state: 'Empty', why: 'Used at the shop' },
        'AG-C0003': { state: 'Damaged', why: 'Valve leaking' },
      },
      { versions: 2 },
    );
    pinClock(app, karachiTime(D22, '20:00'));
    const second = await submittedDay(
      w,
      {
        'AG-C0004': { state: 'Empty', why: 'Used at the shop' },
        'AG-C0006': { where: 'Missing', why: 'Not found in the store' },
      },
      { date: D22 },
    );
    expect([first.version, second.version]).toEqual([2, 1]);

    // Step 1: SA1 twice in quick succession.
    const once = await w.calls.approve(w.std.SA1, first.id, { version: 2 });
    const twice = await w.calls.approve(w.std.SA1, first.id, { version: 2 });
    expect([once.status, twice.status]).toEqual([200, 200]);
    expect(once.headers['x-already-applied']).toBeUndefined();
    expect(twice.headers['x-already-applied']).toBe('true');
    expect(twice.body.day).toMatchObject({ id: first.id, status: 'APPROVED' });

    // Step 2: SA1 and SA2 at the same moment.
    const both = await Promise.all([w.calls.approve(w.std.SA1, second.id, { version: 1 }), w.calls.approve(w.std.SA2, second.id, { version: 1 })]);
    expect(both.map((res) => res.status)).toEqual([200, 200]);
    expect(both.filter((res) => res.headers['x-already-applied'] === undefined)).toHaveLength(1);
    expect(both.filter((res) => res.headers['x-already-applied'] === 'true')).toHaveLength(1);
    const winner = both.find((res) => res.headers['x-already-applied'] === undefined);
    const day22 = await dayCloseOf(w.std.DA.id, D22);
    expect(day22?.status).toBe('APPROVED');
    expect([w.std.SA1.id, w.std.SA2.id]).toContain(day22?.approvedByUserId);
    expect(winner?.body.day.approvedBy.id).toBe(day22?.approvedByUserId);

    // Step 3: one ADJUSTED event per difference line, each applied once; one day.approve row per day.
    const adjusted = await adjustedEvents();
    expect(adjusted).toHaveLength(5);
    const lines = [...(await dayCloseLines(first.id)), ...(await dayCloseLines(second.id))].filter((line) => line.diff !== 'MATCH');
    expect(lines).toHaveLength(5);
    const applied = lines.map((line) => line.appliedEventId);
    expect(new Set(applied).size).toBe(5);
    expect([...applied].sort()).toEqual(adjusted.map((event) => event.id).sort());
    for (const line of lines) expect(adjusted.filter((event) => event.cylinderId === line.cylinderId)).toHaveLength(1);
    const audits = await w.db.auditLog.findMany({ where: { action: 'day.approve' } });
    expect(audits.map((row) => row.resourceId).sort()).toEqual([first.id, second.id].sort());
  });

  it('DAY-012 a cylinder that moved after the sheet is flagged and its fix is skipped, and no scan is lost', async () => {
    // AG-C0011, AG-C0014 and AG-C0016 are FULL in the store; Kashif's trip still needs three 11.8 kg.
    const trip = await tripNeeding(w, { driver: 'DR1', size: 'kg11_8', needs: 3 });
    for (const n of [11, 14, 16]) expect(await holderOf(w.db, w.ag(n).id)).toMatchObject({ custodyType: 'STORE', state: 'FULL' });

    // Step 1 (18:00): the sheet.
    const sheet = await download(w);
    // Step 2 (18:30): Kashif loads AG-C0011.
    expect((await loadScan(w, 'DR1', trip, w.ag(11))).status).toBe(201);
    // Step 3 (19:00): the upload names all three as In my store / Empty.
    const used = { where: 'In my store', state: 'Empty', why: 'Used at the shop' };
    const res = await upload(w, await fill(sheet, { 'AG-C0011': used, 'AG-C0014': used, 'AG-C0016': used })).expect(200);
    const diffs = byShortCode(res.body.differences as Array<{ shortCode: string; movedSinceSheet: boolean }>);
    expect(diffs.get('AG-C0011')).toMatchObject({ movedSinceSheet: true, app: { place: 'VAN', plateNo: 'LEA-101' } });
    expect(diffs.get('AG-C0014')).toMatchObject({ movedSinceSheet: false });
    expect(diffs.get('AG-C0016')).toMatchObject({ movedSinceSheet: false });

    // Step 4: sent; then Kashif loads AG-C0014.
    await w.calls.submit(w.std.DA, D21, { version: 1 }).expect(200);
    expect((await loadScan(w, 'DR1', trip, w.ag(14))).status).toBe(201);
    const day = await dayCloseOf(w.std.DA.id, D21);
    const review = await w.calls.adminDay(w.std.SA1, day?.id as string).expect(200);
    expect(review.body.fixesToApply.map((l: { shortCode: string }) => l.shortCode)).toEqual(['AG-C0016']);

    // Step 5: SA1 approves while Kashif loads AG-C0016.
    const [approved, scan16] = await Promise.all([w.calls.approve(w.std.SA1, day?.id as string, { version: 1 }), loadScan(w, 'DR1', trip, w.ag(16))]);
    expect(approved.status).toBe(200);
    // The day never refuses a scan: the load is recorded unless its own rule (FULL only) refuses a cylinder the
    // approval made EMPTY a moment before.
    expect([201, 409]).toContain(scan16.status);
    if (scan16.status === 409) expect(scan16.body.code).toBe('SCAN_NOT_FULL');
    expect(scan16.body?.code).not.toBe('DAY_LOCKED');

    // Step 6: AG-C0011 and AG-C0014 skipped (moved since the sheet), on LEA-101 and Full, with no ADJUSTED event.
    const lines = await linesByKey(day?.id as string);
    const van = vanOf(w, 'DR1');
    for (const n of [11, 14]) {
      const key = `AG-C${String(n).padStart(4, '0')}`;
      expect(lines.get(key)?.skippedMovedAt).toBeInstanceOf(Date);
      expect(lines.get(key)?.appliedEventId).toBeNull();
      expect(await holderOf(w.db, w.ag(n).id)).toMatchObject({ custodyType: 'VEHICLE', custodyId: van, state: 'FULL' });
      expect(await w.db.cylinderEvent.count({ where: { cylinderId: w.ag(n).id, eventType: 'ADJUSTED' } })).toBe(0);
    }
    // AG-C0016: skipped when the scan came first, fixed when the approval did; one holder, every move kept in order.
    const sixteen = await holderOf(w.db, w.ag(16).id);
    const events = await w.db.cylinderEvent.findMany({ where: { cylinderId: w.ag(16).id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    if (scan16.status === 201) {
      expect(scan16.body.result).toBe('RECORDED');
      expect(lines.get('AG-C0016')?.skippedMovedAt).toBeInstanceOf(Date);
      expect(lines.get('AG-C0016')?.appliedEventId).toBeNull();
      expect(sixteen).toMatchObject({ custodyType: 'VEHICLE', custodyId: van, state: 'FULL' });
      expect(events.map((event) => event.eventType)).toEqual(['REGISTERED', 'SCAN_OUT']);
    } else {
      expect(lines.get('AG-C0016')?.appliedEventId).toBe(sixteen.lastEventId);
      expect(sixteen).toMatchObject({ custodyType: 'STORE', custodyId: w.std.DA.homeStoreId, state: 'EMPTY' });
      expect(events.map((event) => event.eventType)).toEqual(['REGISTERED', 'ADJUSTED']);
    }
    expect(sixteen.lastEventId).toBe(events[events.length - 1].id);
    const history = await http(app).get(`${API}/cylinders/AG-C0016/history`).set(authHeader(w.std.SA1.actor)).expect(200);
    expect(history.body.events.map((event: { action: string }) => event.action)).toEqual(events.map((event) => event.eventType));
    expect(await w.db.auditLog.findFirst({ where: { action: 'day.approve' } })).toMatchObject({
      diff: { applied: scan16.status === 201 ? 0 : 1, skipped: scan16.status === 201 ? 3 : 2, unchanged: 0, registered: 0 },
    });
  });

  it('DAY-013 sending back needs a note and opens the day for a new sheet', async () => {
    const d = await submittedDay(w, { 'AG-C0012': { state: 'Empty', why: 'Used at the shop' } }, { versions: 2 });

    // Step 1: no reason.
    const empty = await w.calls.sendBack(w.std.SA1, d.id, {});
    expect(errorOf(empty)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect((await dayCloseOf(w.std.DA.id, D21))?.status).toBe('SUBMITTED');

    // Step 2.
    const reason = 'AG-C0012 is in the store, please check again';
    const sent = await w.calls.sendBack(w.std.SA1, d.id, { reason }).expect(200);
    expect(sent.headers['x-already-applied']).toBeUndefined();
    expect(sent.body).toMatchObject({ status: 'OPEN', stage: 'SENT_BACK', officeNote: { kind: 'SENT_BACK', text: reason }, allowedActions: [] });
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row).toMatchObject({ status: 'OPEN', sentBackReason: reason });
    expect(row?.sentBackAt).toBeInstanceOf(Date);
    const audits = () => w.db.auditLog.findMany({ where: { action: 'day.send_back' } });
    expect(await audits()).toEqual([expect.objectContaining({ actorUserId: w.std.SA1.id, reason, resourceId: d.id })]);
    expect(await w.db.alert.findMany({ where: { alertType: 'DAY_END_SUBMITTED' }, select: { status: true } })).toEqual([{ status: 'RESOLVED' }]);

    // Step 3: the same send-back again (another wording keeps the first reason too).
    const again = await w.calls.sendBack(w.std.SA1, d.id, { reason }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    const other = await w.calls.sendBack(w.std.SA2, d.id, { reason: 'Please check AG-C0012' }).expect(200);
    expect(other.headers['x-already-applied']).toBe('true');
    expect((await dayCloseOf(w.std.DA.id, D21))?.sentBackReason).toBe(reason);
    expect(await audits()).toHaveLength(1);

    // Step 4: nothing to approve.
    const approving = await w.calls.approve(w.std.SA1, d.id, { version: 2 });
    expect(errorOf(approving)).toEqual({ status: 409, code: 'DAY_NOT_SUBMITTED' });
    expect(approving.body.message).toBe("This day hasn't been sent for approval.");

    // Step 5: the shop sees the note.
    const day = await w.calls.day(w.std.DA, D21).expect(200);
    expect(day.body).toMatchObject({
      status: 'OPEN',
      stage: 'SENT_BACK',
      officeNote: { kind: 'SENT_BACK', text: reason, at: row?.sentBackAt?.toISOString() },
      allowedActions: ['DOWNLOAD', 'UPLOAD'],
    });

    // Step 6: no upload since the send-back.
    expect(errorOf(await w.calls.submit(w.std.DA, D21, { version: 2 }))).toEqual({ status: 409, code: 'DAY_SHEET_NOT_UPLOADED' });

    // Step 7: version 3, then sent.
    const v3 = await sendSheet(w, { 'AG-C0012': { state: 'Empty', why: 'Used at the shop, checked again' } });
    expect(v3.body.version).toBe(3);
    const submitted = await w.calls.submit(w.std.DA, D21, { version: 3 }).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', officeNote: null });
    // The repeat window has closed: a send-back now sends the new version back.
    expect((await w.calls.sendBack(w.std.SA1, d.id, { reason: 'One more check please' }).expect(200)).headers['x-already-applied']).toBeUndefined();
  });

  it('DAY-014 a locked day refuses changes until the office reopens it', async () => {
    const d = await submittedDay(w, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } }, { versions: 2 });
    const lastSheet = await w.db.dayClose.findUniqueOrThrow({ where: { id: d.id } });
    await approve(w, d.id, 2);
    expect(await holderOf(w.db, w.ag(5).id)).toMatchObject({ state: 'FAULTY' });
    const locked = await w.db.dayClose.findUniqueOrThrow({ where: { id: d.id } });
    const lines = await dayCloseLines(d.id);
    const closed = 'This day is closed. Ask the office to reopen it.';

    // Step 1: the shop's sheet, upload and submit.
    const sheet = await w.calls.sheet(w.std.DA, D21);
    expect(errorOf(sheet)).toEqual({ status: 409, code: 'DAY_LOCKED' });
    const anyFile = Buffer.from(`PK\u0003\u0004 not read ${lastSheet.sheetFileId}`);
    const uploaded = await upload(w, anyFile);
    expect(errorOf(uploaded)).toEqual({ status: 409, code: 'DAY_LOCKED' });
    expect(uploaded.body.message).toBe(closed);
    const submit = await w.calls.submit(w.std.DA, D21, { version: 2 });
    expect(errorOf(submit)).toEqual({ status: 409, code: 'DAY_LOCKED' });
    expect(submit.body.message).toBe(closed);
    expect(await w.db.dayClose.findUniqueOrThrow({ where: { id: d.id } })).toEqual(locked);

    // Step 2: a send-back.
    expect(errorOf(await w.calls.sendBack(w.std.SA2, d.id, { reason: 'Late change' }))).toEqual({ status: 409, code: 'DAY_LOCKED' });

    // Step 3: a reopen needs a reason.
    expect(errorOf(await w.calls.reopen(w.std.SA1, d.id, {}))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    const reason = 'AG-C0012 was fixed wrongly';
    const reopened = await w.calls.reopen(w.std.SA1, d.id, { reason }).expect(200);
    expect(reopened.headers['x-already-applied']).toBeUndefined();
    expect(reopened.body).toMatchObject({ status: 'OPEN', stage: 'SENT_BACK', officeNote: { kind: 'REOPENED', text: reason } });
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row).toMatchObject({ status: 'OPEN', lockedAt: null, reopenReason: reason });
    expect(row?.reopenedAt).toBeInstanceOf(Date);
    const reopens = () => w.db.auditLog.findMany({ where: { action: 'day.reopen' } });
    expect(await reopens()).toEqual([expect.objectContaining({ actorUserId: w.std.SA1.id, reason, resourceId: d.id })]);

    // Step 4: the same reopen again.
    const again = await w.calls.reopen(w.std.SA1, d.id, { reason }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(await reopens()).toHaveLength(1);

    // Step 5: the shop sees the office's note.
    const day = await w.calls.day(w.std.DA, D21).expect(200);
    expect(day.body).toMatchObject({ stage: 'SENT_BACK', officeNote: { kind: 'REOPENED', text: reason, at: row?.reopenedAt?.toISOString() } });

    // Step 6: a new sheet uploads as version 3.
    const v3 = await sendSheet(w, { 'AG-C0012': { state: 'Empty', why: 'Used at the shop' } });
    expect(v3.body.version).toBe(3);

    // Step 7: there's been an upload since the reopen.
    const late = await w.calls.reopen(w.std.SA1, d.id, { reason: 'Another check' });
    expect(errorOf(late)).toEqual({ status: 409, code: 'CONFLICT_STALE_STATE' });
    expect(late.body.details).toMatchObject({ currentStatus: 'OPEN' });

    // Step 8: a reopen doesn't undo applied fixes.
    expect(await holderOf(w.db, w.ag(5).id)).toMatchObject({ state: 'FAULTY' });
    expect(await w.db.cylinderEvent.count({ where: { cylinderId: w.ag(5).id, eventType: 'ADJUSTED' } })).toBe(1);
    expect(await dayCloseOf(w.std.DA.id, D21)).toMatchObject({ status: 'OPEN', lockedAt: null, uploadVersion: 3 });
    expect(lines.find((line) => line.sheetKey === 'AG-C0005')?.appliedEventId).toEqual(expect.any(String));
  });

  it('DAY-015 scans after the lock are recorded on the new business day', async () => {
    // Imran's van LEB-202 holds AG-C0023 and AG-C0024; Kashif has a new trip that needs one 11.8 kg cylinder.
    await onVan(w, 'DR2', [w.ag(23), w.ag(24)], 'kg15');
    const trip = await tripNeeding(w, { driver: 'DR1', size: 'kg11_8', needs: 1 });
    // 2026-10-21 is APPROVED and locked.
    const d = await submittedDay(w, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } });
    await approve(w, d.id, 1);
    const before = await w.calls.day(w.std.DA, D21).expect(200);
    const row = await w.db.dayClose.findUniqueOrThrow({ where: { id: d.id } });
    const lines = await dayCloseLines(d.id);

    // Step 1: at 01:00 on the 22nd (still the 21st's business date) the shop scans in AG-C0023.
    pinClock(app, karachiTime(D22, '01:00'));
    expect(errorOf(await w.calls.day(w.std.DA, D22))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
    const in23 = await receiveScan(w, w.ag(23));
    expect(in23.status).toBe(201);
    expect(in23.body.result).toBe('RECORDED');
    const frozen = await w.calls.day(w.std.DA, D21).expect(200);
    expect(frozen.body.summary).toEqual(before.body.summary);
    expect(frozen.body.status).toBe('APPROVED');

    // The clock moves on to 10:00, the 22nd's business day.
    pinClock(app, karachiTime(D22, '10:00'));
    // Steps 2-3: a load and a receive are recorded; nothing answers DAY_LOCKED.
    const load7 = await loadScan(w, 'DR1', trip, w.ag(7));
    expect(load7.status).toBe(201);
    expect(load7.body.result).toBe('RECORDED');
    const in24 = await receiveScan(w, w.ag(24));
    expect(in24.status).toBe(201);
    expect(in24.body.result).toBe('RECORDED');

    // Step 4: the 21st is unchanged.
    const after = await w.calls.day(w.std.DA, D21).expect(200);
    expect(after.body).toEqual(before.body);
    expect(await w.db.dayClose.findUniqueOrThrow({ where: { id: d.id } })).toEqual(row);
    expect(await dayCloseLines(d.id)).toEqual(lines);

    // Step 5: the 22nd's sheet shows the moves.
    const sheet = await sheetRowsByNumber(await download(w, D22));
    expect(sheet.get('AG-C0007')).toMatchObject({ appWhere: "On driver's van · LEA-101", appState: 'Full' });
    expect(sheet.get('AG-C0024')).toMatchObject({ appWhere: 'In my store', appState: 'Full' });
    expect(sheet.get('AG-C0023')).toMatchObject({ appWhere: 'In my store' });
    expect(sheet.get('AG-C0005')).toMatchObject({ appWhere: 'In my store', appState: 'Damaged' });
    expect((await dayCloseOf(w.std.DA.id, D22))?.status).toBe('OPEN');
  });
});
