/**
 * review23 money-data: the day-end upload's file checks guard bytes, not ranges.
 *
 * `DayEndService.upload` (day-end.service.ts:200-230) runs, in order: `inspectZip` (ZIP signature, ≤ 2 MiB,
 * ≤ 20 MB unzipped, ≤ 2,000 entries) then `loadDayWorkbook` → `workbook.xlsx.load(bytes)` (exceljs 4.4.0),
 * and only after that reads "About", the distributor, the date and the rows. exceljs expands every range it
 * reads cell by cell, synchronously, on the API's one event loop:
 *   - `<dataValidation sqref="…">` → data-validations-xform.js parseClose: `range.forEachAddress` per cell;
 *   - `<mergeCell ref="…">` → worksheet.js `_mergeCellsInternal`: `getCell(i,j)` per cell, with an
 *     O(merges²) "already merged" scan before each merge.
 * A dropdown dragged over whole columns, the whole sheet (Ctrl+A → Data validation) or many merged cells
 * makes a few-KB workbook that passes every byte check and then takes seconds to minutes, or never returns.
 * `maxRowsPerSheet` cannot help: it is read from `sheet.rowCount` AFTER the load, and a whole-column merge
 * sets rowCount to 1,048,576 by itself.
 *
 * This spec builds the sheet with exceljs exactly as `buildDaySheetWorkbook` does, patches the ranges the
 * way Excel saves them, proves the files pass `inspectZip` and the 2 MiB cap, and times exceljs's own
 * `workbook.xlsx.load` in a child process with a hard deadline. A safe sheet loads in well under a second;
 * the hostile ones do not finish. No app and no database: the defect is in the parse path, not the HTTP shell.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  DAY_SHEET_ABOUT_KEYS,
  DAY_SHEET_CYLINDER_HEADERS,
  DAY_SHEET_EXTRA_HEADERS,
  DAY_SHEET_LIMITS,
  DAY_SHEET_NAMES,
} from '@smartfleet/shared-types';
import { AppError } from '../../../src/common/errors/app-error';
import { inspectDayUpload } from '../../../src/modules/day-end/day-end-sheet-shape';
import { readDayUpload } from '../../../src/modules/day-end/day-end-upload-read';
import { inspectZip } from '../../../src/modules/day-end/day-end-zip';

/** A day-end workbook of `rows` cylinders, built like day-end-workbook.ts (one Cylinders row each, two dropdowns). */
async function baseSheet(rows = 35): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const main = wb.addWorksheet(DAY_SHEET_NAMES.CYLINDERS);
  main.addRow([...DAY_SHEET_CYLINDER_HEADERS]);
  for (let i = 1; i <= rows; i++) main.addRow([`AG-C${String(i).padStart(4, '0')}`, '11.8 kg', 'In my store', 'Full', null, null, null]);
  const last = rows + 1;
  (main as unknown as { dataValidations: { add(a: string, v: ExcelJS.DataValidation): void } }).dataValidations.add(`E2:E${last}`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"In my store,On driver\'s van,With customer,Missing"'],
  });
  (main as unknown as { dataValidations: { add(a: string, v: ExcelJS.DataValidation): void } }).dataValidations.add(`F2:F${last}`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"Full,Empty,Part-filled,Damaged"'],
  });
  const extra = wb.addWorksheet(DAY_SHEET_NAMES.EXTRA);
  extra.addRow([...DAY_SHEET_EXTRA_HEADERS]);
  const about = wb.addWorksheet(DAY_SHEET_NAMES.ABOUT, { state: 'veryHidden' });
  for (const key of DAY_SHEET_ABOUT_KEYS) about.addRow([key, key === 'format' ? 'smart-fleet-day-end/1' : 'x']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Rewrites the Cylinders sheet's validation ranges, and/or adds merged ranges, as Excel saves them. */
async function withRanges(sheet: Buffer, p: { sqref?: string; merges?: string[] }): Promise<Buffer> {
  const zip = await JSZip.loadAsync(sheet);
  const part = 'xl/worksheets/sheet1.xml'; // exceljs writes Cylinders first
  let xml = await zip.file(part)!.async('string');
  if (p.sqref) xml = xml.replace(/sqref="[^"]*"/g, `sqref="${p.sqref}"`);
  if (p.merges?.length) {
    const node = `<mergeCells count="${p.merges.length}">${p.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
    xml = xml.replace('</sheetData>', `</sheetData>${node}`);
  }
  zip.file(part, xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Puts a <definedName> into xl/workbook.xml, as Excel saves a filter (`_xlnm._FilterDatabase`) or a name. */
async function withDefinedName(sheet: Buffer, name: string, ref: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(sheet);
  let xml = await zip.file('xl/workbook.xml')!.async('string');
  const node = `<definedNames><definedName name="${name}" localSheetId="0" hidden="1">${ref}</definedName></definedNames>`;
  // Replacer functions: a range's "$" must not read as a replacement pattern ("$&").
  xml = xml.includes('<definedNames')
    ? xml.replace(/<definedNames>[\s\S]*<\/definedNames>|<definedNames\/>/, () => node)
    : xml.replace('</sheets>', () => `</sheets>${node}`);
  zip.file('xl/workbook.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Edits the Cylinders sheet's XML (sheet1.xml) with `edit`. */
async function withSheetXml(sheet: Buffer, edit: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(sheet);
  const part = 'xl/worksheets/sheet1.xml';
  zip.file(part, edit(await zip.file(part)!.async('string')));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Times exceljs's own `workbook.xlsx.load(bytes)` (what loadDayWorkbook awaits) in a child, with a deadline. */
function loadInChild(bytes: Buffer, deadlineMs: number): { finished: boolean; ms: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev23-xlsx-'));
  const file = path.join(dir, 'upload.xlsx');
  fs.writeFileSync(file, bytes);
  const exceljs = require.resolve('exceljs');
  const script =
    `const E=require(${JSON.stringify(exceljs)});const b=require('fs').readFileSync(${JSON.stringify(file)});` +
    `(async()=>{const wb=new E.Workbook();await wb.xlsx.load(b);process.stdout.write('ok');})();`;
  const started = Date.now();
  const run = spawnSync(process.execPath, ['--max-old-space-size=1024', '-e', script], { timeout: deadlineMs, encoding: 'utf8', maxBuffer: 1 << 20 });
  const ms = Date.now() - started;
  fs.rmSync(dir, { recursive: true, force: true });
  return { finished: run.status === 0 && run.stdout === 'ok', ms };
}

describe('review23 money-data: day-end upload exceljs range expansion (hostile .xlsx)', () => {
  jest.setTimeout(180_000);

  it('the hostile files are a few KB and pass inspectZip and the 2 MiB cap', async () => {
    const base = await baseSheet();
    const files = {
      cols: await withRanges(base, { sqref: 'E1:E1048576 F1:F1048576' }),
      sheet: await withRanges(base, { sqref: 'A1:XFD1048576' }),
      merges: await withRanges(base, { merges: Array.from({ length: 19_000 }, (_, i) => `H${i + 2}:I${i + 2}`) }),
    };
    for (const [name, file] of Object.entries(files)) {
      expect({ name, big: file.length >= DAY_SHEET_LIMITS.maxBytes }).toEqual({ name, big: false });
      expect({ name, ok: inspectZip(file, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes }).ok }).toEqual({ name, ok: true });
    }
  });

  it('a normal day-end sheet loads in well under a second', async () => {
    const run = loadInChild(await baseSheet(), 20_000);
    expect(run.finished).toBe(true);
    expect(run.ms).toBeLessThan(5_000);
  });

  it('two "Your count" dropdowns dragged to whole columns (E,F) cost seconds per upload', async () => {
    const file = await withRanges(await baseSheet(), { sqref: 'E1:E1048576 F1:F1048576' });
    const run = loadInChild(file, 120_000);
    // ~2.1M validation cells. It does finish, but every such upload blocks the event loop for that long.
    // eslint-disable-next-line no-console
    console.log(`[rev23] whole-column dropdowns (${file.length} B): exceljs load finished=${run.finished} after ${run.ms} ms`);
    expect(run.finished).toBe(true);
    expect(run.ms).toBeGreaterThan(2_000);
  });

  it('a dropdown on the whole sheet (Ctrl+A → Data validation) does not finish within 45 s', async () => {
    const file = await withRanges(await baseSheet(), { sqref: 'A1:XFD1048576' });
    const run = loadInChild(file, 45_000);
    // eslint-disable-next-line no-console
    console.log(`[rev23] whole-sheet dropdown (${file.length} B): exceljs load finished=${run.finished} after ${run.ms} ms`);
    expect(run.finished).toBe(false); // finished:false IS the defect: the upload request would hang this long or longer
  });

  it('30,000 small merged cells do not finish within 45 s (O(merges²) overlap scan)', async () => {
    const file = await withRanges(await baseSheet(), { merges: Array.from({ length: 30_000 }, (_, i) => `H${i + 2}:I${i + 2}`) });
    expect(file.length).toBeLessThan(DAY_SHEET_LIMITS.maxBytes);
    const run = loadInChild(file, 45_000);
    // eslint-disable-next-line no-console
    console.log(`[rev23] 30,000 merges (${file.length} B): exceljs load finished=${run.finished} after ${run.ms} ms`);
    expect(run.finished).toBe(false);
  });
});

/**
 * The fix (API_CONTRACT §10.2 check 3, §10.5): before exceljs reads a byte, the upload scans the parts exceljs
 * parses and refuses a workbook beyond the day-end sheet's shape (every range within rows 1–20,000, at most
 * 1,000 ranges of a kind, 10,000 merged cells, 200,000 cells…). The hostile files above are refused in
 * milliseconds with 422 DAY_SHEET_UNREADABLE and never reach exceljs; real sheets still pass.
 */
describe('REV23 money-data-01 the day-end upload refuses ranges beyond the sheet before exceljs reads them', () => {
  jest.setTimeout(120_000);

  const conditionalFormat = (sqref: string) =>
    `</sheetData><conditionalFormatting sqref="${sqref}"><cfRule type="containsBlanks" priority="1"><formula>LEN(TRIM(E2))=0</formula></cfRule></conditionalFormatting>`;

  it('REV23 money-data-01 each hostile file is refused by the pre-check in well under a second', async () => {
    const base = await baseSheet();
    const hostile: Record<string, Buffer> = {
      'dropdowns on whole columns E and F': await withRanges(base, { sqref: 'E1:E1048576 F1:F1048576' }),
      'a dropdown on the whole sheet': await withRanges(base, { sqref: 'A1:XFD1048576' }),
      'one column-long merge': await withRanges(base, { merges: ['H1:H1048576'] }),
      '19,000 small merges': await withRanges(base, { merges: Array.from({ length: 19_000 }, (_, i) => `H${i + 2}:I${i + 2}`) }),
      '30,000 small merges': await withRanges(base, { merges: Array.from({ length: 30_000 }, (_, i) => `H${i + 2}:I${i + 2}`) }),
      'a filter name over whole columns A:G': await withDefinedName(base, '_xlnm._FilterDatabase', 'Cylinders!$A$1:$G$1048576'),
      'a name over the whole sheet': await withDefinedName(base, 'Everything', "'Cylinders'!$A$1:$XFD$1048576"),
      'a name written with character references': await withDefinedName(base, 'Hidden', 'Cylinders!$A$1:$G$&#49;048576'),
      'a conditional format on a whole column': await withSheetXml(base, (xml) => xml.replace('</sheetData>', conditionalFormat('E1:E1048576'))),
      'a declared dimension past row 20,000': await withSheetXml(base, (xml) => xml.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:G1048576"/>')),
      'a column span past XFD': await withSheetXml(base, (xml) => xml.replace('<sheetData>', '<cols><col min="1" max="2000000000" width="9"/></cols><sheetData>')),
      'a row numbered past 20,000': await withSheetXml(base, (xml) => xml.replace('</sheetData>', '<row r="1048576"><c r="A1048576"><v>1</v></c></row></sheetData>')),
      'a DOCTYPE': await withSheetXml(base, (xml) => xml.replace('?>', '?><!DOCTYPE worksheet [<!ENTITY a "a">]>')),
    };
    for (const [name, file] of Object.entries(hostile)) {
      const zipOk = inspectZip(file, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes }).ok;
      expect({ name, small: file.length < DAY_SHEET_LIMITS.maxBytes, zipOk }).toEqual({ name, small: true, zipOk: true });
      const started = Date.now();
      const check = inspectDayUpload(file);
      const ms = Date.now() - started;
      expect({ name, ok: check.ok, fast: ms < 1_000 }).toEqual({ name, ok: false, fast: true });
    }
  });

  it('REV23 money-data-01 the upload answers DAY_SHEET_UNREADABLE at once for the whole-sheet dropdown that exceljs never finishes', async () => {
    const file = await withRanges(await baseSheet(), { sqref: 'A1:XFD1048576' });
    const started = Date.now();
    const error = await readDayUpload(file).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(error).toBeInstanceOf(AppError);
    expect({ code: (error as AppError).code, status: (error as AppError).getStatus() }).toEqual({ code: 'DAY_SHEET_UNREADABLE', status: 422 });
  });

  it('REV23 money-data-01 real sheets still read: the 35-row sheet, ordinary Excel touches and a sheet of the documented maximum', async () => {
    const base = await baseSheet();
    const ordinary: Record<string, Buffer> = {
      'the sheet as made': base,
      'a filter over the data': await withDefinedName(base, '_xlnm._FilterDatabase', 'Cylinders!$A$1:$G$36'),
      'a print area over whole columns': await withDefinedName(base, '_xlnm.Print_Area', 'Cylinders!$A:$G'),
      'the dropdowns copied down to row 20,000': await withRanges(base, { sqref: 'E2:E20000 F2:F20000' }),
      'a merged note cell': await withRanges(base, { merges: ['H2:J2'] }),
      'a highlight on the count column': await withSheetXml(base, (xml) => xml.replace('</sheetData>', conditionalFormat('E2:E36'))),
      'every other column formatted (Excel writes max 16384)': await withSheetXml(base, (xml) =>
        xml.replace('<sheetData>', '<cols><col min="8" max="16384" width="9" customWidth="1"/></cols><sheetData>'),
      ),
      'the whole sheet selected when saved': await withSheetXml(base, (xml) =>
        xml.replace(/(<dimension [^>]*\/>)/, '$1<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1:XFD1048576"/></sheetView></sheetViews>'),
      ),
      '19,999 cylinder rows (the documented maximum)': await baseSheet(DAY_SHEET_LIMITS.maxRowsPerSheet - 1),
    };
    for (const [name, file] of Object.entries(ordinary)) {
      const check = inspectDayUpload(file);
      expect({ name, ok: check.ok, why: check.ok ? null : check.why }).toEqual({ name, ok: true, why: null });
    }
    const read = await readDayUpload(base);
    expect(read.about?.format).toBe('smart-fleet-day-end/1');
    expect(read.rows?.cylinders).toHaveLength(35);
  });
});
