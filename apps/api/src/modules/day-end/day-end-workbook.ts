import ExcelJS from 'exceljs';
import {
  DAY_SHEET_ABOUT_KEYS,
  DAY_SHEET_CYLINDER_HEADERS,
  DAY_SHEET_EXTRA_HEADERS,
  DAY_SHEET_NAMES,
  DAY_SHEET_PLACE_WORDS,
  DAY_SHEET_STATE_WORDS,
  type DaySheetAbout,
} from '@smartfleet/shared-types';

/**
 * [Inc 3] The day-end workbook (API_CONTRACT §10.2) written and read with exceljs 4.4.0. The layout comes
 * from shared-types (`DAY_SHEET_*`), the one contract for the sheet maker, the upload reader, the apps
 * and the tests:
 *
 * - "Cylinders": header row 1 (`DAY_SHEET_CYLINDER_HEADERS`), then one row per cylinder;
 * - "Extra cylinders": header row 1 (`DAY_SHEET_EXTRA_HEADERS`), for numbers found that aren't listed;
 * - "About" (exceljs `veryHidden`): column A the key, column B the value (`DAY_SHEET_ABOUT_KEYS`).
 *
 * Nothing here reads the database or decides a rule; the row rules are in day-end-rows.ts.
 */

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** One "Cylinders" row as the sheet maker writes it ("App says" is the app at the sheet time). */
export interface DaySheetRowOut {
  /** "AG-C0042". */
  number: string;
  /** "11.8 kg". */
  size: string;
  /** "In my store", "On driver's van · LEA-101", "With customer · Sana" or "Missing". */
  appWhere: string;
  /** "Full", "Empty", "Part-filled", "Damaged", or empty for a LOST cylinder. */
  appState: string;
}

/** Extra rows offered with the size and state lists (more can be typed). */
const EXTRA_ROWS_WITH_LISTS = 200;

/** exceljs 4.4.0 keeps range validations on `worksheet.dataValidations`, which its typings leave out. */
function validations(sheet: ExcelJS.Worksheet): { add(address: string, validation: ExcelJS.DataValidation): void } {
  return (sheet as unknown as { dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void } }).dataValidations;
}

function listFormula(words: readonly string[]): string {
  return `"${words.join(',')}"`;
}

/** Builds the sheet the shop downloads (one row per cylinder, in the order given). */
export async function buildDaySheetWorkbook(p: {
  about: DaySheetAbout;
  rows: readonly DaySheetRowOut[];
  /** The sizes the Extra cylinders sheet offers ("11.8 kg"), lightest first. */
  sizes: readonly string[];
  createdAt: Date;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Smart Fleet';
  workbook.created = p.createdAt;

  const placeWords = Object.values(DAY_SHEET_PLACE_WORDS);
  const stateWords = Object.values(DAY_SHEET_STATE_WORDS);

  const main = workbook.addWorksheet(DAY_SHEET_NAMES.CYLINDERS, { views: [{ state: 'frozen', ySplit: 1 }] });
  const widths = [17, 10, 30, 14, 20, 18, 34];
  main.columns = DAY_SHEET_CYLINDER_HEADERS.map((header, index) => ({ header, width: widths[index] }));
  styleHeader(main.getRow(1), [5, 6, 7]);
  for (const row of p.rows) main.addRow([row.number, row.size, row.appWhere, row.appState || null, null, null, null]);
  if (p.rows.length > 0) {
    const last = p.rows.length + 1;
    validations(main).add(`E2:E${last}`, listValidation(placeWords, 'Where', 'Choose In my store, On driver\'s van, With customer or Missing.'));
    validations(main).add(`F2:F${last}`, listValidation(stateWords, 'State', 'Choose Full, Empty, Part-filled or Damaged.'));
  }

  const extra = workbook.addWorksheet(DAY_SHEET_NAMES.EXTRA, { views: [{ state: 'frozen', ySplit: 1 }] });
  extra.columns = DAY_SHEET_EXTRA_HEADERS.map((header, index) => ({ header, width: [17, 12, 14][index] }));
  styleHeader(extra.getRow(1), [1, 2, 3]);
  const lastExtra = EXTRA_ROWS_WITH_LISTS + 1;
  if (p.sizes.length > 0) validations(extra).add(`B2:B${lastExtra}`, listValidation(p.sizes, 'Size', 'Choose a size from the list.'));
  validations(extra).add(`C2:C${lastExtra}`, listValidation(stateWords, 'State', 'Choose Full, Empty, Part-filled or Damaged.'));

  const about = workbook.addWorksheet(DAY_SHEET_NAMES.ABOUT, { state: 'veryHidden' });
  for (const key of DAY_SHEET_ABOUT_KEYS) about.addRow([key, p.about[key]]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function styleHeader(row: ExcelJS.Row, highlight: readonly number[]): void {
  row.font = { bold: true };
  for (const column of highlight) {
    row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  }
  row.commit();
}

function listValidation(words: readonly string[], title: string, error: string): ExcelJS.DataValidation {
  return {
    type: 'list',
    allowBlank: true,
    formulae: [listFormula(words)],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: title,
    error,
  };
}

// ---------- reading an upload ----------

/** The text of a cell as a person reads it: rich text joined, a formula's result, a link's text. */
export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if ('hyperlink' in value) return typeof value.text === 'string' ? value.text : cellText(value.text as ExcelJS.CellValue);
    if ('error' in value) return '';
    if ('result' in value) return cellText((value as { result?: ExcelJS.CellValue }).result);
  }
  return '';
}

/**
 * Loads an upload as a workbook, or null when exceljs can't read it or a sheet has more than `maxRows`
 * rows. Run {@link inspectZip} first: exceljs inflates every entry in memory.
 */
export async function loadDayWorkbook(bytes: Buffer, limits: { maxRows: number }): Promise<ExcelJS.Workbook | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types its input as its own Buffer (an ArrayBuffer); at run time it takes a Node Buffer.
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > limits.maxRows) return null;
  }
  return workbook;
}

/** A sheet by name, ignoring letter case and surrounding spaces. */
function sheetNamed(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const wanted = name.trim().toLowerCase();
  return workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === wanted);
}

/** The "About" sheet's values (column A the key, column B the value), or null when the sheet is missing. */
export function readAbout(workbook: ExcelJS.Workbook): Record<string, string> | null {
  const sheet = sheetNamed(workbook, DAY_SHEET_NAMES.ABOUT);
  if (!sheet) return null;
  const about: Record<string, string> = {};
  sheet.eachRow((row) => {
    const key = cellText(row.getCell(1).value).trim();
    if (key && !(key in about)) about[key] = cellText(row.getCell(2).value).trim();
  });
  return about;
}

/** One "Cylinders" row as uploaded: its Excel row number and the cells the rules read. */
export interface UploadedCylinderRow {
  row: number;
  number: string;
  where: string;
  state: string;
  why: string;
}

/** One "Extra cylinders" row as uploaded. */
export interface UploadedExtraRow {
  row: number;
  number: string;
  size: string;
  state: string;
}

export interface UploadedDaySheet {
  cylinders: UploadedCylinderRow[];
  extra: UploadedExtraRow[];
}

/** Header words as compared: spaces collapsed and trimmed, ’ read as ', any letter case. */
function headerWords(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function headersMatch(sheet: ExcelJS.Worksheet, expected: readonly string[]): boolean {
  const header = sheet.getRow(1);
  return expected.every((word, index) => headerWords(cellText(header.getCell(index + 1).value)) === headerWords(word));
}

/**
 * The "Cylinders" and "Extra cylinders" rows, or null when either sheet is missing or its header row
 * changed (check 7). Rows with every read cell blank are left out: a cylinder row emptied or deleted
 * matches. Cells right of the contract's columns are ignored.
 */
export function readUploadedRows(workbook: ExcelJS.Workbook): UploadedDaySheet | null {
  const main = sheetNamed(workbook, DAY_SHEET_NAMES.CYLINDERS);
  const extra = sheetNamed(workbook, DAY_SHEET_NAMES.EXTRA);
  if (!main || !extra) return null;
  if (!headersMatch(main, DAY_SHEET_CYLINDER_HEADERS) || !headersMatch(extra, DAY_SHEET_EXTRA_HEADERS)) return null;

  const cylinders: UploadedCylinderRow[] = [];
  main.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = DAY_SHEET_CYLINDER_HEADERS.map((_, index) => cellText(row.getCell(index + 1).value));
    if (cells.every((cell) => cell.trim() === '')) return;
    cylinders.push({ row: rowNumber, number: cells[0], where: cells[4], state: cells[5], why: cells[6] });
  });

  const extras: UploadedExtraRow[] = [];
  extra.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = DAY_SHEET_EXTRA_HEADERS.map((_, index) => cellText(row.getCell(index + 1).value));
    if (cells.every((cell) => cell.trim() === '')) return;
    extras.push({ row: rowNumber, number: cells[0], size: cells[1], state: cells[2] });
  });

  return { cylinders, extra: extras };
}
