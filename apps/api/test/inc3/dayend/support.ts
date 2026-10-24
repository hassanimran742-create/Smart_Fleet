/**
 * [Inc 3] The day-end lane's test world (API_CONTRACT §10.2, TEST_CASES DAY-001…DAY-018).
 *
 * - `createDayEndApp()`: AppModule plus DayEndModule (the gate registers the module in AppModule; importing
 *   it here too is harmless), with the HTTP set-up of main.ts, listening on a loopback port. Object storage
 *   is stubbed on FilesService's own S3 client, as the other suites do.
 * - `pinClock(app, at)`: the e2e clock. Day-end reads the current business date from DayEndClock; the cases'
 *   "Clock 2026-10-21 20:00 Asia/Karachi" pins it. Moves and stored times stay on the real clock (the scan
 *   routes write them), so a case that needs a move at a stated time sets that move's time
 *   (`setMoveTime`), the fixture way of a controllable clock.
 * - `freshWorld(app)`: a clean database with the standard data and the 35 + 3 labelled cylinders
 *   (AG-C0001…AG-C0035, BG-C0001…BG-C0003), the clock at 2026-10-21 20:00 Karachi, and steps in the cases'
 *   words (download, fill, upload, submit, approve…). `standardFixture(w)` adds DAY-001's fixture.
 *
 * Nothing here moves money.
 */
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { CustodyType, CylinderState, type PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { ERROR_MESSAGE_EN, type ErrorCode } from '@smartfleet/shared-types';
import { renderMessage } from '@smartfleet/shared-utils';
import { AppModule } from '../../../src/app.module';
import { installBigIntJson } from '../../../src/common/bootstrap/bigint-json';
import { configureApp } from '../../../src/common/bootstrap/configure-app';
import { DayEndClock } from '../../../src/modules/day-end/day-end-clock';
import { DayEndModule } from '../../../src/modules/day-end/day-end.module';
import { FilesService } from '../../../src/modules/files/files.service';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { authHeader } from '../../helpers/auth';
import { assertSafeTestDatabase, getTestPrisma, resetDb } from '../../helpers/db';
import {
  cellText,
  dayCloseLines,
  dayCloseOf,
  fillDaySheet,
  karachiTime,
  readDaySheet,
  registerStandardCylinders,
  type DaySheetCount,
  type DaySheetExtraRow,
  type StandardCylinders,
} from '../../helpers/day-end';
import { http, type TestResponse } from '../../helpers/http';
import { dayEndCalls, type DayEndCalls } from '../../helpers/inc3-calls';
import { createOrder, createTrip, loadVan, placeWithCustomer, setCylinderState, type TestCylinder, type TestTrip } from '../../helpers/runs';
import { scanCalls, type Caller, type ScanCalls } from '../../helpers/scan-calls';
import { createStandardData, type StandardData } from '../../helpers/standard-data';

export const API = '/api/v1';
export const BOOT_TIMEOUT_MS = 120_000;
export const CASE_TIMEOUT_MS = 180_000;

/** The cases' business dates. */
export const D19 = '2026-10-19';
export const D20 = '2026-10-20';
export const D21 = '2026-10-21';
export const D22 = '2026-10-22';
export const D23 = '2026-10-23';
export const D25 = '2026-10-25';

/** "Clock 2026-10-21 20:00 Asia/Karachi" (DAY-001), the default clock of every case. */
export const DEFAULT_CLOCK = karachiTime(D21, '20:00');

// ---------- the app ----------

export async function createDayEndApp(): Promise<INestApplication> {
  assertSafeTestDatabase();
  installBigIntJson();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, DayEndModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  await settleWorkers(app);
  await app.listen(0, '127.0.0.1');
  stubStorage(app);
  return app;
}

/** As test/helpers/app.ts: every BullMQ worker connected, with an error listener. */
async function settleWorkers(app: INestApplication): Promise<void> {
  let discovery: DiscoveryService;
  try {
    discovery = app.get(DiscoveryService, { strict: false });
  } catch {
    return;
  }
  for (const wrapper of discovery.getProviders()) {
    const instance: unknown = wrapper.instance;
    if (!(instance instanceof WorkerHost)) continue;
    const worker = (instance as WorkerHost).worker;
    if (!worker) continue;
    worker.on('error', () => undefined);
    await worker.waitUntilReady().catch(() => undefined);
  }
}

type S3Like = { send: (command: unknown) => Promise<unknown> };

/** Object storage answers every command (no MinIO in the test environment); returns the spy. */
export function stubStorage(app: INestApplication): jest.SpyInstance {
  const s3 = (app.get(FilesService) as unknown as { s3: S3Like }).s3;
  const spy = jest.isMockFunction(s3.send) ? (s3.send as unknown as jest.SpyInstance) : jest.spyOn(s3, 'send');
  spy.mockImplementation(async () => ({}));
  return spy;
}

/** The commands storage received, by class name (PutObjectCommand…), with their keys. */
export function storageCalls(app: INestApplication): Array<{ command: string; key: string | undefined }> {
  const s3 = (app.get(FilesService) as unknown as { s3: S3Like }).s3;
  const spy = s3.send as unknown as jest.SpyInstance;
  return spy.mock.calls.map(([command]) => ({
    command: (command as { constructor: { name: string } }).constructor.name,
    key: (command as { input?: { Key?: string } }).input?.Key,
  }));
}

/** Pins the e2e clock: the current business date day-end reads (DAY-001 "Clock 2026-10-21 20:00 Asia/Karachi"). */
export function pinClock(app: INestApplication, at: Date): void {
  const clock = app.get(DayEndClock);
  const spy = jest.isMockFunction(clock.now) ? (clock.now as unknown as jest.SpyInstance) : jest.spyOn(clock, 'now');
  spy.mockImplementation(() => new Date(at.getTime()));
}

/** Sets a setting as the office's PATCH does it (audited, cache cleared). */
export async function patchSetting(app: INestApplication, office: Caller, key: string, value: unknown, reason: string): Promise<TestResponse> {
  return http(app)
    .patch(`${API}/settings/${key}`)
    .set(authHeader('actor' in office ? office.actor : office))
    .send({ value, reason });
}

// ---------- the world ----------

export interface DayWorld {
  app: INestApplication;
  db: PrismaClient;
  std: StandardData;
  cyl: StandardCylinders;
  calls: DayEndCalls;
  scans: ScanCalls;
  /** AG-C000n (1…35). */
  ag(n: number): TestCylinder;
  /** BG-C000n (1…3). */
  bg(n: number): TestCylinder;
}

/** A clean database, the standard data, the 35 + 3 labelled cylinders, the clock at 2026-10-21 20:00 Karachi. */
export async function freshWorld(app: INestApplication): Promise<DayWorld> {
  await resetDb();
  app.get(SettingsService).invalidate();
  stubStorage(app).mockClear();
  pinClock(app, DEFAULT_CLOCK);
  const std = await createStandardData();
  const cyl = await registerStandardCylinders(std);
  const code = (prefix: string, n: number) => `${prefix}-C${String(n).padStart(4, '0')}`;
  return {
    app,
    db: getTestPrisma(),
    std,
    cyl,
    calls: dayEndCalls(app),
    scans: scanCalls(app),
    ag: (n) => {
      const cylinder = cyl.AG[code('AG', n)];
      if (!cylinder) throw new Error(`no AG cylinder ${n}`);
      return cylinder;
    },
    bg: (n) => {
      const cylinder = cyl.BG[code('BG', n)];
      if (!cylinder) throw new Error(`no BG cylinder ${n}`);
      return cylinder;
    },
  };
}

export interface StandardFixture {
  /** Kashif's trip with AG-C0010 loaded on LEA-101. */
  trip: TestTrip;
}

/**
 * DAY-001's fixture: AG-C0034 FAULTY and AG-C0035 LOST in Ahmed Gas Store; AG-C0010 loaded on van LEA-101
 * (Kashif's trip); AG-C0003 delivered to Sana (C1).
 */
export async function standardFixture(w: DayWorld): Promise<StandardFixture> {
  await setCylinderState(w.ag(34).id, CylinderState.FAULTY);
  await setCylinderState(w.ag(35).id, CylinderState.LOST);
  const order = await createOrder({ distributor: w.std.DA, client: w.std.C1, lines: [{ cylinderTypeId: w.std.sizes.kg11_8, fullCount: 1 }] });
  const trip = await createTrip({ driver: w.std.DR1, distributor: w.std.DA, orders: [order] });
  await loadVan({ trip, driver: w.std.DR1, cylinders: [w.ag(10)] });
  await placeWithCustomer({ cylinder: w.ag(3), client: w.std.C1, actor: w.std.DR1 });
  return { trip };
}

/**
 * A trip of the driver for the distributor's orders, waiting at the store: `needs` cylinders of one size
 * still to load (a real LOAD scan goes through `w.scans.tripScan`).
 */
export async function tripNeeding(
  w: DayWorld,
  p: { driver: 'DR1' | 'DR2'; size: 'kg11_8' | 'kg15' | 'kg45_4'; needs: number },
): Promise<TestTrip> {
  const order = await createOrder({ distributor: w.std.DA, client: w.std.C1, lines: [{ cylinderTypeId: w.std.sizes[p.size], fullCount: p.needs }] });
  return createTrip({ driver: w.std[p.driver], distributor: w.std.DA, orders: [order] });
}

/** A real LOAD scan of `cylinder` on the trip's store stop (201 RECORDED expected by the caller). */
export function loadScan(w: DayWorld, driver: 'DR1' | 'DR2', trip: TestTrip, cylinder: TestCylinder) {
  return w.scans.tripScan(w.std[driver], trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: cylinder.qrCode });
}

/** A real store receive (`POST /store/scans`) by the shop. */
export function receiveScan(w: DayWorld, cylinder: TestCylinder, shop: 'DA' | 'DB' = 'DA') {
  return w.scans.storeScan(w.std[shop], { code: cylinder.qrCode });
}

/** Cylinders left on a van from a run of the driver (fixture: loaded, not delivered). */
export async function onVan(w: DayWorld, driver: 'DR1' | 'DR2', cylinders: TestCylinder[], size: 'kg11_8' | 'kg15' | 'kg45_4'): Promise<TestTrip> {
  const trip = await tripNeeding(w, { driver, size, needs: cylinders.length });
  await loadVan({ trip, driver: w.std[driver], cylinders });
  return trip;
}

// ---------- the sheet, in the shop's words ----------

/** `GET /day-end/:date/sheet.xlsx` as the shop: 200 and the file's bytes. */
export async function download(w: DayWorld, date = D21, shop: 'DA' | 'DB' = 'DA'): Promise<Buffer> {
  const res = await w.calls.sheet(w.std[shop], date);
  if (res.status !== 200) throw new Error(`download ${date}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Buffer;
}

/** Fills a downloaded sheet the way the shop does (fillDaySheet). */
export function fill(
  sheet: Buffer,
  rows: Record<string, DaySheetCount> = {},
  more: { extra?: DaySheetExtraRow[]; deleteRows?: string[]; edit?: (workbook: ExcelJS.Workbook) => void } = {},
): Promise<Buffer> {
  return fillDaySheet(sheet, { rows, ...more });
}

/** `POST /day-end/:date/upload` as the shop. */
export function upload(w: DayWorld, file: Buffer, date = D21, shop: 'DA' | 'DB' = 'DA') {
  return w.calls.upload(w.std[shop], date, file);
}

/** Download, fill and upload in one go: the upload's answer (200 expected). */
export async function sendSheet(
  w: DayWorld,
  rows: Record<string, DaySheetCount>,
  more: { date?: string; extra?: DaySheetExtraRow[]; shop?: 'DA' | 'DB' } = {},
): Promise<TestResponse> {
  const date = more.date ?? D21;
  const sheet = await download(w, date, more.shop ?? 'DA');
  const res = await upload(w, await fill(sheet, rows, { extra: more.extra }), date, more.shop ?? 'DA');
  if (res.status !== 200) throw new Error(`upload ${date}: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}

/** A day SUBMITTED at the given version: `versions` uploads (the last with `rows`), then the submit. */
export async function submittedDay(
  w: DayWorld,
  rows: Record<string, DaySheetCount>,
  p: { date?: string; versions?: number; note?: string; extra?: DaySheetExtraRow[] } = {},
): Promise<{ id: string; version: number }> {
  const date = p.date ?? D21;
  const versions = p.versions ?? 1;
  for (let v = 1; v < versions; v++) await sendSheet(w, {}, { date });
  const last = await sendSheet(w, rows, { date, extra: p.extra });
  const version = last.body.version as number;
  const submit = await w.calls.submit(w.std.DA, date, { version, ...(p.note ? { note: p.note } : {}) });
  if (submit.status !== 200) throw new Error(`submit ${date}: ${submit.status} ${JSON.stringify(submit.body)}`);
  const day = await dayCloseOf(w.std.DA.id, date);
  if (!day) throw new Error('no day row');
  return { id: day.id, version };
}

/** `POST /admin/day-end/:id/approve` as SA1 (200 expected). */
export async function approve(w: DayWorld, dayId: string, version: number, office: 'SA1' | 'SA2' = 'SA1'): Promise<TestResponse> {
  const res = await w.calls.approve(w.std[office], dayId, { version });
  if (res.status !== 200) throw new Error(`approve: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}

// ---------- readers ----------

/** Every visible cell of a workbook as text, by sheet (the hidden "About" left out unless asked). */
export async function visibleCells(buffer: Buffer, opts: { withHidden?: boolean } = {}): Promise<Record<string, string[]>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const out: Record<string, string[]> = {};
  for (const sheet of workbook.worksheets) {
    if (!opts.withHidden && sheet.state !== 'visible') continue;
    const cells: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => cells.push(cellText(cell.value))));
    out[sheet.name] = cells;
  }
  return out;
}

/** The sheet's rows by cylinder number. */
export async function sheetRowsByNumber(buffer: Buffer) {
  const sheet = await readDaySheet(buffer);
  return new Map(sheet.cylinders.map((row) => [row.number, row]));
}

/** Every cylinder of the given distributors: holder, state and last move, by id. */
export async function holderSnapshot(db: PrismaClient, distributorIds: string[]) {
  const rows = await db.cylinder.findMany({
    where: { distributorId: { in: distributorIds } },
    select: { id: true, custodyType: true, custodyId: true, state: true, lastEventId: true, shortNo: true, distributorId: true },
    orderBy: [{ distributorId: 'asc' }, { shortNo: 'asc' }],
  });
  return rows;
}

/** Row counts that must not move: cylinder events, ledger rows, cylinders. */
export async function rowCounts(db: PrismaClient): Promise<{ events: number; ledger: number; cylinders: number }> {
  const [events, ledger, cylinders] = await Promise.all([db.cylinderEvent.count(), db.ledgerEntry.count(), db.cylinder.count()]);
  return { events, ledger, cylinders };
}

/** The day's lines by sheet key. */
export async function linesByKey(dayId: string) {
  const lines = await dayCloseLines(dayId);
  return new Map(lines.map((line) => [line.sheetKey, line]));
}

/** The differences of an upload or review answer, by short code. */
export function byShortCode<T extends { shortCode: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.shortCode, item]));
}

/** Sets the time of a cylinder's last move: the scan "at 02:30" of a cut-off case, written by the real route. */
export async function setMoveTime(db: PrismaClient, cylinderId: string, at: Date): Promise<string> {
  const cylinder = await db.cylinder.findUniqueOrThrow({ where: { id: cylinderId }, select: { lastEventId: true } });
  if (!cylinder.lastEventId) throw new Error('the cylinder has no move');
  await db.cylinderEvent.update({ where: { id: cylinder.lastEventId }, data: { createdAt: at } });
  return cylinder.lastEventId;
}

/** Where a cylinder is now. */
export async function holderOf(db: PrismaClient, cylinderId: string) {
  return db.cylinder.findUniqueOrThrow({
    where: { id: cylinderId },
    select: { custodyType: true, custodyId: true, state: true, lastEventId: true, shortNo: true },
  });
}

/** The van a driver drives (LEA-101 for Kashif, LEB-202 for Imran). */
export function vanOf(w: DayWorld, driver: 'DR1' | 'DR2'): string {
  const id = w.std[driver].vehicleId;
  if (!id) throw new Error(`${driver} has no van`);
  return id;
}

/** The store of a shop. */
export function storeOf(w: DayWorld, shop: 'DA' | 'DB'): { type: CustodyType; id: string } {
  return { type: CustodyType.STORE, id: w.std[shop].homeStoreId };
}

// ---------- answers ----------

/** The catalogue English of a code with its details, as the API renders it. */
export function english(code: ErrorCode, details?: Record<string, unknown>): string {
  return renderMessage(ERROR_MESSAGE_EN[code], details);
}

/** The JSON body of an answer, also when it was read as bytes (the sheet download's error answers). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonOf(res: TestResponse): any {
  if (Buffer.isBuffer(res.body)) {
    try {
      return JSON.parse(res.body.toString('utf8'));
    } catch {
      return undefined;
    }
  }
  return res.body;
}

/** Status and code of an error answer, for one compact assertion. */
export function errorOf(res: TestResponse): { status: number; code: unknown } {
  return { status: res.status, code: jsonOf(res)?.code };
}
