/**
 * [Inc 3] The day-end module's pure parts (API_CONTRACT §10.2), without a database: the upload's ZIP check
 * (signature, real unzipped size, lying headers), the workbook written and read back, and the row rules in
 * their contract order. The DAY cases themselves run end to end in the e2e suites of this folder.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { deflateRawSync } from 'zlib';
import {
  DAY_END_ROW_ERROR_EN,
  DAY_SHEET_ABOUT_KEYS,
  DAY_SHEET_CYLINDER_HEADERS,
  DAY_SHEET_EXTRA_HEADERS,
  DAY_SHEET_FORMAT,
  DAY_SHEET_LIMITS,
} from '@smartfleet/shared-types';
import type { DayClose } from '@prisma/client';
import {
  isRightAfterReopen,
  isRightAfterSendBack,
  latestOfficeNote,
  officeActionsOf,
  shopActionsOf,
  shopOfficeNote,
  stageOf,
} from '../../../src/modules/day-end/day-end-core';
import { applyRowRules, matchSize, type DistributorCylinder, type SizeOption } from '../../../src/modules/day-end/day-end-rows';
import { buildDaySheetWorkbook, cellText, loadDayWorkbook, readAbout, readUploadedRows, type UploadedDaySheet } from '../../../src/modules/day-end/day-end-workbook';
import { hasZipSignature, inspectZip } from '../../../src/modules/day-end/day-end-zip';

const LIMIT = { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes };

const ABOUT = {
  format: DAY_SHEET_FORMAT,
  distributorId: '11111111-1111-4111-8111-111111111111',
  distributorCode: 'AG',
  businessDate: '2026-10-21',
  sheetFileId: '22222222-2222-4222-8222-222222222222',
};

const SIZES: SizeOption[] = [
  { cylinderTypeId: 't-11', label: '11.8 kg', code: 'STD_11_8KG', name: '11.8 kg', weightKg: 11.8 },
  { cylinderTypeId: 't-15', label: '15 kg', code: 'STD_15KG', name: '15 kg', weightKg: 15 },
  { cylinderTypeId: 't-45', label: '45.4 kg', code: 'STD_45_4KG', name: 'LPG 45.4 kg', weightKg: 45.4 },
];

function cylinder(shortNo: number, over: Partial<DistributorCylinder> = {}): DistributorCylinder {
  return {
    id: `c-${shortNo}`,
    shortNo,
    cylinderTypeId: 't-11',
    state: 'FULL',
    custodyType: 'STORE',
    custodyId: 'store-1',
    lastEventId: `e-${shortNo}`,
    lastEventAt: new Date('2026-10-21T10:00:00Z'),
    ...over,
  };
}

const STOCK: DistributorCylinder[] = [
  cylinder(1),
  cylinder(2),
  cylinder(3, { custodyType: 'VEHICLE', custodyId: 'van-1' }),
  cylinder(4, { custodyType: 'CLIENT', custodyId: 'client-1' }),
  cylinder(5, { state: 'LOST' }),
  cylinder(6, { state: 'FAULTY' }),
  cylinder(42),
];

function rules(sheet: Partial<UploadedDaySheet>) {
  return applyRowRules({ distributorCode: 'AG', cylinders: STOCK, sizes: SIZES, sheet: { cylinders: sheet.cylinders ?? [], extra: sheet.extra ?? [] } });
}

function row(n: number, number: string, where = '', state = '', why = '') {
  return { row: n, number, where, state, why };
}

/** A ZIP of one entry, written by hand so its headers can lie. */
function zipOf(name: string, content: Buffer, opts: { method?: 0 | 8; declaredSize?: number } = {}): Buffer {
  const method = opts.method ?? 8;
  const data = method === 8 ? deflateRawSync(content) : content;
  const declared = opts.declaredSize ?? content.length;
  const nameBytes = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBytes, data]);
  const centralPart = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

describe('day-end upload: the ZIP check (API_CONTRACT §10.2 check 3)', () => {
  it('accepts a real workbook and reports its unzipped size', async () => {
    const sheet = await buildDaySheetWorkbook({ about: ABOUT, rows: [], sizes: ['11.8 kg'], createdAt: new Date() });
    expect(hasZipSignature(sheet)).toBe(true);
    const check = inspectZip(sheet, LIMIT);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.unzippedBytes).toBeGreaterThan(sheet.length);
  });

  it('refuses bytes that are not a ZIP: a PDF, an empty file, a lone signature', () => {
    for (const bytes of [Buffer.from('%PDF-1.4\n%%EOF'), Buffer.alloc(0), Buffer.from('PK\u0003\u0004')]) {
      expect(inspectZip(bytes, LIMIT).ok).toBe(false);
    }
    expect(hasZipSignature(Buffer.from('%PDF'))).toBe(false);
  });

  it('refuses an archive that inflates past 20 MB, even when its headers say it is small', async () => {
    const bomb = Buffer.alloc(DAY_SHEET_LIMITS.maxUnzippedBytes + 1, 0);
    const honest = zipOf('xl/padding.bin', bomb);
    expect(honest.length).toBeLessThan(100_000);
    expect(inspectZip(honest, LIMIT)).toEqual({ ok: false, why: 'declared unzipped size over the limit' });
    const lying = zipOf('xl/padding.bin', bomb, { declaredSize: 1_000 });
    expect(inspectZip(lying, LIMIT)).toEqual({ ok: false, why: 'entry does not inflate within the limit' });
    // Exactly at the limit is fine.
    expect(inspectZip(zipOf('xl/padding.bin', Buffer.alloc(DAY_SHEET_LIMITS.maxUnzippedBytes, 0)), LIMIT).ok).toBe(true);
    // The same through JSZip: many small entries adding up.
    const zip = new JSZip();
    for (let i = 0; i < 3; i++) zip.file(`xl/part${i}.bin`, Buffer.alloc(8 * 1024 * 1024, 0));
    const many = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(inspectZip(many, LIMIT).ok).toBe(false);
  });

  it('refuses a stored entry whose two sizes differ, an unknown method and encrypted entries', () => {
    expect(inspectZip(zipOf('a.xml', Buffer.from('<a/>'), { method: 0, declaredSize: 99 }), LIMIT).ok).toBe(false);
    const odd = zipOf('a.xml', Buffer.from('<a/>'));
    const method = Buffer.from(odd);
    // Central directory starts after the local part; set its method to 12 (bzip2) in both headers.
    method.writeUInt16LE(12, 8);
    const centralAt = method.readUInt32LE(method.length - 22 + 16);
    method.writeUInt16LE(12, centralAt + 10);
    expect(inspectZip(method, LIMIT).ok).toBe(false);
    const encrypted = Buffer.from(odd);
    encrypted.writeUInt16LE(1, encrypted.readUInt32LE(encrypted.length - 22 + 16) + 8);
    expect(inspectZip(encrypted, LIMIT)).toEqual({ ok: false, why: 'encrypted entry' });
  });
});

describe('day-end sheet: the workbook written and read back', () => {
  it('has the contract layout: Cylinders, Extra cylinders and the very hidden About', async () => {
    const bytes = await buildDaySheetWorkbook({
      about: ABOUT,
      rows: [
        { number: 'AG-C0001', size: '11.8 kg', appWhere: 'In my store', appState: 'Full' },
        { number: 'AG-C0035', size: '45.4 kg', appWhere: 'Missing', appState: '' },
      ],
      sizes: ['11.8 kg', '15 kg', '45.4 kg'],
      createdAt: new Date('2026-10-21T15:00:00Z'),
    });
    const book = await loadDayWorkbook(bytes, { maxRows: DAY_SHEET_LIMITS.maxRowsPerSheet });
    expect(book).not.toBeNull();
    const workbook = book as ExcelJS.Workbook;
    expect(workbook.worksheets.map((sheet) => [sheet.name, sheet.state])).toEqual([
      ['Cylinders', 'visible'],
      ['Extra cylinders', 'visible'],
      ['About', 'veryHidden'],
    ]);
    const header = (workbook.getWorksheet('Cylinders') as ExcelJS.Worksheet).getRow(1);
    expect(DAY_SHEET_CYLINDER_HEADERS.map((_, i) => cellText(header.getCell(i + 1).value))).toEqual([...DAY_SHEET_CYLINDER_HEADERS]);
    const extraHeader = (workbook.getWorksheet('Extra cylinders') as ExcelJS.Worksheet).getRow(1);
    expect(DAY_SHEET_EXTRA_HEADERS.map((_, i) => cellText(extraHeader.getCell(i + 1).value))).toEqual([...DAY_SHEET_EXTRA_HEADERS]);
    expect(readAbout(workbook)).toEqual(ABOUT);
    expect(Object.keys(readAbout(workbook) ?? {})).toEqual([...DAY_SHEET_ABOUT_KEYS]);
    const rows = readUploadedRows(workbook);
    expect(rows).toEqual({
      cylinders: [
        { row: 2, number: 'AG-C0001', where: '', state: '', why: '' },
        { row: 3, number: 'AG-C0035', where: '', state: '', why: '' },
      ],
      extra: [],
    });
    // The "Your count" cells offer their words, without forcing them.
    const validations = (workbook.getWorksheet('Cylinders') as unknown as { dataValidations: { model: Record<string, { formulae: string[] }> } }).dataValidations.model;
    expect(JSON.stringify(validations)).toContain("In my store,On driver's van,With customer,Missing");
  });

  it('refuses a sheet with more than 20,000 rows, and reads headers loosely but completely', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cylinders');
    sheet.addRow([...DAY_SHEET_CYLINDER_HEADERS]);
    // 20,000 rows in all (the header included) is the most a sheet may have.
    sheet.getCell(`A${DAY_SHEET_LIMITS.maxRowsPerSheet}`).value = 'AG-C0001';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(await loadDayWorkbook(bytes, { maxRows: DAY_SHEET_LIMITS.maxRowsPerSheet })).not.toBeNull();
    sheet.getCell(`A${DAY_SHEET_LIMITS.maxRowsPerSheet + 1}`).value = 'AG-C0002';
    const tooMany = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(await loadDayWorkbook(tooMany, { maxRows: DAY_SHEET_LIMITS.maxRowsPerSheet })).toBeNull();
    expect(await loadDayWorkbook(Buffer.from('not a workbook'), { maxRows: 10 })).toBeNull();

    // Header case and spaces don't matter; a missing sheet or a changed word does.
    const loose = new ExcelJS.Workbook();
    loose.addWorksheet(' cylinders ').addRow(DAY_SHEET_CYLINDER_HEADERS.map((header) => `  ${header.toUpperCase()} `));
    loose.addWorksheet('Extra Cylinders').addRow([...DAY_SHEET_EXTRA_HEADERS]);
    expect(readUploadedRows(loose)).toEqual({ cylinders: [], extra: [] });
    (loose.getWorksheet('Extra Cylinders') as ExcelJS.Worksheet).getCell('B1').value = 'Weight';
    expect(readUploadedRows(loose)).toBeNull();
  });

  it('reads cells as people see them: numbers, rich text, formulas and links', () => {
    expect(cellText(42)).toBe('42');
    expect(cellText(11.8)).toBe('11.8');
    expect(cellText({ richText: [{ text: 'In my ' }, { text: 'store' }] })).toBe('In my store');
    expect(cellText({ formula: 'A1', result: 'Full' } as ExcelJS.CellFormulaValue)).toBe('Full');
    expect(cellText({ text: 'AG-C0042', hyperlink: 'https://example.com' })).toBe('AG-C0042');
    expect(cellText({ error: '#N/A' } as ExcelJS.CellErrorValue)).toBe('');
    expect(cellText(null)).toBe('');
  });
});

describe('day-end upload: the row rules (API_CONTRACT §10.2, G09-04, G09-05)', () => {
  it('reads every typed form of a number and the "Your count" words loosely', () => {
    const result = rules({
      cylinders: [
        row(2, '1', 'in my STORE', 'part filled', 'Gas used at the shop'),
        row(3, '0002', '  On driver’s van ', '', 'Kashif has it'),
        row(4, 'c0042', 'Missing', 'Full', 'Not found'),
        row(5, 'ag-C0006', 'In my store', 'Partfilled', 'Repaired'),
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.counts.get('c-1')).toEqual({ row: 2, reportedPlace: 'STORE', reportedState: 'PART_FILLED', note: 'Gas used at the shop' });
    expect(result.counts.get('c-2')).toEqual({ row: 3, reportedPlace: 'VAN', reportedState: null, note: 'Kashif has it' });
    expect(result.counts.get('c-42')).toEqual({ row: 4, reportedPlace: 'NOT_FOUND', reportedState: 'FULL', note: 'Not found' });
    expect(result.counts.get('c-6')).toEqual({ row: 5, reportedPlace: 'STORE', reportedState: 'PART_FILLED', note: 'Repaired' });
  });

  it('checks a Cylinders row in the contract order and gives each row its first broken rule', () => {
    const result = rules({
      cylinders: [
        row(2, 'AG-0001', 'Shop', 'Half'), // order-style number: NUMBER_INVALID first
        row(3, 'BG-C0001', 'Shop'), // another shop's code, decided from the code alone
        row(4, 'ZZ-C0007'), // a code no shop has is still another shop's
        row(5, 'AG-C0099', 'In my store'), // not one of the caller's cylinders
        row(6, 'AG-C0001', 'Shop', 'Half'),
        row(7, '1', 'In my store', 'Empty', 'Used'), // listed twice
        row(8, 'AG-C0002', 'In my store', 'Half'),
        row(9, 'AG-C0042', 'In my store', 'Empty', '  a\n '), // too short a reason after cleaning
        row(10, 'AG-C0005', 'In my store', '', 'Found it'), // LOST reported in the store needs a state
        row(11, '', 'In my store', 'Empty', 'Used at the shop'),
      ],
    });
    expect(result.errors.map((error) => [error.sheet, error.row, error.code])).toEqual([
      ['CYLINDERS', 2, 'NUMBER_INVALID'],
      ['CYLINDERS', 3, 'OTHER_SHOP_NUMBER'],
      ['CYLINDERS', 4, 'OTHER_SHOP_NUMBER'],
      ['CYLINDERS', 5, 'NOT_ON_LIST'],
      ['CYLINDERS', 6, 'PLACE_UNKNOWN'],
      ['CYLINDERS', 7, 'DUPLICATE_NUMBER'],
      ['CYLINDERS', 8, 'STATE_UNKNOWN'],
      ['CYLINDERS', 9, 'REASON_REQUIRED'],
      ['CYLINDERS', 10, 'STATE_UNKNOWN'],
      ['CYLINDERS', 11, 'NUMBER_INVALID'],
    ]);
    for (const error of result.errors) expect(error.message).toBe(DAY_END_ROW_ERROR_EN[error.code]);
  });

  it('needs no reason on a matching row and ignores one given there', () => {
    const result = rules({
      cylinders: [
        row(2, 'AG-C0001', 'In my store', 'Full', 'All fine'),
        row(3, 'AG-C0003', "On driver's van", '', ''),
        row(4, 'AG-C0004', 'With customer', 'Full', ''),
        row(5, 'AG-C0005', 'Missing', '', ''),
        row(6, 'AG-C0006', '', 'Damaged', ''),
      ],
    });
    expect(result.errors).toEqual([]);
    for (const id of ['c-1', 'c-3', 'c-4', 'c-5', 'c-6']) expect(result.counts.get(id)?.note).toBeNull();
  });

  it('checks an Extra cylinders row in the contract order and keeps the number in its normal form', () => {
    const result = rules({
      extra: [
        { row: 2, number: '99', size: '11.8kg', state: 'Empty' },
        { row: 3, number: 'AG-0098', size: '11.8 kg', state: 'Empty' },
        { row: 4, number: 'BG-C0001', size: '11.8 kg', state: 'Full' },
        { row: 5, number: 'AG-C0042', size: '11.8 kg', state: 'Full' },
        { row: 6, number: 'c0099', size: '15', state: 'Full' },
        { row: 7, number: 'AG-C0097', size: '', state: 'Empty' },
        { row: 8, number: 'AG-C0096', size: '15 kg', state: '' },
        { row: 9, number: 'AG-C0095', size: '45.4 KG', state: 'damaged' },
      ],
    });
    expect(result.errors.map((error) => [error.sheet, error.row, error.code])).toEqual([
      ['EXTRA', 3, 'NUMBER_INVALID'],
      ['EXTRA', 4, 'OTHER_SHOP_NUMBER'],
      ['EXTRA', 5, 'ON_LIST'],
      ['EXTRA', 6, 'DUPLICATE_NUMBER'],
      ['EXTRA', 7, 'SIZE_UNKNOWN'],
      ['EXTRA', 8, 'STATE_UNKNOWN'],
    ]);
    expect(result.extras).toEqual([
      { row: 2, shortNo: 99, sheetKey: 'AG-C0099', cylinderTypeId: 't-11', sizeLabel: '11.8 kg', state: 'EMPTY' },
      { row: 9, shortNo: 95, sheetKey: 'AG-C0095', cylinderTypeId: 't-45', sizeLabel: '45.4 kg', state: 'FAULTY' },
    ]);
  });

  it('lists the Cylinders rows before the Extra rows, each top to bottom', () => {
    const result = rules({
      cylinders: [row(4, 'AG-C0099'), row(9, 'x')],
      extra: [{ row: 2, number: 'AG-C0001', size: '11.8 kg', state: 'Full' }],
    });
    expect(result.errors.map((error) => `${error.sheet}:${error.row}`)).toEqual(['CYLINDERS:4', 'CYLINDERS:9', 'EXTRA:2']);
  });

  it('matches sizes by their words, their weight or their code', () => {
    expect(matchSize('11.8 kg', SIZES)?.cylinderTypeId).toBe('t-11');
    expect(matchSize('11,8', SIZES)?.cylinderTypeId).toBe('t-11');
    expect(matchSize('15KG', SIZES)?.cylinderTypeId).toBe('t-15');
    expect(matchSize('std_45_4kg', SIZES)?.cylinderTypeId).toBe('t-45');
    expect(matchSize('LPG 45.4 kg', SIZES)?.cylinderTypeId).toBe('t-45');
    expect(matchSize('12 kg', SIZES)).toBeNull();
    expect(matchSize('', SIZES)).toBeNull();
  });
});

describe('day-end days: stage, buttons, the office note and the repeat windows (API_CONTRACT §1.4, §10.2)', () => {
  const t = (minute: number) => new Date(Date.UTC(2026, 9, 21, 15, minute));
  function day(over: Partial<DayClose>): DayClose {
    return {
      id: 'd',
      distributorId: 'x',
      businessDate: new Date('2026-10-21T00:00:00Z'),
      status: 'OPEN',
      sheetSnapshotAt: t(0),
      sheetFileId: 'sheet',
      uploadFileId: null,
      uploadVersion: 0,
      uploadedAt: null,
      uploadedByUserId: null,
      submittedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      sentBackReason: null,
      sentBackAt: null,
      reopenReason: null,
      reopenedAt: null,
      lockedAt: null,
      totals: null,
      createdAt: t(0),
      updatedAt: t(0),
      ...over,
    };
  }

  it('gives the shop DOWNLOAD with no row, UPLOAD once a sheet is made, SUBMIT when READY, nothing once sent', () => {
    expect(shopActionsOf(null)).toEqual(['DOWNLOAD']);
    expect(stageOf(null)).toBe('NOT_STARTED');
    expect(shopActionsOf(day({ sheetFileId: null, sheetSnapshotAt: null }))).toEqual(['DOWNLOAD']);
    expect(shopActionsOf(day({}))).toEqual(['DOWNLOAD', 'UPLOAD']);
    const ready = day({ uploadVersion: 1, uploadedAt: t(5) });
    expect(stageOf(ready)).toBe('READY');
    expect(shopActionsOf(ready)).toEqual(['DOWNLOAD', 'UPLOAD', 'SUBMIT']);
    // A newer sheet than the upload: upload again before sending.
    expect(stageOf(day({ uploadVersion: 1, uploadedAt: t(5), sheetSnapshotAt: t(6) }))).toBe('NOT_STARTED');
    expect(shopActionsOf(day({ status: 'SUBMITTED', uploadVersion: 1, uploadedAt: t(5) }))).toEqual([]);
    expect(shopActionsOf(day({ status: 'APPROVED', uploadVersion: 1, uploadedAt: t(5), lockedAt: t(9) }))).toEqual([]);
    expect(officeActionsOf(day({ status: 'SUBMITTED' }))).toEqual(['APPROVE', 'SEND_BACK']);
    expect(officeActionsOf(day({ status: 'APPROVED' }))).toEqual(['REOPEN']);
    expect(officeActionsOf(day({}))).toEqual([]);
  });

  it('shows the later office note while SENT_BACK, and keeps the repeat window until the next upload', () => {
    const sentBack = day({ uploadVersion: 2, uploadedAt: t(5), sentBackAt: t(7), sentBackReason: 'Recheck AG-C0012' });
    expect(stageOf(sentBack)).toBe('SENT_BACK');
    expect(shopOfficeNote(sentBack)).toEqual({ kind: 'SENT_BACK', text: 'Recheck AG-C0012', at: t(7).toISOString() });
    expect(isRightAfterSendBack(sentBack)).toBe(true);
    expect(isRightAfterReopen(sentBack)).toBe(false);
    const reuploaded = { ...sentBack, uploadVersion: 3, uploadedAt: t(8), sheetSnapshotAt: t(7) };
    expect(stageOf(reuploaded)).toBe('READY');
    expect(shopOfficeNote(reuploaded)).toBeNull();
    expect(latestOfficeNote(reuploaded)).toMatchObject({ kind: 'SENT_BACK' });
    expect(isRightAfterSendBack(reuploaded)).toBe(false);

    const reopened = day({ uploadVersion: 2, uploadedAt: t(5), sentBackAt: t(3), sentBackReason: 'Old', reopenedAt: t(9), reopenReason: 'AG-C0012 was fixed wrongly' });
    expect(shopOfficeNote(reopened)).toEqual({ kind: 'REOPENED', text: 'AG-C0012 was fixed wrongly', at: t(9).toISOString() });
    expect(isRightAfterReopen(reopened)).toBe(true);
    expect(isRightAfterSendBack(reopened)).toBe(false);
    expect(isRightAfterReopen({ ...reopened, uploadedAt: t(10) })).toBe(false);
    expect(isRightAfterReopen({ ...reopened, status: 'SUBMITTED' })).toBe(false);
  });
});
