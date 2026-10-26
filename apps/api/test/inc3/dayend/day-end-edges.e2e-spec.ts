/**
 * [Inc 3] Day-end edges beyond the DAY cases (API_CONTRACT §10.2, §1.3, §3.2): paging, the office's path
 * ids, a ZIP bomb and a sheet full of bad rows through the real route, typed numbers and deleted rows,
 * a lost cylinder found again, and the fixed answers of the office's actions in every other state.
 */
import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { CylinderState } from '@prisma/client';
import { DAY_SHEET_LIMITS } from '@smartfleet/shared-types';
import { dayCloseLines, dayCloseOf, karachiTime } from '../../helpers/day-end';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { setCylinderState } from '../../helpers/runs';
import {
  API,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  D19,
  D20,
  D21,
  approve,
  byShortCode,
  createDayEndApp,
  download,
  errorOf,
  fill,
  freshWorld,
  holderOf,
  linesByKey,
  pinClock,
  sendSheet,
  storageCalls,
  submittedDay,
  upload,
  type DayWorld,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('day-end: edges (paging, ids, hostile files, typed numbers, repeats)', () => {
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

  it('pages the shop\'s and the office\'s lists newest first, and refuses a cursor another list made', async () => {
    for (const date of [D19, D20, D21]) await download(w, date);
    await download(w, D21, 'DB');
    const first = await w.calls.list(w.std.DA, { limit: 2 }).expect(200);
    expect(first.body.items.map((item: { businessDate: string }) => item.businessDate)).toEqual([D21, D20]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await w.calls.list(w.std.DA, { limit: 2, cursor: first.body.nextCursor }).expect(200);
    expect(second.body).toEqual({ items: [expect.objectContaining({ businessDate: D19 })], nextCursor: null });
    expect(errorOf(await w.calls.list(w.std.DA, { limit: 101 }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });

    const office = await w.calls.adminList(w.std.SA1, { limit: 3 }).expect(200);
    expect(office.body.items.map((item: { businessDate: string; distributor: { businessName: string } }) => [item.businessDate, item.distributor.businessName])).toEqual([
      [D21, expect.any(String)],
      [D21, expect.any(String)],
      [D20, 'Ahmed Gas'],
    ]);
    const rest = await w.calls.adminList(w.std.SA1, { limit: 3, cursor: office.body.nextCursor }).expect(200);
    expect(rest.body.items.map((item: { businessDate: string }) => item.businessDate)).toEqual([D19]);
    // A cursor the office list made isn't the shop list's.
    expect(errorOf(await w.calls.list(w.std.DA, { cursor: office.body.nextCursor }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(errorOf(await w.calls.adminList(w.std.SA1, { status: 'DONE' }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('answers 404 DAY_NOT_FOUND for an office id that is unknown or not a UUID, before anything else', async () => {
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      expect(errorOf(await w.calls.adminDay(w.std.SA1, id))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
      expect(errorOf(await w.calls.approve(w.std.SA1, id, { version: 1 }))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
      expect(errorOf(await w.calls.sendBack(w.std.SA1, id, { reason: 'Please check again' }))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
      expect(errorOf(await w.calls.reopen(w.std.SA1, id, { reason: 'Please check again' }))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
    }
  });

  it('needs the file in the multipart field "file"', async () => {
    await download(w);
    const none = await http(app).post(`${API}/day-end/${D21}/upload`).set(authHeader(w.std.DA.actor)).send({});
    expect(errorOf(none)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(none.body.details.fields).toEqual([expect.objectContaining({ path: 'file', code: 'REQUIRED' })]);
    const wrongField = await http(app)
      .post(`${API}/day-end/${D21}/upload`)
      .set(authHeader(w.std.DA.actor))
      .attach('sheet', Buffer.from('PK\u0003\u0004'), { filename: 'day-end.xlsx' });
    expect(errorOf(wrongField)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect((await dayCloseOf(w.std.DA.id, D21))?.uploadVersion).toBe(0);
  });

  it('refuses a ZIP bomb as an unreadable sheet and stores nothing', async () => {
    const sheet = await download(w);
    const zip = await JSZip.loadAsync(sheet);
    zip.file('xl/media/bomb.bin', Buffer.alloc(DAY_SHEET_LIMITS.maxUnzippedBytes + 1024, 0), { compression: 'DEFLATE' });
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bomb.length).toBeLessThan(DAY_SHEET_LIMITS.maxBytes);
    const puts = storageCalls(app).length;
    const res = await upload(w, bomb);
    expect(errorOf(res)).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });
    expect(storageCalls(app)).toHaveLength(puts);
    expect((await dayCloseOf(w.std.DA.id, D21))?.uploadVersion).toBe(0);
  });

  it('lists at most 100 bad rows, in sheet and row order, and counts them all', async () => {
    const sheet = await download(w);
    const rows: Record<string, { where: string }> = {};
    for (let n = 1; n <= 35; n++) rows[`AG-C${String(n).padStart(4, '0')}`] = { where: 'Shop' };
    const extra = Array.from({ length: 90 }, (_, i) => ({ number: `AG-C${String(100 + i)}`, size: 'Huge', state: 'Empty' }));
    const res = await upload(w, await fill(sheet, rows, { extra }));
    expect(errorOf(res)).toEqual({ status: 422, code: 'DAY_SHEET_ROW_ERRORS' });
    expect(res.body.details.total).toBe(125);
    expect(res.body.details.rows).toHaveLength(100);
    expect(res.body.details.rows[0]).toMatchObject({ sheet: 'CYLINDERS', row: 2, code: 'PLACE_UNKNOWN' });
    expect(res.body.details.rows[34]).toMatchObject({ sheet: 'CYLINDERS', row: 36 });
    expect(res.body.details.rows[35]).toMatchObject({ sheet: 'EXTRA', row: 2, code: 'SIZE_UNKNOWN' });
    expect(res.body.details.rows[99]).toMatchObject({ sheet: 'EXTRA', row: 66 });
  });

  it('reads a typed number on the Cylinders sheet, and a deleted row matches', async () => {
    const sheet = await download(w);
    const filled = await fill(sheet, { 'AG-C0005': { where: 'In my store', state: 'Empty', why: 'Used at the shop' } }, {
      deleteRows: ['AG-C0001', 'AG-C0002'],
      edit: (book) => {
        const main = book.getWorksheet('Cylinders');
        main?.eachRow((row) => {
          if (String(row.getCell(1).value) === 'AG-C0005') {
            row.getCell(1).value = 5;
            row.commit();
          }
        });
      },
    });
    const res = await upload(w, filled).expect(200);
    expect(res.body.differences.map((d: { shortCode: string }) => d.shortCode)).toEqual(['AG-C0005']);
    const day = await dayCloseOf(w.std.DA.id, D21);
    const lines = await linesByKey(day?.id as string);
    expect(lines.size).toBe(35);
    expect(lines.get('AG-C0001')).toMatchObject({ diff: 'MATCH', reportedPlace: null });
    expect(lines.get('AG-C0005')).toMatchObject({ diff: 'STATE_DIFFERS', reportedState: 'EMPTY' });
  });

  it('a lost cylinder found again moves into the store with the state the shop gives, and a damaged one can be repaired', async () => {
    await setCylinderState(w.ag(35).id, CylinderState.LOST);
    await setCylinderState(w.ag(34).id, CylinderState.FAULTY);
    const d = await submittedDay(w, {
      'AG-C0035': { where: 'In my store', state: 'Empty', why: 'Found behind the shop' },
      'AG-C0034': { state: 'Full', why: 'Valve replaced' },
    });
    const review = await w.calls.adminDay(w.std.SA1, d.id).expect(200);
    const lines = byShortCode(review.body.lines as Array<{ shortCode: string }>);
    expect(lines.get('AG-C0035')).toMatchObject({ diff: 'PLACE_AND_STATE_DIFFER', fix: 'MOVE_TO_STORE', app: { place: 'NOT_FOUND', state: 'LOST' }, sheet: { place: 'STORE', state: 'EMPTY' } });
    expect(lines.get('AG-C0034')).toMatchObject({ diff: 'STATE_DIFFERS', fix: 'SET_STATE', app: { place: 'STORE', state: 'FAULTY' }, sheet: { place: null, state: 'FULL' } });
    await approve(w, d.id, d.version);
    expect(await holderOf(w.db, w.ag(35).id)).toMatchObject({ custodyType: 'STORE', custodyId: w.std.DA.homeStoreId, state: 'EMPTY' });
    expect(await holderOf(w.db, w.ag(34).id)).toMatchObject({ state: 'FULL' });
  });

  it('gives the office actions their fixed answers in every other state', async () => {
    // A day that was only downloaded: nothing to approve or send back, nothing to reopen.
    await download(w);
    const open = await dayCloseOf(w.std.DA.id, D21);
    expect(errorOf(await w.calls.approve(w.std.SA1, open?.id as string, { version: 1 }))).toEqual({ status: 409, code: 'DAY_NOT_SUBMITTED' });
    expect(errorOf(await w.calls.sendBack(w.std.SA1, open?.id as string, { reason: 'Please check again' }))).toEqual({ status: 409, code: 'DAY_NOT_SUBMITTED' });
    const reopenOpen = await w.calls.reopen(w.std.SA1, open?.id as string, { reason: 'Please check again' });
    expect(errorOf(reopenOpen)).toEqual({ status: 409, code: 'CONFLICT_STALE_STATE' });
    expect(reopenOpen.body.details).toEqual({ currentStatus: 'OPEN' });

    // SUBMITTED: reopen is stale; approve with a version that never existed is DAY_VERSION_CHANGED.
    const d = await submittedDay(w, { 'AG-C0005': { state: 'Damaged', why: 'Valve leaking' } });
    const reopenSubmitted = await w.calls.reopen(w.std.SA1, d.id, { reason: 'Please check again' });
    expect(errorOf(reopenSubmitted)).toEqual({ status: 409, code: 'CONFLICT_STALE_STATE' });
    expect(reopenSubmitted.body.details).toEqual({ currentStatus: 'SUBMITTED' });
    expect(errorOf(await w.calls.approve(w.std.SA1, d.id, { version: 7 }))).toEqual({ status: 409, code: 'DAY_VERSION_CHANGED' });
    expect(errorOf(await w.calls.approve(w.std.SA1, d.id, { version: 0 }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });

    // APPROVED: the same version is a repeat with the same answer, another is DAY_LOCKED.
    const first = await approve(w, d.id, d.version);
    const repeat = await w.calls.approve(w.std.SA2, d.id, { version: d.version }).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body).toEqual(first.body);
    expect(errorOf(await w.calls.approve(w.std.SA1, d.id, { version: d.version + 1 }))).toEqual({ status: 409, code: 'DAY_LOCKED' });
    expect((await dayCloseOf(w.std.DA.id, D21))?.approvedByUserId).toBe(w.std.SA1.id);
    // Day lines are frozen: still the approval's.
    expect((await dayCloseLines(d.id)).filter((line) => line.appliedEventId)).toHaveLength(1);
  });

  it('keeps the shop\'s day and the office review consistent across a later download (the stage goes back to not started)', async () => {
    await sendSheet(w, { 'AG-C0005': { state: 'Damaged', why: 'Valve leaking' } });
    expect((await w.calls.day(w.std.DA, D21).expect(200)).body).toMatchObject({ stage: 'READY', allowedActions: ['DOWNLOAD', 'UPLOAD', 'SUBMIT'] });
    pinClock(app, karachiTime(D21, '21:00'));
    await download(w);
    const day = await w.calls.day(w.std.DA, D21).expect(200);
    expect(day.body).toMatchObject({ stage: 'NOT_STARTED', allowedActions: ['DOWNLOAD', 'UPLOAD'], lastUpload: { version: 1, differences: 1 } });
    expect(errorOf(await w.calls.submit(w.std.DA, D21, { version: 1 }))).toEqual({ status: 409, code: 'DAY_SHEET_NOT_UPLOADED' });
  });
});
