/**
 * [Inc 3] Day-end fixtures (API_CONTRACT §10.2, DATA_MODEL §5.3): the standard data's labelled
 * cylinders, Karachi wall-clock instants, day rows and their lines, stored sheet files, and the sheet
 * itself (built, read and filled in with exceljs, the way the shop fills in the downloaded sheet).
 *
 *   const std = await createStandardData();
 *   const cyl = await registerStandardCylinders(std);          // cyl.AG['AG-C0005'], cyl.BG['BG-C0001']
 *   const sheet = (await dayEnd.sheet(std.DA, '2026-10-21').expect(200)).body as Buffer;   // dayEndCalls, inc3-calls.ts
 *   const filled = await fillDaySheet(sheet, { rows: { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } } });
 *   await dayEnd.upload(std.DA, '2026-10-21', filled).expect(200);
 *
 * The sheet's names, headers, "About" keys and words come from shared-types (DAY_SHEET_*), the one
 * contract for the sheet maker and the upload reader. Nothing here moves money.
 */
import { createHash, randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { CylinderState, DayCloseDiff, DayClosePlace, DayCloseStatus, Prisma, PrismaClient, StoredFilePurpose } from '@prisma/client';
import {
  DAY_SHEET_ABOUT_KEYS,
  DAY_SHEET_CYLINDER_HEADERS,
  DAY_SHEET_EXTRA_HEADERS,
  DAY_SHEET_FORMAT,
  DAY_SHEET_NAMES,
  type DaySheetAbout,
} from '@smartfleet/shared-types';
import { businessDayRange, type BusinessDayOptions } from '@smartfleet/shared-utils';
import { getTestPrisma } from './db';
import type { TestDistributor } from './factories';
import { registerCylinders, type MoveActor, type TestCylinder } from './runs';
import type { StandardData } from './standard-data';

type Db = PrismaClient | Prisma.TransactionClient;

function actorId(actor: MoveActor): string {
  if ('userId' in actor) return actor.userId;
  return actor.id;
}

// ---------- the standard cylinders ----------

export interface StandardCylinders {
  /** Ahmed Gas's AG-C0001…AG-C0035 by short code. */
  AG: Record<string, TestCylinder>;
  /** Bilal Gas's BG-C0001…BG-C0003 by short code (empty with `bilal: false`). */
  BG: Record<string, TestCylinder>;
}

/**
 * The standard data's labelled stock (TEST_CASES.md "Cylinders"), registered as the Inc 2 bulk-register
 * makes it: AG-C0001…AG-C0020 11.8 kg, AG-C0021…AG-C0030 15 kg, AG-C0031…AG-C0035 45.4 kg, all FULL in
 * Ahmed Gas Store, numbered from `next_cylinder_no` (call it before any other registration of Ahmed
 * Gas's, so the numbers start at 1), plus the extra fixture BG-C0001…BG-C0003 (11.8 kg, FULL, Bilal Gas's
 * store). Each has one REGISTERED event. Next free numbers: AG 36, BG 4.
 */
export async function registerStandardCylinders(
  std: Pick<StandardData, 'DA' | 'DB' | 'sizes' | 'SA1'>,
  opts: { bilal?: boolean } = {},
  db: Db = getTestPrisma(),
): Promise<StandardCylinders> {
  const AG: Record<string, TestCylinder> = {};
  const BG: Record<string, TestCylinder> = {};
  const plan: Array<[number, string]> = [
    [20, std.sizes.kg11_8],
    [10, std.sizes.kg15],
    [5, std.sizes.kg45_4],
  ];
  for (const [count, cylinderTypeId] of plan) {
    for (const cylinder of await registerCylinders({ distributor: std.DA, cylinderTypeId, count, actor: std.SA1 }, db)) {
      AG[cylinder.shortCode] = cylinder;
    }
  }
  if (opts.bilal ?? true) {
    for (const cylinder of await registerCylinders({ distributor: std.DB, cylinderTypeId: std.sizes.kg11_8, count: 3, actor: std.SA1 }, db)) {
      BG[cylinder.shortCode] = cylinder;
    }
  }
  const expected = ['AG-C0001', 'AG-C0035'];
  for (const code of expected) {
    if (!AG[code]) throw new Error(`registerStandardCylinders: ${code} wasn't made; register these before any other Ahmed Gas cylinder`);
  }
  return { AG, BG };
}

// ---------- business-day time ----------

/**
 * The instant a wall clock in `timezone` (default Asia/Karachi) reads `time` ("HH:mm") on `date`
 * ("YYYY-MM-DD"): `karachiTime('2026-10-22', '02:30')` is 2026-10-21T21:30:00.000Z. Use it for fixture
 * times (`recordMove({ at })`, `pickUpForRefill({ at })`) in cut-off cases.
 */
export function karachiTime(date: string, time: string, timezone = 'Asia/Karachi'): Date {
  // businessDayRange with a cut-off of `time` starts exactly at that wall-clock time on `date`.
  return businessDayRange(date, { timezone, cutoffLocalTime: time }).start;
}

/** A business day's bounds (start inclusive, end exclusive), with the settings' defaults. */
export function businessDayBounds(date: string, options: BusinessDayOptions = {}): { start: Date; end: Date } {
  return businessDayRange(date, options);
}

// ---------- stored files ----------

/**
 * A `stored_files` row as FilesService writes it (no object is put in storage): a day-end sheet
 * (DAY_END_SHEET, the sheet the server made) or an upload (DAY_END_UPLOAD).
 */
export async function createStoredFile(
  opts: {
    purpose: StoredFilePurpose;
    uploadedBy: MoveActor;
    distributorId?: string | null;
    mimeType?: string;
    bytes?: Buffer;
    originalName?: string;
    id?: string;
  },
  db: Db = getTestPrisma(),
): Promise<{ id: string; storageKey: string }> {
  const id = opts.id ?? randomUUID();
  const bytes = opts.bytes ?? Buffer.from(`fixture ${id}`);
  const storageKey = `uploads/${new Date().toISOString().slice(0, 10)}/${id}.xlsx`;
  await db.storedFile.create({
    data: {
      id,
      storageKey,
      purpose: opts.purpose,
      mimeType: opts.mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      originalName: opts.originalName ?? null,
      uploadedByUserId: actorId(opts.uploadedBy),
      distributorId: opts.distributorId ?? null,
    },
  });
  return { id, storageKey };
}

// ---------- day rows and lines ----------

export interface TestDayClose {
  id: string;
  distributorId: string;
  businessDate: string;
}

/**
 * A `day_closes` row (DATA_MODEL §5.3), as the day-end routes leave it: OPEN by default. APPROVED sets
 * `locked_at` with `approved_at` (day_closes_locked_chk), SUBMITTED sets `submitted_at`. Times default to
 * now where a status needs them.
 */
export async function createDayClose(
  opts: {
    distributor: Pick<TestDistributor, 'id'>;
    /** "YYYY-MM-DD". */
    businessDate: string;
    status?: DayCloseStatus;
    sheetSnapshotAt?: Date | null;
    sheetFileId?: string | null;
    uploadFileId?: string | null;
    uploadVersion?: number;
    uploadedAt?: Date | null;
    uploadedBy?: MoveActor | null;
    submittedAt?: Date | null;
    approvedAt?: Date | null;
    approvedBy?: MoveActor | null;
    sentBackAt?: Date | null;
    sentBackReason?: string | null;
    reopenedAt?: Date | null;
    reopenReason?: string | null;
    totals?: Prisma.InputJsonValue | null;
  },
  db: Db = getTestPrisma(),
): Promise<TestDayClose> {
  const status = opts.status ?? DayCloseStatus.OPEN;
  const now = new Date();
  const approved = status === DayCloseStatus.APPROVED;
  const row = await db.dayClose.create({
    data: {
      distributorId: opts.distributor.id,
      businessDate: new Date(`${opts.businessDate}T00:00:00.000Z`),
      status,
      sheetSnapshotAt: opts.sheetSnapshotAt ?? null,
      sheetFileId: opts.sheetFileId ?? null,
      uploadFileId: opts.uploadFileId ?? null,
      uploadVersion: opts.uploadVersion ?? 0,
      uploadedAt: opts.uploadedAt ?? null,
      uploadedByUserId: opts.uploadedBy ? actorId(opts.uploadedBy) : null,
      submittedAt: opts.submittedAt ?? (status === DayCloseStatus.SUBMITTED || approved ? now : null),
      approvedAt: opts.approvedAt ?? (approved ? now : null),
      approvedByUserId: opts.approvedBy ? actorId(opts.approvedBy) : null,
      lockedAt: approved ? opts.approvedAt ?? now : null,
      sentBackAt: opts.sentBackAt ?? null,
      sentBackReason: opts.sentBackReason ?? null,
      reopenedAt: opts.reopenedAt ?? null,
      reopenReason: opts.reopenReason ?? null,
      totals: opts.totals === null || opts.totals === undefined ? Prisma.DbNull : opts.totals,
    },
    select: { id: true },
  });
  return { id: row.id, distributorId: opts.distributor.id, businessDate: opts.businessDate };
}

/** One `day_close_lines` row; `diff` defaults to MATCH, and an UNKNOWN_CYLINDER line has no cylinder. */
export interface TestDayCloseLineInput {
  cylinderId?: string | null;
  /** The number in its normal form, "AG-C0042". */
  sheetKey: string;
  cylinderTypeId?: string | null;
  systemPlace?: DayClosePlace | null;
  systemHolderId?: string | null;
  systemState?: CylinderState | null;
  systemLastEventId?: string | null;
  reportedPlace?: DayClosePlace | null;
  reportedState?: CylinderState | null;
  note?: string | null;
  diff?: DayCloseDiff;
  appliedEventId?: string | null;
  skippedMovedAt?: Date | null;
}

/** Adds lines to a day (as an upload stores them). Returns their ids in order. */
export async function addDayCloseLines(dayCloseId: string, lines: TestDayCloseLineInput[], db: Db = getTestPrisma()): Promise<string[]> {
  const ids: string[] = [];
  for (const line of lines) {
    const row = await db.dayCloseLine.create({
      data: {
        dayCloseId,
        cylinderId: line.cylinderId ?? null,
        sheetKey: line.sheetKey,
        cylinderTypeId: line.cylinderTypeId ?? null,
        systemPlace: line.systemPlace ?? null,
        systemHolderId: line.systemHolderId ?? null,
        systemState: line.systemState ?? null,
        systemLastEventId: line.systemLastEventId ?? null,
        reportedPlace: line.reportedPlace ?? null,
        reportedState: line.reportedState ?? null,
        note: line.note ?? null,
        diff: line.diff ?? DayCloseDiff.MATCH,
        appliedEventId: line.appliedEventId ?? null,
        skippedMovedAt: line.skippedMovedAt ?? null,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

/** The day row of a distributor and business date, or null. */
export async function dayCloseOf(distributorId: string, businessDate: string, db: Db = getTestPrisma()) {
  return db.dayClose.findUnique({
    where: { distributorId_businessDate: { distributorId, businessDate: new Date(`${businessDate}T00:00:00.000Z`) } },
  });
}

/** A day's lines in sheet-key order. */
export async function dayCloseLines(dayCloseId: string, db: Db = getTestPrisma()) {
  return db.dayCloseLine.findMany({ where: { dayCloseId }, orderBy: [{ sheetKey: 'asc' }, { id: 'asc' }] });
}

// ---------- the sheet (exceljs) ----------

/** One row of the "Cylinders" sheet, in the column order of DAY_SHEET_CYLINDER_HEADERS. */
export interface DaySheetCylinderRow {
  /** "AG-C0042" (any §1.1 form is read). */
  number: string;
  size: string;
  appWhere: string;
  appState: string;
  countWhere?: string;
  countState?: string;
  why?: string;
}

/** One row of the "Extra cylinders" sheet: a number found that isn't on the list. */
export interface DaySheetExtraRow {
  number: string;
  size?: string;
  state?: string;
}

/** What {@link readDaySheet} finds: the sheets' names and states, the About values, and every row with its Excel row number. */
export interface DaySheetContents {
  sheets: Array<{ name: string; state: string }>;
  about: Record<string, string>;
  cylinderHeaders: string[];
  cylinders: Array<DaySheetCylinderRow & { row: number }>;
  extraHeaders: string[];
  extra: Array<DaySheetExtraRow & { row: number }>;
}

/** The text of a cell value as a person reads it: rich text joined, a formula's result, a hyperlink's text. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('hyperlink' in value) return value.text;
  if ('error' in value) return '';
  if ('result' in value) return value.result === undefined ? '' : cellText(value.result as ExcelJS.CellValue);
  return '';
}

/**
 * A day-end workbook built from scratch with the contract's layout (API_CONTRACT §10.2): "Cylinders"
 * (header row 1, then one row per cylinder), "Extra cylinders" (header row 1), and the hidden "About"
 * (exceljs `veryHidden`; column A the key, column B the value, one row per key). Use it to test the
 * upload reader on its own; `headers` and `about` overrides make broken sheets.
 */
export async function buildDaySheet(p: {
  about: DaySheetAbout | Record<string, string>;
  cylinders: DaySheetCylinderRow[];
  extra?: DaySheetExtraRow[];
  /** Override the header rows (a changed header makes the sheet unreadable). */
  cylinderHeaders?: readonly string[];
  extraHeaders?: readonly string[];
  /** Leave a sheet out. */
  omit?: Array<keyof typeof DAY_SHEET_NAMES>;
  /** Rename the Cylinders sheet. */
  cylindersSheetName?: string;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const omit = new Set(p.omit ?? []);
  if (!omit.has('CYLINDERS')) {
    const sheet = workbook.addWorksheet(p.cylindersSheetName ?? DAY_SHEET_NAMES.CYLINDERS);
    sheet.addRow([...(p.cylinderHeaders ?? DAY_SHEET_CYLINDER_HEADERS)]);
    for (const row of p.cylinders) {
      sheet.addRow([row.number, row.size, row.appWhere, row.appState, row.countWhere ?? null, row.countState ?? null, row.why ?? null]);
    }
  }
  if (!omit.has('EXTRA')) {
    const sheet = workbook.addWorksheet(DAY_SHEET_NAMES.EXTRA);
    sheet.addRow([...(p.extraHeaders ?? DAY_SHEET_EXTRA_HEADERS)]);
    for (const row of p.extra ?? []) sheet.addRow([row.number, row.size ?? null, row.state ?? null]);
  }
  if (!omit.has('ABOUT')) {
    const sheet = workbook.addWorksheet(DAY_SHEET_NAMES.ABOUT, { state: 'veryHidden' });
    const about = p.about as Record<string, string>;
    const keys = [...DAY_SHEET_ABOUT_KEYS, ...Object.keys(about).filter((key) => !(DAY_SHEET_ABOUT_KEYS as readonly string[]).includes(key))];
    for (const key of keys) if (about[key] !== undefined) sheet.addRow([key, about[key]]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The About values of a fresh sheet for a day: the format, the shop, the date and the sheet file. */
export function daySheetAbout(p: { distributorId: string; distributorCode: string; businessDate: string; sheetFileId: string }): DaySheetAbout {
  return { format: DAY_SHEET_FORMAT, ...p };
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs types its Buffer as an ArrayBuffer; at run time it takes a Node Buffer.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer as never);
  return workbook;
}

function rowValues(row: ExcelJS.Row, width: number): string[] {
  const out: string[] = [];
  for (let column = 1; column <= width; column++) out.push(cellText(row.getCell(column).value).trim());
  return out;
}

/** Reads a day-end workbook (the one the server made, or one a test built or filled in). */
export async function readDaySheet(buffer: Buffer): Promise<DaySheetContents> {
  const workbook = await loadWorkbook(buffer);
  const sheets = workbook.worksheets.map((sheet) => ({ name: sheet.name, state: String(sheet.state ?? 'visible') }));
  const about: Record<string, string> = {};
  workbook.getWorksheet(DAY_SHEET_NAMES.ABOUT)?.eachRow((row) => {
    const key = cellText(row.getCell(1).value).trim();
    if (key) about[key] = cellText(row.getCell(2).value).trim();
  });
  const cylinders: DaySheetContents['cylinders'] = [];
  let cylinderHeaders: string[] = [];
  const main = workbook.getWorksheet(DAY_SHEET_NAMES.CYLINDERS);
  main?.eachRow((row, rowNumber) => {
    const [number, size, appWhere, appState, countWhere, countState, why] = rowValues(row, DAY_SHEET_CYLINDER_HEADERS.length);
    if (rowNumber === 1) {
      cylinderHeaders = [number, size, appWhere, appState, countWhere, countState, why];
      return;
    }
    if (!number && !size && !appWhere) return;
    cylinders.push({ row: rowNumber, number, size, appWhere, appState, countWhere, countState, why });
  });
  const extra: DaySheetContents['extra'] = [];
  let extraHeaders: string[] = [];
  workbook.getWorksheet(DAY_SHEET_NAMES.EXTRA)?.eachRow((row, rowNumber) => {
    const [number, size, state] = rowValues(row, DAY_SHEET_EXTRA_HEADERS.length);
    if (rowNumber === 1) {
      extraHeaders = [number, size, state];
      return;
    }
    if (!number && !size && !state) return;
    extra.push({ row: rowNumber, number, size, state });
  });
  return { sheets, about, cylinderHeaders, cylinders, extraHeaders, extra };
}

/** The shop's count for one cylinder row: the three "Your count" cells (a blank leaves the cell as it is). */
export interface DaySheetCount {
  where?: string;
  state?: string;
  why?: string;
}

/**
 * Fills in a downloaded sheet the way the shop does: `rows` by cylinder number ("AG-C0005") sets that
 * row's "Your count: where", "Your count: state" and "Why different"; `extra` appends rows to "Extra
 * cylinders"; `deleteRows` removes cylinder rows (a deleted row matches); `edit` may change anything
 * else (rename a sheet, change a header, drop the About sheet). Returns the new file's bytes.
 */
export async function fillDaySheet(
  buffer: Buffer,
  p: {
    rows?: Record<string, DaySheetCount>;
    extra?: DaySheetExtraRow[];
    deleteRows?: string[];
    edit?: (workbook: ExcelJS.Workbook) => void;
  } = {},
): Promise<Buffer> {
  const workbook = await loadWorkbook(buffer);
  const main = workbook.getWorksheet(DAY_SHEET_NAMES.CYLINDERS);
  if (!main) throw new Error('fillDaySheet: the sheet has no "Cylinders" tab');
  const wanted = new Map(Object.entries(p.rows ?? {}).map(([number, count]) => [number.toUpperCase(), count]));
  const found = new Set<string>();
  const toDelete: number[] = [];
  const deletions = new Set((p.deleteRows ?? []).map((number) => number.toUpperCase()));
  main.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const number = cellText(row.getCell(1).value).trim().toUpperCase();
    if (deletions.has(number)) toDelete.push(rowNumber);
    const count = wanted.get(number);
    if (!count) return;
    found.add(number);
    if (count.where !== undefined) row.getCell(5).value = count.where;
    if (count.state !== undefined) row.getCell(6).value = count.state;
    if (count.why !== undefined) row.getCell(7).value = count.why;
    row.commit();
  });
  for (const number of wanted.keys()) if (!found.has(number)) throw new Error(`fillDaySheet: no row for ${number}`);
  for (const rowNumber of toDelete.sort((a, b) => b - a)) main.spliceRows(rowNumber, 1);
  if (p.extra?.length) {
    const extra = workbook.getWorksheet(DAY_SHEET_NAMES.EXTRA);
    if (!extra) throw new Error('fillDaySheet: the sheet has no "Extra cylinders" tab');
    for (const row of p.extra) extra.addRow([row.number, row.size ?? null, row.state ?? null]);
  }
  p.edit?.(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
