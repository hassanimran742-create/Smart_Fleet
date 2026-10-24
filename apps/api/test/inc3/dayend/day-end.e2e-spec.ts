/**
 * [Inc 3] Day-end, the shop's side (API_CONTRACT §10.2; TEST_CASES DAY-001…DAY-008, DAY-016…DAY-018):
 * the system-made sheet with one row per cylinder, the upload with its checks and its preview of every
 * difference, the submit, the shop's own days, the cut-off and the switch. An upload never changes holder
 * data, a refused upload stores nothing, and nothing moves money.
 */
import type { INestApplication } from '@nestjs/common';
import { DayCloseStatus } from '@prisma/client';
import {
  DAY_SHEET_ABOUT_KEYS,
  DAY_SHEET_CYLINDER_HEADERS,
  DAY_SHEET_EXTRA_HEADERS,
  DAY_SHEET_FORMAT,
} from '@smartfleet/shared-types';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describeDb } from '../../helpers/describe-db';
import { authHeader } from '../../helpers/auth';
import { dayCloseLines, dayCloseOf, karachiTime, readDaySheet } from '../../helpers/day-end';
import { http } from '../../helpers/http';
import {
  API,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  D19,
  D20,
  D21,
  D22,
  D23,
  D25,
  byShortCode,
  createDayEndApp,
  download,
  english,
  errorOf,
  fill,
  freshWorld,
  holderOf,
  holderSnapshot,
  linesByKey,
  onVan,
  patchSetting,
  pinClock,
  receiveScan,
  rowCounts,
  sendSheet,
  setMoveTime,
  standardFixture,
  storageCalls,
  submittedDay,
  upload,
  visibleCells,
  type DayWorld,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describeDb('day-end: the sheet, the upload and the submit (shop)', () => {
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

  it('DAY-001 the day-end sheet has one row per cylinder, for this shop only', async () => {
    await standardFixture(w);
    const before = await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id]);

    // Step 1: Ahmed Gas downloads the 2026-10-21 sheet.
    const startedAt = new Date();
    const res = await w.calls.sheet(w.std.DA, D21);
    const endedAt = new Date();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    const sheet = res.body as Buffer;

    // Step 2: both sheets, their columns, the "App says" words and the hidden "About".
    const read = await readDaySheet(sheet);
    expect(read.cylinderHeaders).toEqual([...DAY_SHEET_CYLINDER_HEADERS]);
    expect(read.cylinderHeaders).toEqual([
      'Cylinder number',
      'Size',
      'App says: where',
      'App says: state',
      'Your count: where',
      'Your count: state',
      'Why different',
    ]);
    expect(read.extraHeaders).toEqual([...DAY_SHEET_EXTRA_HEADERS]);
    const numbers = read.cylinders.map((row) => row.number);
    expect(numbers).toHaveLength(35);
    expect(numbers).toEqual(Array.from({ length: 35 }, (_, i) => `AG-C${String(i + 1).padStart(4, '0')}`));
    const row = (n: number) => read.cylinders[n - 1];
    expect(row(10)).toMatchObject({ appWhere: "On driver's van · LEA-101", appState: 'Full' });
    expect(row(3)).toMatchObject({ appWhere: 'With customer · Sana', appState: 'Full' });
    expect(row(35)).toMatchObject({ appWhere: 'Missing', appState: '' });
    expect(row(34)).toMatchObject({ appWhere: 'In my store', appState: 'Damaged' });
    for (const n of [1, 2, 4, 5, 9, 11, 20, 21, 30, 31, 33]) expect(row(n)).toMatchObject({ appWhere: 'In my store', appState: 'Full' });
    expect(row(1).size).toBe('11.8 kg');
    expect(row(21).size).toBe('15 kg');
    expect(row(31).size).toBe('45.4 kg');
    for (const r of read.cylinders) expect([r.countWhere, r.countState, r.why]).toEqual(['', '', '']);
    const cells = await visibleCells(sheet);
    expect(Object.keys(cells)).toEqual(['Cylinders', 'Extra cylinders']);
    for (const text of Object.values(cells).flat()) {
      expect(text).not.toMatch(UUID_TEXT);
      expect(text).not.toMatch(/\b(VEHICLE|CLIENT|FAULTY|STORE|LOST|PART_FILLED|NOT_FOUND)\b/);
    }
    const day = await dayCloseOf(w.std.DA.id, D21);
    expect(read.sheets).toEqual(
      expect.arrayContaining([
        { name: 'Cylinders', state: 'visible' },
        { name: 'Extra cylinders', state: 'visible' },
        { name: 'About', state: 'veryHidden' },
      ]),
    );
    expect(Object.keys(read.about)).toEqual([...DAY_SHEET_ABOUT_KEYS]);
    expect(read.about).toEqual({
      format: DAY_SHEET_FORMAT,
      distributorId: w.std.DA.id,
      distributorCode: 'AG',
      businessDate: D21,
      sheetFileId: day?.sheetFileId,
    });
    expect(read.about.format).toBe('smart-fleet-day-end/1');

    // The sheet is kept as a DAY_END_SHEET file of the shop, and put in storage.
    const file = await w.db.storedFile.findUniqueOrThrow({ where: { id: day?.sheetFileId as string } });
    expect(file).toMatchObject({ purpose: 'DAY_END_SHEET', uploadedByUserId: w.std.DA.userId, distributorId: w.std.DA.id, sizeBytes: sheet.length });
    expect(storageCalls(app)).toContainEqual({ command: 'PutObjectCommand', key: file.storageKey });

    // Step 3: Bilal Gas's sheet lists only its own cylinders.
    const bilal = await readDaySheet(await download(w, D21, 'DB'));
    expect(bilal.cylinders.map((r) => r.number)).toEqual(['BG-C0001', 'BG-C0002', 'BG-C0003']);
    expect(JSON.stringify(bilal)).not.toContain('AG-');

    // Step 4: two downloads for 2026-10-20 at the same moment make one day row.
    expect(await dayCloseOf(w.std.DA.id, D20)).toBeNull();
    const both = await Promise.all([w.calls.sheet(w.std.DA, D20), w.calls.sheet(w.std.DA, D20)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(await w.db.dayClose.count({ where: { distributorId: w.std.DA.id, businessDate: new Date(`${D20}T00:00:00.000Z`) } })).toBe(1);
    const d20 = await dayCloseOf(w.std.DA.id, D20);
    const aboutIds = await Promise.all(both.map(async (r) => (await readDaySheet(r.body as Buffer)).about.sheetFileId));
    // The later of the two is the newest sheet (only it can be uploaded).
    expect(aboutIds).toContain(d20?.sheetFileId);

    // Step 5: the 21st is OPEN with the sheet time of the download; no cylinder changed.
    expect(day).toMatchObject({ status: DayCloseStatus.OPEN, uploadVersion: 0, uploadedAt: null });
    expect(day?.sheetSnapshotAt?.getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 5);
    expect(day?.sheetSnapshotAt?.getTime()).toBeLessThanOrEqual(endedAt.getTime() + 5);
    expect(await dayCloseLines(day?.id as string)).toHaveLength(0);
    expect(await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id])).toEqual(before);

    // Step 6: a date after the current business date is 404; a date with no row reads as not started.
    const later = await w.calls.day(w.std.DA, D25);
    expect(errorOf(later)).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
    expect(later.body.message).toBe("We couldn't find this day.");
    const none = await w.calls.day(w.std.DA, D19).expect(200);
    expect(none.body).toMatchObject({ businessDate: D19, status: 'OPEN', stage: 'NOT_STARTED', lastUpload: null, officeNote: null, allowedActions: ['DOWNLOAD'] });
    expect(await dayCloseOf(w.std.DA.id, D19)).toBeNull();
    // Not a real date, or a later one, is 404 too (never 400), for the sheet as well.
    for (const bad of ['2026-02-30', '21-10-2026', 'today']) expect(errorOf(await w.calls.day(w.std.DA, bad))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
    expect(errorOf(await w.calls.sheet(w.std.DA, D25))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });
    expect(await dayCloseOf(w.std.DA.id, D25)).toBeNull();
  });

  /** DAY-002's four rows. */
  const FOUR_ROWS = {
    'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' },
    'AG-C0010': { where: 'In my store', state: 'Full', why: 'Driver left it, not scanned' },
    'AG-C0012': { where: 'In my store', state: 'Empty', why: 'Used at the shop' },
    'AG-C0015': { where: "On driver's van", state: 'Empty', why: 'Kashif has it' },
  };

  it('DAY-002 uploading shows every difference and changes nothing', async () => {
    await standardFixture(w);
    const sheet = await download(w);
    const holders = await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id]);
    const counts = await rowCounts(w.db);
    const files = await w.db.storedFile.count();

    // Steps 1-2: four rows filled, the other 31 left blank.
    const res = await upload(w, await fill(sheet, FOUR_ROWS)).expect(200);
    expect(res.body.version).toBe(1);
    expect(res.body).not.toHaveProperty('errors');
    expect(res.body.differences).toHaveLength(4);
    const diffs = byShortCode(res.body.differences as Array<{ shortCode: string; id: string }>);
    expect(diffs.get('AG-C0005')).toEqual({
      id: expect.any(String),
      diff: 'STATE_DIFFERS',
      fix: 'SET_STATE',
      shortCode: 'AG-C0005',
      sizeLabel: '11.8 kg',
      app: { place: 'STORE', state: 'FULL', plateNo: null, customerName: null },
      sheet: { place: 'STORE', state: 'FAULTY' },
      note: 'Valve leaking',
      movedSinceSheet: false,
    });
    expect(diffs.get('AG-C0010')).toMatchObject({
      diff: 'PLACE_DIFFERS',
      fix: 'MOVE_TO_STORE',
      sizeLabel: '11.8 kg',
      app: { place: 'VAN', state: 'FULL', plateNo: 'LEA-101', customerName: null },
      sheet: { place: 'STORE', state: 'FULL' },
      note: 'Driver left it, not scanned',
      movedSinceSheet: false,
    });
    expect(diffs.get('AG-C0012')).toMatchObject({
      diff: 'STATE_DIFFERS',
      fix: 'SET_STATE',
      sizeLabel: '11.8 kg',
      app: { place: 'STORE', state: 'FULL' },
      sheet: { place: 'STORE', state: 'EMPTY' },
      note: 'Used at the shop',
      movedSinceSheet: false,
    });
    expect(diffs.get('AG-C0015')).toMatchObject({
      diff: 'PLACE_AND_STATE_DIFFER',
      fix: 'NOTE_ONLY',
      sizeLabel: '11.8 kg',
      app: { place: 'STORE', state: 'FULL' },
      sheet: { place: 'VAN', state: 'EMPTY' },
      note: 'Kashif has it',
      movedSinceSheet: false,
    });
    // The live summary: 32 in the store (AG-C0010 on a van, AG-C0003 with Sana, AG-C0035 missing).
    expect(res.body.summary).toMatchObject({ inStore: { total: 32 }, onVans: 1, withCustomers: 1 });
    expect(res.body.summary.inStore.bySize).toEqual([
      { sizeLabel: '11.8 kg', count: 18 },
      { sizeLabel: '15 kg', count: 10 },
      { sizeLabel: '45.4 kg', count: 4 },
    ]);

    // Step 3: the day and its lines.
    const day = await w.calls.day(w.std.DA, D21).expect(200);
    expect(day.body).toMatchObject({
      status: 'OPEN',
      stage: 'READY',
      lastUpload: { version: 1, differences: 4 },
      allowedActions: ['DOWNLOAD', 'UPLOAD', 'SUBMIT'],
    });
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row).toMatchObject({ uploadVersion: 1, uploadedByUserId: w.std.DA.userId });
    const lines = await dayCloseLines(row?.id as string);
    expect(lines).toHaveLength(35);
    expect(lines.filter((line) => line.diff === 'MATCH')).toHaveLength(31);
    const byKey = await linesByKey(row?.id as string);
    expect(byKey.get('AG-C0005')?.note).toBe('Valve leaking');
    expect(byKey.get('AG-C0010')?.note).toBe('Driver left it, not scanned');
    expect(byKey.get('AG-C0012')?.note).toBe('Used at the shop');
    expect(byKey.get('AG-C0015')?.note).toBe('Kashif has it');
    expect(byKey.get('AG-C0010')).toMatchObject({
      systemPlace: 'VAN',
      systemHolderId: w.std.DR1.vehicleId,
      systemState: 'FULL',
      reportedPlace: 'STORE',
      reportedState: 'FULL',
    });
    expect(byKey.get('AG-C0001')).toMatchObject({ diff: 'MATCH', reportedPlace: null, reportedState: null, note: null });
    expect(byKey.get('AG-C0035')).toMatchObject({ diff: 'MATCH', systemPlace: 'NOT_FOUND', systemState: 'LOST' });
    // The upload is kept as the shop's DAY_END_UPLOAD file.
    const uploaded = await w.db.storedFile.findUniqueOrThrow({ where: { id: row?.uploadFileId as string } });
    expect(uploaded).toMatchObject({ purpose: 'DAY_END_UPLOAD', uploadedByUserId: w.std.DA.userId, distributorId: w.std.DA.id });
    expect(await w.db.storedFile.count()).toBe(files + 1);

    // Step 4: no cylinder changed, no move, no ledger row; AG-C0010 is still on LEA-101.
    expect(await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id])).toEqual(holders);
    expect(await rowCounts(w.db)).toEqual(counts);
    expect(await holderOf(w.db, w.ag(10).id)).toMatchObject({ custodyType: 'VEHICLE', custodyId: w.std.DR1.vehicleId });
  });

  it('DAY-003 a new upload replaces the draft', async () => {
    await standardFixture(w);
    const first = await download(w);
    await upload(w, await fill(first, FOUR_ROWS)).expect(200);
    const holders = await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id]);

    // Steps 1-2: a new sheet with only AG-C0005.
    const step1 = await fill(await download(w), { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } });
    const res = await upload(w, step1).expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.differences.map((d: { shortCode: string }) => d.shortCode)).toEqual(['AG-C0005']);

    // Step 3: no line of version 1 is left.
    const row = await dayCloseOf(w.std.DA.id, D21);
    const lines = await dayCloseLines(row?.id as string);
    expect(lines).toHaveLength(35);
    expect(lines.filter((line) => line.diff !== 'MATCH').map((line) => line.sheetKey)).toEqual(['AG-C0005']);
    const byKey = await linesByKey(row?.id as string);
    for (const key of ['AG-C0010', 'AG-C0012', 'AG-C0015']) expect(byKey.get(key)).toMatchObject({ diff: 'MATCH', note: null });
    const day = await w.calls.day(w.std.DA, D21).expect(200);
    expect(day.body.lastUpload).toMatchObject({ version: 2, differences: 1 });
    expect(await holderSnapshot(w.db, [w.std.DA.id, w.std.DB.id])).toEqual(holders);

    // Step 4: after another download, the step 1 file is an old copy.
    await download(w);
    const old = await upload(w, step1);
    expect(errorOf(old)).toEqual({ status: 422, code: 'DAY_SHEET_OUTDATED' });
    expect(old.body.message).toBe('This is an old copy. Download a new sheet and use that.');
    expect((await dayCloseOf(w.std.DA.id, D21))?.uploadVersion).toBe(2);
    expect((await dayCloseLines(row?.id as string)).map((line) => [line.sheetKey, line.diff, line.note])).toEqual(
      lines.map((line) => [line.sheetKey, line.diff, line.note]),
    );
  });

  /** A copy of a workbook exactly `size` bytes long: a stored padding entry makes up the difference. */
  async function padTo(sheet: Buffer, size: number): Promise<Buffer> {
    const zip = await JSZip.loadAsync(sheet);
    let pad = Math.max(1, size - sheet.length - 1_000);
    for (let attempt = 0; attempt < 6; attempt++) {
      zip.file('customXml/padding.bin', Buffer.alloc(pad, 0x20), { compression: 'STORE' });
      const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      if (out.length === size) return out;
      pad += size - out.length;
    }
    throw new Error(`padTo: could not make ${size} bytes`);
  }

  it("DAY-004 a file that isn't the day-end sheet is refused clearly", async () => {
    // The day is OPEN at version 2.
    await sendSheet(w, {});
    const old = await download(w);
    await upload(w, await fill(old, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } })).expect(200);
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row?.uploadVersion).toBe(2);
    const lines = (await dayCloseLines(row?.id as string)).map((line) => [line.sheetKey, line.diff, line.note]);
    const uploads = await w.db.storedFile.count({ where: { purpose: 'DAY_END_UPLOAD' } });
    // The shop's newest sheet, so each broken copy reaches the check that refuses it.
    const fresh = await download(w);
    const unreadable = "This file isn't the day-end sheet. Download today's sheet and try again.";

    // Step 1: a PDF renamed day-end.xlsx.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
    const step1 = await upload(w, pdf);
    expect(errorOf(step1)).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });
    expect(step1.body.message).toBe(unreadable);

    // Step 2: the "Cylinders" tab renamed "Sheet1".
    const renamed = await fill(fresh, {}, {
      edit: (book) => {
        (book.getWorksheet('Cylinders') as ExcelJS.Worksheet).name = 'Sheet1';
      },
    });
    expect(errorOf(await upload(w, renamed))).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });

    // Step 3: the "Why different" column deleted.
    const noWhy = await fill(fresh, {}, { edit: (book) => (book.getWorksheet('Cylinders') as ExcelJS.Worksheet).spliceColumns(7, 1) });
    expect(errorOf(await upload(w, noWhy))).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });

    // Step 4: the "Your count: where" header changed to "Where".
    const header = await fill(fresh, {}, {
      edit: (book) => {
        (book.getWorksheet('Cylinders') as ExcelJS.Worksheet).getCell('E1').value = 'Where';
      },
    });
    const step4 = await upload(w, header);
    expect(errorOf(step4)).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });
    expect(step4.body.message).toBe(unreadable);

    // Step 5: a 2.5 MB .xlsx.
    const big = await padTo(fresh, 2_500_000);
    const step5 = await upload(w, big);
    expect(errorOf(step5)).toEqual({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(step5.body.details).toEqual({ maxMb: 2 });
    expect(step5.body.message).toBe('This file is too big. The limit is 2 MB.');

    // Step 6: the hidden "About" sheet deleted.
    const noAbout = await fill(fresh, {}, { edit: (book) => book.removeWorksheet((book.getWorksheet('About') as ExcelJS.Worksheet).id) });
    expect((await readDaySheet(noAbout)).sheets.map((sheet) => sheet.name)).toEqual(['Cylinders', 'Extra cylinders']);
    expect(errorOf(await upload(w, noAbout))).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });

    // Step 7: exactly 2,097,152 bytes is not refused for its size (this copy is then refused as an old one); one byte more is.
    const exact = await padTo(old, 2_097_152);
    expect(exact.length).toBe(2_097_152);
    const step7a = await upload(w, exact);
    expect(step7a.status).not.toBe(413);
    expect(errorOf(step7a)).toEqual({ status: 422, code: 'DAY_SHEET_OUTDATED' });
    const over = await padTo(old, 2_097_153);
    expect(over.length).toBe(2_097_153);
    const step7b = await upload(w, over);
    expect(errorOf(step7b)).toEqual({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(step7b.body.details).toEqual({ maxMb: 2 });

    // Step 8: still version 2 with the same lines, and no upload was stored.
    const day = await w.calls.day(w.std.DA, D21).expect(200);
    expect(day.body.lastUpload).toMatchObject({ version: 2 });
    expect((await dayCloseLines(row?.id as string)).map((line) => [line.sheetKey, line.diff, line.note])).toEqual(lines);
    expect(await w.db.storedFile.count({ where: { purpose: 'DAY_END_UPLOAD' } })).toBe(uploads);

    // And the newest sheet padded to exactly 2 MiB is read like any other.
    const exactFresh = await padTo(await fill(fresh, {}), 2_097_152);
    const accepted = await upload(w, exactFresh);
    expect(accepted.status).toBe(200);
    expect(accepted.body.version).toBe(3);
  });

  it('DAY-005 a sheet from another shop or another day is refused', async () => {
    const bilal21 = await download(w, D21, 'DB');
    const ahmed20 = await download(w, D20);
    await download(w, D21);
    const days = async () =>
      Promise.all(
        [
          [w.std.DA.id, D20],
          [w.std.DA.id, D21],
          [w.std.DB.id, D21],
        ].map(async ([distributorId, date]) => {
          const day = await dayCloseOf(distributorId, date);
          return { status: day?.status, version: day?.uploadVersion, sheet: day?.sheetFileId, lines: day ? (await dayCloseLines(day.id)).length : -1 };
        }),
      );
    const before = await days();
    expect(before.map((day) => day.status)).toEqual(['OPEN', 'OPEN', 'OPEN']);

    // Step 1: Bilal Gas's file uploaded by Ahmed Gas.
    const step1 = await upload(w, bilal21, D21);
    expect(errorOf(step1)).toEqual({ status: 422, code: 'DAY_SHEET_WRONG_DISTRIBUTOR' });
    expect(step1.body.message).toBe('This sheet belongs to another shop.');
    const text = JSON.stringify(step1.body);
    expect(text).not.toContain('BG-');
    expect(text).not.toContain(w.std.DB.id);
    expect(text).not.toContain('Bilal');

    // Step 2: Ahmed Gas's own 2026-10-20 sheet uploaded for 2026-10-21.
    const step2 = await upload(w, ahmed20, D21);
    expect(errorOf(step2)).toEqual({ status: 422, code: 'DAY_SHEET_WRONG_DATE' });
    expect(step2.body.details).toEqual({ sheetDate: D20, date: D21 });
    expect(step2.body.message).toBe('This sheet is for Tue 20 Oct. Upload the sheet for Wed 21 Oct.');
    expect(step2.body.message).toBe(english('DAY_SHEET_WRONG_DATE', { sheetDate: D20, date: D21 }));

    // Step 3: neither day changed.
    expect(await days()).toEqual(before);
    expect((await w.calls.day(w.std.DB, D21).expect(200)).body).toMatchObject({ status: 'OPEN', lastUpload: null });
    expect((await w.calls.day(w.std.DA, D21).expect(200)).body).toMatchObject({ status: 'OPEN', lastUpload: null });
  });

  it("DAY-006 rows that can't be read are listed by row number and block sending", async () => {
    const sheet = await download(w);
    const files = await w.db.storedFile.count();
    const puts = storageCalls(app).filter((call) => call.command === 'PutObjectCommand').length;

    // Steps 1-2.
    const bad = await fill(
      sheet,
      {
        'AG-C0007': { where: 'Shop' },
        'AG-C0008': { state: 'Half' },
        'AG-C0009': { where: 'In my store', state: 'Empty' },
      },
      { extra: [{ number: 'AG-C0098', state: 'Empty' }] },
    );
    const res = await upload(w, bad);
    expect(errorOf(res)).toEqual({ status: 422, code: 'DAY_SHEET_ROW_ERRORS' });
    expect(res.body.message).toBe("Some rows couldn't be read. Fix them and upload again.");
    expect(res.body.details).toEqual({
      rows: [
        { sheet: 'CYLINDERS', row: 8, code: 'PLACE_UNKNOWN', message: "Where: use In my store, On driver's van, With customer or Missing." },
        { sheet: 'CYLINDERS', row: 9, code: 'STATE_UNKNOWN', message: 'State: use Full, Empty, Part-filled or Damaged.' },
        { sheet: 'CYLINDERS', row: 10, code: 'REASON_REQUIRED', message: 'Write why this row is different.' },
        { sheet: 'EXTRA', row: 2, code: 'SIZE_UNKNOWN', message: 'Pick a size from the list, like 11.8 kg.' },
      ],
      total: 4,
    });
    // Nothing is stored: no version, no lines, the same stage, no file.
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row).toMatchObject({ uploadVersion: 0, uploadFileId: null, uploadedAt: null });
    expect(await dayCloseLines(row?.id as string)).toHaveLength(0);
    expect(await w.db.storedFile.count()).toBe(files);
    expect(storageCalls(app).filter((call) => call.command === 'PutObjectCommand')).toHaveLength(puts);
    expect((await w.calls.day(w.std.DA, D21).expect(200)).body).toMatchObject({ stage: 'NOT_STARTED', lastUpload: null });

    // Step 3: nothing valid was uploaded from the newest sheet (the shop would send version 1).
    const submit = await w.calls.submit(w.std.DA, D21, { version: 1 });
    expect(errorOf(submit)).toEqual({ status: 409, code: 'DAY_SHEET_NOT_UPLOADED' });
    expect(submit.body.message).toBe('Upload the filled sheet first.');
    expect((await dayCloseOf(w.std.DA.id, D21))?.status).toBe('OPEN');

    // Step 4: the rows fixed, uploaded, and the newest version sent.
    const fixed = await fill(
      sheet,
      {
        'AG-C0007': { where: 'In my store' },
        'AG-C0008': { state: 'Empty', why: 'Used at the shop' },
        'AG-C0009': { where: 'In my store', state: 'Empty', why: 'Used at the shop' },
      },
      { extra: [{ number: 'AG-C0098', size: '11.8 kg', state: 'Empty' }] },
    );
    const ok = await upload(w, fixed).expect(200);
    expect(ok.body).not.toHaveProperty('errors');
    expect(ok.body.differences.map((d: { shortCode: string; diff: string }) => [d.shortCode, d.diff])).toEqual([
      ['AG-C0008', 'STATE_DIFFERS'],
      ['AG-C0009', 'STATE_DIFFERS'],
      ['AG-C0098', 'UNKNOWN_CYLINDER'],
    ]);
    const sent = await w.calls.submit(w.std.DA, D21, { version: ok.body.version }).expect(200);
    expect(sent.body).toMatchObject({ status: 'SUBMITTED', stage: 'WAITING_FOR_APPROVAL' });
  });

  it('DAY-008 sending for approval: the day is submitted once and the office is told', async () => {
    // The day is OPEN at version 2 with 1 difference (AG-C0005).
    await sendSheet(w, {});
    const last = await download(w);
    await upload(w, await fill(last, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } })).expect(200);
    const row = await dayCloseOf(w.std.DA.id, D21);
    expect(row?.uploadVersion).toBe(2);

    // Step 1.
    const first = await w.calls.submit(w.std.DA, D21, { version: 2, note: 'Checked at 9 pm' }).expect(200);
    expect(first.headers['x-already-applied']).toBeUndefined();
    expect(first.body).toMatchObject({ status: 'SUBMITTED', stage: 'WAITING_FOR_APPROVAL', allowedActions: [], lastUpload: { version: 2, differences: 1 } });
    const submitted = await dayCloseOf(w.std.DA.id, D21);
    expect(submitted?.status).toBe('SUBMITTED');
    expect(submitted?.submittedAt).toBeInstanceOf(Date);

    // Step 2: again.
    const again = await w.calls.submit(w.std.DA, D21, { version: 2, note: 'Checked at 9 pm' }).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body.status).toBe('SUBMITTED');
    expect((await dayCloseOf(w.std.DA.id, D21))?.submittedAt).toEqual(submitted?.submittedAt);
    // Another version once sent: already sent.
    expect(errorOf(await w.calls.submit(w.std.DA, D21, { version: 1 }))).toEqual({ status: 409, code: 'DAY_ALREADY_SUBMITTED' });

    // Step 3: a new upload.
    const step3 = await upload(w, await fill(last, { 'AG-C0006': { where: 'Missing', why: 'Not found' } }));
    expect(errorOf(step3)).toEqual({ status: 409, code: 'DAY_ALREADY_SUBMITTED' });
    expect(step3.body.message).toBe('This day was already sent for approval.');
    expect((await dayCloseOf(w.std.DA.id, D21))?.uploadVersion).toBe(2);

    // Step 4: no new sheet either.
    const sheets = await w.db.storedFile.count({ where: { purpose: 'DAY_END_SHEET' } });
    const step4 = await w.calls.sheet(w.std.DA, D21);
    expect(errorOf(step4)).toEqual({ status: 409, code: 'DAY_ALREADY_SUBMITTED' });
    expect(await w.db.storedFile.count({ where: { purpose: 'DAY_END_SHEET' } })).toBe(sheets);
    expect((await dayCloseOf(w.std.DA.id, D21))?.sheetFileId).toBe(submitted?.sheetFileId);

    // Step 5: one DAY_END_SUBMITTED alert for Ahmed Gas, and the day is in the office's list to approve.
    const alerts = await http(app).get(`${API}/alerts?type=DAY_END_SUBMITTED`).set(authHeader(w.std.SA1.actor)).expect(200);
    const dayAlerts = (alerts.body as Array<{ alertType: string }>).filter((alert) => alert.alertType === 'DAY_END_SUBMITTED');
    expect(dayAlerts).toHaveLength(1);
    expect(dayAlerts[0]).toMatchObject({
      status: 'OPEN',
      resourceType: 'DayClose',
      resourceId: row?.id,
      distributorId: w.std.DA.id,
      context: { dayCloseId: row?.id, distributorId: w.std.DA.id, businessDate: D21, version: 2, differences: 1, note: 'Checked at 9 pm' },
    });
    const toApprove = await w.calls.adminList(w.std.SA1, { status: 'SUBMITTED' }).expect(200);
    expect(toApprove.body.items).toEqual([
      {
        id: row?.id,
        businessDate: D21,
        distributor: { id: w.std.DA.id, businessName: 'Ahmed Gas' },
        status: 'SUBMITTED',
        stage: 'WAITING_FOR_APPROVAL',
        version: 2,
        differences: 1,
        uploadedAt: expect.any(String),
        uploadedBy: { id: w.std.DA.userId, name: 'Ahmed Gas' },
      },
    ]);
    expect((await w.calls.adminList(w.std.SA1, { status: 'OPEN' }).expect(200)).body.items).toEqual([]);

    // Step 6: exactly one day.submit row, by Ahmed Gas's user, with the note as its reason.
    const audit = await http(app).get(`${API}/audit-logs?action=day.submit`).set(authHeader(w.std.SA1.actor)).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0]).toMatchObject({
      action: 'day.submit',
      actor: { kind: 'USER', userId: w.std.DA.userId },
      resourceType: 'DayClose',
      resourceId: row?.id,
      distributorId: w.std.DA.id,
      reason: 'Checked at 9 pm',
    });
  });

  it('DAY-016 each shop sees only its own days, and the office routes are office only', async () => {
    const d1 = await submittedDay(w, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } }, { versions: 2 });
    await sendSheet(w, { 'BG-C0002': { where: 'In my store', state: 'Empty', why: 'Used at the shop' } }, { shop: 'DB' });
    const d1Before = await w.db.dayClose.findUniqueOrThrow({ where: { id: d1.id } });
    const d1Lines = await dayCloseLines(d1.id);

    // Step 1: Bilal Gas sees only its own days, numbers and counts.
    const list = await w.calls.list(w.std.DB).expect(200);
    expect(list.body).toEqual({
      items: [{ businessDate: D21, status: 'OPEN', stage: 'READY', submittedAt: null, approvedAt: null, differences: 1 }],
      nextCursor: null,
    });
    const day = await w.calls.day(w.std.DB, D21).expect(200);
    expect(day.body).toMatchObject({ status: 'OPEN', lastUpload: { version: 1, differences: 1 }, summary: { inStore: { total: 3 }, onVans: 0, withCustomers: 0 } });
    expect(JSON.stringify([list.body, day.body])).not.toMatch(/AG-|Ahmed/);
    const sheet = await readDaySheet(await download(w, D21, 'DB'));
    expect(sheet.cylinders.map((r) => r.number)).toEqual(['BG-C0001', 'BG-C0002', 'BG-C0003']);
    expect(JSON.stringify(sheet)).not.toContain('AG-');
    // Ahmed Gas's list holds only its own day.
    const ahmed = await w.calls.list(w.std.DA).expect(200);
    expect(ahmed.body.items).toEqual([
      { businessDate: D21, status: 'SUBMITTED', stage: 'WAITING_FOR_APPROVAL', submittedAt: expect.any(String), approvedAt: null, differences: 1 },
    ]);

    // Step 2: the office routes refuse a shop.
    for (const res of [await w.calls.adminList(w.std.DB), await w.calls.adminDay(w.std.DB, d1.id), await w.calls.approve(w.std.DB, d1.id, { version: 2 })]) {
      expect(errorOf(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    }
    expect(await w.db.dayClose.findUniqueOrThrow({ where: { id: d1.id } })).toEqual(d1Before);
    expect(await dayCloseLines(d1.id)).toEqual(d1Lines);

    // Step 3: Ahmed Gas can't use them either.
    expect(errorOf(await w.calls.adminDay(w.std.DA, d1.id))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });

    // Step 4: the shop routes are DISTRIBUTOR exact: no office bypass.
    expect(errorOf(await w.calls.day(w.std.SA1, D21))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(errorOf(await w.calls.upload(w.std.SA1, D21, Buffer.from('PK\u0003\u0004')))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });

    // Step 5: a driver neither.
    expect(errorOf(await w.calls.list(w.std.DR1))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });

    // Step 6: another shop's sheet file is 404; its own shop and the office get a link.
    const url = (caller: { actor: Parameters<typeof authHeader>[0] }, fileId: string) =>
      http(app).get(`${API}/files/${fileId}/url`).set(authHeader(caller.actor));
    const other = await url(w.std.DB, d1Before.sheetFileId as string);
    expect(errorOf(other)).toEqual({ status: 404, code: 'FILE_NOT_FOUND' });
    expect((await url(w.std.DA, d1Before.sheetFileId as string)).status).toBe(200);
    expect((await url(w.std.SA1, d1Before.sheetFileId as string)).status).toBe(200);
    expect((await url(w.std.SA1, d1Before.uploadFileId as string)).status).toBe(200);
    expect(errorOf(await url(w.std.DB, d1Before.uploadFileId as string))).toEqual({ status: 404, code: 'FILE_NOT_FOUND' });
  });

  it('DAY-017 the cut-off decides which day a scan counts for, and follows the setting', async () => {
    // Imran's van LEB-202 holds AG-C0024 and AG-C0025 (not delivered).
    await onVan(w, 'DR2', [w.ag(24), w.ag(25)], 'kg15');

    // Step 1: at 2026-10-22 02:30 Karachi (still the 21st's business day) the shop scans in AG-C0024.
    const at1 = karachiTime(D22, '02:30');
    expect(at1.toISOString()).toBe('2026-10-21T21:30:00.000Z');
    pinClock(app, at1);
    expect((await receiveScan(w, w.ag(24))).status).toBe(201);
    await setMoveTime(w.db, w.ag(24).id, at1);
    // At 02:30 the 22nd isn't a business date yet.
    expect(errorOf(await w.calls.day(w.std.DA, D22))).toEqual({ status: 404, code: 'DAY_NOT_FOUND' });

    // Step 2: it counts for the 21st, not the 22nd (read later that morning).
    pinClock(app, karachiTime(D22, '10:00'));
    const d21 = await w.calls.day(w.std.DA, D21).expect(200);
    const d22 = await w.calls.day(w.std.DA, D22).expect(200);
    expect(d21.body.summary.receivedToday).toBe(1);
    expect(d22.body.summary.receivedToday).toBe(0);
    expect(d21.body.cutoffAt).toBe('2026-10-21T22:00:00.000Z');
    expect(d22.body.cutoffAt).toBe('2026-10-22T22:00:00.000Z');

    // Step 3: the office moves the cut-off to midnight.
    const patched = await patchSetting(app, w.std.SA1, 'day.cutoffLocalTime', '00:00', 'Cut-off test');
    expect(patched.status).toBe(200);
    const audit = await w.db.auditLog.findMany({ where: { action: 'setting.update' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: w.std.SA1.id, reason: 'Cut-off test', diff: { key: 'day.cutoffLocalTime', from: '03:00', to: '00:00' } });

    // Step 4: at 2026-10-23 02:30 Karachi the shop scans in AG-C0025: with a 00:00 cut-off it is the 23rd.
    const at2 = karachiTime(D23, '02:30');
    pinClock(app, at2);
    expect((await receiveScan(w, w.ag(25))).status).toBe(201);
    await setMoveTime(w.db, w.ag(25).id, at2);
    const d23 = await w.calls.day(w.std.DA, D23).expect(200);
    const d22b = await w.calls.day(w.std.DA, D22).expect(200);
    expect(d23.body.summary.receivedToday).toBe(1);
    expect(d23.body.cutoffAt).toBe('2026-10-23T19:00:00.000Z');
    // The days regroup at once: AG-C0024's 02:30 receive now belongs to the 22nd, AG-C0025's to the 23rd.
    expect(d22b.body.summary.receivedToday).toBe(1);
    expect((await w.calls.day(w.std.DA, D21).expect(200)).body.summary.receivedToday).toBe(0);

    // Step 5: back to 03:00; "25:00" isn't a time of day.
    expect((await patchSetting(app, w.std.SA1, 'day.cutoffLocalTime', '03:00', 'Cut-off test done')).status).toBe(200);
    const wrong = await patchSetting(app, w.std.SA1, 'day.cutoffLocalTime', '25:00', 'Cut-off test');
    expect(errorOf(wrong)).toEqual({ status: 400, code: 'SETTING_INVALID_VALUE' });
    expect((await w.calls.day(w.std.DA, D21).expect(200)).body.summary.receivedToday).toBe(1);
  });

  it('DAY-018 dayEnd.enabled switches the day-end on and off', async () => {
    // A sheet made while it was on, for the upload below.
    const sheet = await download(w);
    await w.db.dayClose.deleteMany({});
    // "Inc 3 build with dayEnd.enabled false": it is on by default in this build, so the office switches it off first.
    expect((await patchSetting(app, w.std.SA1, 'dayEnd.enabled', false, 'Day-end off for the switch test')).status).toBe(200);

    // Step 1.
    const config = await http(app).get(`${API}/app/config`).expect(200);
    expect(config.body.features.dayEnd).toBe(false);

    // Step 2: every route answers 403, the lists too (never []), and no day row is made.
    const calls = [
      await w.calls.list(w.std.DA),
      await w.calls.day(w.std.DA, D21),
      await w.calls.sheet(w.std.DA, D21),
      await w.calls.upload(w.std.DA, D21, sheet),
      await w.calls.submit(w.std.DA, D21, { version: 1 }),
      await w.calls.adminList(w.std.SA1),
      await w.calls.adminDay(w.std.SA1, '00000000-0000-4000-8000-000000000000'),
    ];
    for (const res of calls) {
      expect(errorOf(res)).toEqual({ status: 403, code: 'FEATURE_DISABLED' });
      expect(res.headers['x-feature-disabled']).toBe('dayEnd');
    }
    expect(calls[0].body.message).toBe("This isn't available yet.");
    expect(await w.db.dayClose.count()).toBe(0);

    // Step 3: the office switches it on.
    const on = await patchSetting(app, w.std.SA1, 'dayEnd.enabled', true, 'Start day-end for the pilot');
    expect(on.status).toBe(200);
    const audit = await w.db.auditLog.findFirst({ where: { action: 'setting.update', reason: 'Start day-end for the pilot' } });
    expect(audit).toMatchObject({ actorUserId: w.std.SA1.id, diff: { key: 'dayEnd.enabled', from: false, to: true } });

    // Step 4.
    expect((await http(app).get(`${API}/app/config`).expect(200)).body.features.dayEnd).toBe(true);
    const fresh = await download(w);
    const accepted = await upload(w, await fill(fresh, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } }));
    expect(accepted.status).toBe(200);
    expect(accepted.body.version).toBe(1);
    expect((await w.calls.list(w.std.DA).expect(200)).body.items).toHaveLength(1);
    expect((await w.calls.adminList(w.std.SA1).expect(200)).body.items).toHaveLength(1);
  });
});
