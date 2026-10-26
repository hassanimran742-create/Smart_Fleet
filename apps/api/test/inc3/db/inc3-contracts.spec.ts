/**
 * The Increment 3 contracts this lane ships (no database): the shared-types mirrors of the inc3 Prisma
 * enums, the Inc 3 settings unlocked by RELEASE_INCREMENT 3 (day-end on by default once Inc 3 ships,
 * API_CONTRACT §6), the Inc 3 request schemas (refill scans and advance, the day-end bodies, the pilot
 * setup file), the day-end sheet rules in shared-utils (the words, "Why different", the difference and
 * the fix of settled point G09-03), the refill counts from lines, the row-error English, and the inc3
 * migration file (UTF-8, LF, its generated DDL exactly what `prisma migrate diff` makes from the Inc 2
 * schema, no new enum value used as a literal, the pre-check naming its fix and migration).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as prismaEnums from '@prisma/client';
import * as types from '@smartfleet/shared-types';
import {
  appDayClosePlace,
  appSaysWhere,
  cleanDaySheetReason,
  deriveDayCloseDiff,
  deriveDayCloseFix,
  deriveRefillStage,
  isDaySheetReasonEnough,
  parseDaySheetPlace,
  parseDaySheetState,
  refillLineCounts,
  renderMessage,
  type DayCloseCompareInput,
} from '@smartfleet/shared-utils';
import {
  adminDayEndListQuerySchema,
  createFillingOrderSchema,
  dayEndApproveSchema,
  dayEndReopenSchema,
  dayEndSendBackSchema,
  dayEndSubmitSchema,
  parseRequest,
  pilotSetupFileSchema,
  refillAdvanceSchema,
  refillScanSchema,
  REFILL_IDEMPOTENCY_FIELDS,
} from '@smartfleet/shared-validation';
import { AppError } from '../../../src/common/errors/app-error';
import { AuditLogService } from '../../../src/modules/audit-log/audit-log.service';
import { isEditableOverApi, isShipped, RELEASE_INCREMENT, SETTINGS } from '../../../src/modules/settings/registry';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { APP_SEEN_MIGRATION, FLAT_COST_MIGRATION, INC2_SCHEMA, INC3_MIGRATION, INC3_SCHEMA, MIGRATIONS_DIR } from '../../helpers/migrations';

const API_DIR = path.resolve(__dirname, '..', '..', '..');

const valuesOf = (source: unknown) =>
  Object.values(source as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string')
    .sort();

describe('inc3 enum mirrors (shared-types = schema.prisma)', () => {
  it.each(['FillingOrderCylinderStatus', 'DayCloseStatus', 'DayClosePlace', 'DayCloseDiff', 'CylinderEventSource', 'CylinderEventType', 'AlertType'])(
    '%s holds the schema.prisma values',
    (name) => {
      const fromPrisma = (prismaEnums as unknown as Record<string, unknown>)[name];
      const fromShared = (types as unknown as Record<string, unknown>)[name];
      expect(fromPrisma).toBeDefined();
      expect(fromShared).toBeDefined();
      expect(valuesOf(fromShared)).toEqual(valuesOf(fromPrisma));
    },
  );

  it('the changed enums carry their inc3 values, and the open refill line statuses are the two before RETURNED', () => {
    expect(valuesOf(types.CylinderEventType)).toEqual(expect.arrayContaining(['FILLED', 'ADJUSTED']));
    expect(valuesOf(types.CylinderEventSource)).toContain('DAY_END_FIX');
    expect(valuesOf(types.AlertType)).toContain('DAY_END_SUBMITTED');
    expect(valuesOf(types.FillingOrderCylinderStatus)).toEqual(['FILLED', 'PICKED_UP', 'RETURNED']);
    expect(types.OPEN_REFILL_LINE_STATUSES).toEqual(['PICKED_UP', 'FILLED']);
    expect(types.REFILL_SCAN_PHASES).toEqual(['PICKUP', 'FILL']);
    expect(types.REFILL_ADVANCE_TARGETS).toEqual(['EMPTIES_PICKED', 'FILLED']);
    // The fix of settled point G09-03 is not a column: it follows from the line (deriveDayCloseFix).
    expect(types.DAY_CLOSE_FIXES).toEqual(['MOVE_TO_STORE', 'SET_STATE', 'MARK_LOST', 'REGISTER', 'NOTE_ONLY']);
    expect(Object.keys((prismaEnums as unknown as Record<string, unknown>)).filter((key) => /Decision|DayCloseFix/.test(key))).toEqual([]);
  });

  it('the scan actions name the two refill scans, and the audit catalogue has the Inc 3 actions', () => {
    expect(types.SCAN_ACTIONS).toEqual(expect.arrayContaining(['REFILL_PICKUP', 'REFILL_FILL']));
    expect(types.AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(['day.submit', 'day.approve', 'day.send_back', 'day.reopen', 'pilot.setup', 'pilot.reset', 'refill.complete']),
    );
    expect(types.AUDIT_ACTIONS_NEEDING_REASON).toEqual(expect.arrayContaining(['day.send_back', 'day.reopen', 'refill.cancel']));
  });
});

describe('Inc 3 settings (API_CONTRACT §6, §10)', () => {
  const INC3_KEYS = types.SETTING_KEYS.filter((key) => SETTINGS[key].inc === 3);

  it('this build ships Increment 3: dayEnd.enabled is live, editable, public, and on by default', () => {
    expect(RELEASE_INCREMENT).toBe(3);
    expect(INC3_KEYS).toEqual(['dayEnd.enabled']);
    expect(isShipped('dayEnd.enabled')).toBe(true);
    expect(isEditableOverApi('dayEnd.enabled')).toBe(true);
    expect(SETTINGS['dayEnd.enabled']).toMatchObject({ default: true, public: true, editable: true, inc: 3, type: 'boolean' });
    // Every earlier key stays shipped; the reserved and not-built ones stay closed.
    for (const key of types.SETTING_KEYS) expect({ key, shipped: isShipped(key) }).toEqual({ key, shipped: true });
    for (const key of ['refill.deliveryCost', 'topup.secondApproval', 'walkIn.counterSwap.enabled', 'custody.forgottenInPolicy', 'auth.otpLogin.enabled'] as const) {
      expect({ key, editable: isEditableOverApi(key) }).toEqual({ key, editable: false });
    }
    expect(SETTINGS['refill.maxCylinders']).toMatchObject({ default: 30, min: 1, max: 30 });
    expect(SETTINGS['refill.deliveryCost'].default).toEqual({ enabled: false, basePaisa: 0, perCylinderPaisa: 0 });
  });

  function serviceWith(initial: Array<{ key: string; value: unknown }>) {
    const rows = initial.map((row) => ({ ...row }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      appSetting: {
        findMany: jest.fn(async () =>
          rows.map((row) => ({ ...row, scope: 'global', updatedAt: new Date(), createdAt: new Date(), updatedByUserId: null })),
        ),
        upsert: jest.fn(async (args: { create: { key: string; value: unknown }; update: { value: unknown } }) => {
          const existing = rows.find((row) => row.key === args.create.key);
          if (existing) existing.value = args.update.value;
          else rows.push({ key: args.create.key, value: args.create.value });
        }),
      },
      user: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => undefined) },
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db)),
    };
    const config = new ConfigService({ app: { environment: 'test', updateUrl: null } });
    return { db, service: new SettingsService(db as never, new AuditLogService(db as never), config) };
  }

  it('GET /app/config reports day-end on by default and follows the stored switch; scans and typed numbers stay on', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const defaults = await serviceWith([]).service.publicConfig();
    expect(defaults.features).toMatchObject({ refills: true, scanFlow: true, confirmations: false, typedCylinderNumber: true, dayEnd: true });
    const off = await serviceWith([{ key: 'dayEnd.enabled', value: false }]).service.publicConfig();
    expect(off.features.dayEnd).toBe(false);
    expect(off.refill).toEqual({ maxCylinders: 30 });
  });

  it('PATCH /settings/dayEnd.enabled switches it, audited; a non-boolean is refused', async () => {
    const office = { kind: 'USER' as const, userId: 'u-office', role: 'SUPER_ADMIN' as never };
    const { db, service } = serviceWith([]);
    await expect(service.update('dayEnd.enabled', false, office, 'Not yet for the pilot')).resolves.toMatchObject({ value: false, default: true, editable: true });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'setting.update',
      reason: 'Not yet for the pilot',
      diff: { key: 'dayEnd.enabled', from: true, to: false },
    });
    const code = async (value: unknown) => {
      try {
        await service.update('dayEnd.enabled', value, office, 'A reason here');
      } catch (error) {
        return (error as AppError).code;
      }
      return 'OK';
    };
    expect(await code('yes')).toBe('SETTING_INVALID_VALUE');
    expect(await code(true)).toBe('OK');
  });
});

describe('Inc 3 request schemas (shared-validation)', () => {
  const fields = (result: ReturnType<typeof parseRequest>) => (result.success ? [] : result.fields.map((f) => `${f.path}:${f.code}`));
  const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

  it('a refill scan is PICKUP or FILL, never names where the cylinder goes, and drops other fields', () => {
    const scan = { scanId: uuid(1), phase: 'PICKUP', code: 'AG-C0001', entryMethod: 'QR' };
    expect(parseRequest(refillScanSchema, { ...scan, stopId: uuid(2) })).toEqual({ success: true, data: scan });
    expect(fields(parseRequest(refillScanSchema, { ...scan, toCustodyType: 'STORE' }))).toEqual(['toCustodyType:NOT_ALLOWED']);
    expect(fields(parseRequest(refillScanSchema, { ...scan, toCustodyId: uuid(3) }))).toEqual(['toCustodyId:NOT_ALLOWED']);
    expect(fields(parseRequest(refillScanSchema, { ...scan, phase: 'RETURN' }))).toEqual(['phase:INVALID_CHOICE']);
    expect(fields(parseRequest(refillScanSchema, { ...scan, lat: 31.5 }))).toEqual(['lng:INVALID_LOCATION']);
    expect(parseRequest(refillScanSchema, { ...scan, phase: 'FILL', entryMethod: 'TYPED', code: '42', lat: 31.5, lng: 74.3 }).success).toBe(true);
  });

  it('"Leave store" and "Leave station" are the only advance targets', () => {
    expect(parseRequest(refillAdvanceSchema, { to: 'EMPTIES_PICKED' })).toEqual({ success: true, data: { to: 'EMPTIES_PICKED' } });
    expect(parseRequest(refillAdvanceSchema, { to: 'FILLED' }).success).toBe(true);
    for (const to of ['AT_STATION', 'COMPLETED', 'RETURNED', undefined]) {
      expect(fields(parseRequest(refillAdvanceSchema, { to }))).toEqual([to === undefined ? 'to:REQUIRED' : 'to:INVALID_CHOICE']);
    }
  });

  it('a refill create keeps its Inc 1 rules, and its Idempotency-Key compares the station, the size and the count', () => {
    const body = { fillingStationId: uuid(4), cylinderTypeId: uuid(5), requestedCount: 2 };
    expect(parseRequest(createFillingOrderSchema, body).success).toBe(true);
    const zero = parseRequest(createFillingOrderSchema, { ...body, requestedCount: 0 });
    expect(zero.success ? 'ok' : zero.errorCode).toBe('REFILL_INVALID_COUNT');
    expect(REFILL_IDEMPOTENCY_FIELDS).toEqual(['fillingStationId', 'cylinderTypeId', 'requestedCount']);
  });

  it('day-end bodies: a version of at least 1, a submit note of at most 300, a send-back or reopen reason of 5–300', () => {
    expect(parseRequest(dayEndSubmitSchema, { version: 2, note: ' Checked at 9 pm ' })).toEqual({ success: true, data: { version: 2, note: 'Checked at 9 pm' } });
    expect(parseRequest(dayEndSubmitSchema, { version: 1, note: '  ' })).toEqual({ success: true, data: { version: 1 } });
    expect(fields(parseRequest(dayEndSubmitSchema, { version: 0 }))).toEqual(['version:TOO_SMALL']);
    expect(fields(parseRequest(dayEndSubmitSchema, { version: '2' }))).toEqual(['version:INVALID_TYPE']);
    expect(fields(parseRequest(dayEndSubmitSchema, { version: 1, note: 'x'.repeat(301) }))).toEqual(['note:TOO_LONG']);
    expect(fields(parseRequest(dayEndApproveSchema, {}))).toEqual(['version:REQUIRED']);
    expect(parseRequest(dayEndApproveSchema, { version: 3 }).success).toBe(true);
    for (const schema of [dayEndSendBackSchema, dayEndReopenSchema]) {
      expect(fields(parseRequest(schema, {}))).toEqual(['reason:REQUIRED']);
      expect(fields(parseRequest(schema, { reason: 'Late' }))).toEqual(['reason:TOO_SHORT']);
      expect(parseRequest(schema, { reason: 'AG-C0012 is in the store, please check again' }).success).toBe(true);
    }
    expect(parseRequest(adminDayEndListQuerySchema, { status: 'SUBMITTED' })).toMatchObject({ success: true, data: { status: 'SUBMITTED', limit: 30 } });
    expect(fields(parseRequest(adminDayEndListQuerySchema, { status: 'LOCKED' }))).toEqual(['status:INVALID_CHOICE']);
  });

  /** The standard test data as a pilot setup file (TEST_CASES.md "Standard test data"). */
  const square = (x: number) => ({
    type: 'MultiPolygon',
    coordinates: [[[[x, 31.5], [x + 0.05, 31.5], [x + 0.05, 31.55], [x, 31.55], [x, 31.5]]]],
  });
  const standardFile = () => ({
    city: { name: 'Lahore' },
    zones: [
      { name: 'North', shape: square(74.2) },
      { name: 'South', shape: square(74.25) },
      { name: 'East', shape: { type: 'Polygon', coordinates: square(74.3).coordinates[0] } },
    ],
    officeUsers: [
      { name: 'Owner', phone: '0333 1000001' },
      { name: 'Ops', phone: '0333 1000002' },
    ],
    distributors: [
      { code: 'AG', businessName: 'Ahmed Gas', phone: '0321 1234567', store: { name: 'Ahmed Gas Store', address: 'Mall Road', lat: 31.52, lng: 74.22 } },
      { code: 'BG', businessName: 'Bilal Gas', phone: '0322 7654321', store: { name: "Bilal Gas's store", address: 'Ferozepur Rd', lat: 31.52, lng: 74.28 } },
    ],
    cylinderTypes: [
      { code: 'STD_6KG', name: '6 kg', weightKg: 6 },
      { code: 'STD_11_8KG', name: '11.8 kg', weightKg: 11.8 },
      { code: 'STD_15KG', name: '15 kg', weightKg: 15 },
      { code: 'STD_45_4KG', name: '45.4 kg', weightKg: 45.4 },
    ],
    // One delivery cost per order (ADR-08): North Rs 250, South Rs 400; Bilal Gas South Rs 300.
    prices: [
      { distributor: 'AG', zone: 'North', basePaisa: 25000 },
      { distributor: 'AG', zone: 'South', basePaisa: '40000' },
      { distributor: 'BG', zone: 'South', basePaisa: 30000 },
    ],
    drivers: [
      { name: 'Kashif', phone: '0345 1000001', licenceNo: 'DL-1001', van: { plateNo: 'lea-101', capacityUnits: 40, homeZone: 'North' } },
      { name: 'Imran', phone: '0345 1000002', licenceNo: 'DL-1002', van: { plateNo: 'LEB-202', capacityUnits: 40, homeZone: 'South' } },
    ],
    stations: [{ name: 'Lahore Filling Station', address: 'Ring Road', lat: 31.54, lng: 74.24 }],
    settings: { 'topup.account': { accountTitle: 'Smart Fleet (Pvt) Ltd', bankName: 'Test Bank', iban: 'PK00TEST0000000000000000', accountNumber: '0000000000' } },
    stock: [
      { distributor: 'AG', cylinderType: 'STD_11_8KG', count: 20 },
      { distributor: 'AG', cylinderType: 'STD_15KG', count: 10 },
      { distributor: 'AG', cylinderType: 'STD_45_4KG', count: 5 },
    ],
    customers: [
      { distributor: 'AG', name: 'Sana', phone: '0300 1234567', address: { label: "Sana's house", lat: 31.53, lng: 74.23 } },
      { distributor: 'AG', name: 'Usman', phone: '0321 7654321', address: { label: "Usman's house", lat: 31.53, lng: 74.27 } },
      { distributor: 'BG', name: 'Hina', phone: '0300 9876543', address: { label: "Hina's house", lat: 31.51, lng: 74.28 } },
    ],
    openingBalances: [{ distributor: 'AG', amountPaisa: 500000, note: 'Opening balance for the test day' }],
  });

  it('the pilot setup file takes the standard data, reads a Polygon as a MultiPolygon and fills in the defaults', () => {
    const parsed = parseRequest(pilotSetupFileSchema, standardFile());
    if (!parsed.success) throw new Error(JSON.stringify(parsed.fields));
    const file = parsed.data;
    expect(file.city).toEqual({ name: 'Lahore', countryCode: 'PK' });
    expect(file.zones.map((zone) => [zone.name, zone.shape.type, zone.active])).toEqual([
      ['North', 'MultiPolygon', true],
      ['South', 'MultiPolygon', true],
      ['East', 'MultiPolygon', true],
    ]);
    expect(file.zones[2].shape.coordinates).toEqual(square(74.3).coordinates);
    expect(file.prices.map((price) => price.basePaisa)).toEqual(['25000', '40000', '30000']);
    expect(file.prices.map((price) => price.sizes)).toEqual([undefined, undefined, undefined]);
    // A file written before 2026-10-26 may still list per-size amounts: they parse, and setup ignores them with a note.
    const older = standardFile();
    (older.prices[0] as Record<string, unknown>).sizes = [{ cylinderType: 'STD_11_8KG', perCylinderPaisa: 4000 }];
    const olderParsed = parseRequest(pilotSetupFileSchema, older);
    expect(olderParsed).toMatchObject({ success: true });
    expect(file.drivers[0].van?.plateNo).toBe('LEA-101');
    expect(file.stock.map((stock) => stock.state)).toEqual(['FULL', 'FULL', 'FULL']);
    expect(file.cylinderTypes[0].capacityUnits).toBe(1);
    expect(file.openingBalances).toEqual([{ distributor: 'AG', amountPaisa: '500000', note: 'Opening balance for the test day' }]);
    expect(parseRequest(pilotSetupFileSchema, { ...standardFile(), customers: undefined, openingBalances: undefined, settings: undefined })).toMatchObject({
      success: true,
      data: { customers: [], openingBalances: [], settings: {} },
    });
  });

  it('the pilot setup file names its first bad entry: duplicates, unknown references, bad amounts and codes, unknown keys', () => {
    const bad = standardFile();
    bad.zones.push({ name: 'north', shape: square(75) });
    bad.prices.push({ distributor: 'AG', zone: 'West', basePaisa: 1000 });
    bad.prices[0].basePaisa = 25050;
    bad.distributors[1].code = 'bg';
    bad.stock.push({ distributor: 'AG', cylinderType: 'STD_9KG', count: 1 });
    bad.drivers[1].van.plateNo = 'LEA-101';
    (bad.customers[0] as Record<string, unknown>).nickname = 'S';
    expect(fields(parseRequest(pilotSetupFileSchema, bad)).sort()).toEqual(
      [
        'customers.0:NOT_ALLOWED',
        'distributors.1.code:DISTRIBUTOR_CODE_INVALID',
        'prices.0.basePaisa:PRICE_INVALID',
        // The duplicate and reference checks run beside the shape checks, so one run names them all.
        'drivers.1.van.plateNo:DUPLICATE_ITEM',
        'prices.3.zone:INVALID_CHOICE',
        'stock.3.cylinderType:INVALID_CHOICE',
        'zones.3.name:DUPLICATE_ITEM',
      ].sort(),
    );
    const refs = standardFile();
    refs.zones.push({ name: 'north', shape: square(75) });
    refs.prices.push({ distributor: 'AG', zone: 'West', basePaisa: 1000 });
    refs.prices.push({ distributor: 'CG', zone: 'North', basePaisa: 1000 });
    refs.stock.push({ distributor: 'AG', cylinderType: 'STD_9KG', count: 1 });
    refs.drivers[1].van.plateNo = 'LEA-101';
    refs.drivers[1].phone = '0345 1000001';
    expect(fields(parseRequest(pilotSetupFileSchema, refs)).sort()).toEqual(
      [
        'zones.3.name:DUPLICATE_ITEM',
        'drivers.1.phone:DUPLICATE_ITEM',
        'drivers.1.van.plateNo:DUPLICATE_ITEM',
        'prices.3.zone:INVALID_CHOICE',
        'prices.4.distributor:INVALID_CHOICE',
        'stock.3.cylinderType:INVALID_CHOICE',
      ].sort(),
    );
    expect(fields(parseRequest(pilotSetupFileSchema, { ...standardFile(), extra: true }))).toEqual([':NOT_ALLOWED']);
    expect(fields(parseRequest(pilotSetupFileSchema, { ...standardFile(), openingBalances: [{ distributor: 'AG', amountPaisa: 500050, note: 'Opening balance' }] }))).toEqual([
      'openingBalances.0.amountPaisa:AMOUNT_NOT_WHOLE_RUPEES',
    ]);
    // The first issue is the one the CLI names: the shape before the references it breaks.
    expect(fields(parseRequest(pilotSetupFileSchema, { ...standardFile(), zones: [] }))[0]).toBe('zones:TOO_FEW_ITEMS');
  });
});

describe('the day-end sheet rules (shared-utils, API_CONTRACT §10.2)', () => {
  it('reads the "Your count" words case-insensitively after trimming, with ’ as \' and the Part-filled hyphen optional', () => {
    expect(parseDaySheetPlace('  in MY store ')).toEqual({ kind: 'WORD', value: 'STORE' });
    expect(parseDaySheetPlace('On driver’s van')).toEqual({ kind: 'WORD', value: 'VAN' });
    expect(parseDaySheetPlace('with customer')).toEqual({ kind: 'WORD', value: 'CUSTOMER' });
    expect(parseDaySheetPlace('MISSING')).toEqual({ kind: 'WORD', value: 'NOT_FOUND' });
    expect(parseDaySheetPlace('')).toEqual({ kind: 'BLANK' });
    expect(parseDaySheetPlace(null)).toEqual({ kind: 'BLANK' });
    expect(parseDaySheetPlace('Shop')).toEqual({ kind: 'UNKNOWN', text: 'Shop' });
    expect(parseDaySheetState('Part filled')).toEqual({ kind: 'WORD', value: 'PART_FILLED' });
    expect(parseDaySheetState('part-FILLED')).toEqual({ kind: 'WORD', value: 'PART_FILLED' });
    expect(parseDaySheetState('Partfilled')).toEqual({ kind: 'WORD', value: 'PART_FILLED' });
    expect(parseDaySheetState('Damaged')).toEqual({ kind: 'WORD', value: 'FAULTY' });
    expect(parseDaySheetState(' full ')).toEqual({ kind: 'WORD', value: 'FULL' });
    expect(parseDaySheetState('Half')).toEqual({ kind: 'UNKNOWN', text: 'Half' });
    expect(parseDaySheetState('Lost')).toEqual({ kind: 'UNKNOWN', text: 'Lost' });
    expect(parseDaySheetState(undefined)).toEqual({ kind: 'BLANK' });
  });

  it('cleans "Why different": line breaks and tabs become spaces, control characters go, spaces collapse, cut to 200; at least 3', () => {
    expect(cleanDaySheetReason('  Valve\r\nleaking\t badly\u0007  ')).toBe('Valve leaking badly');
    expect(cleanDaySheetReason('\u0000\u001f')).toBeNull();
    expect(cleanDaySheetReason(42)).toBe('42');
    expect(Array.from(cleanDaySheetReason('😀'.repeat(250)) ?? '')).toHaveLength(200);
    expect(isDaySheetReasonEnough(cleanDaySheetReason(' ok '))).toBe(false);
    expect(isDaySheetReasonEnough(cleanDaySheetReason('Used'))).toBe(true);
    expect(isDaySheetReasonEnough(null)).toBe(false);
  });

  it('writes the app\'s words: a van and a customer by name, Missing for LOST, whatever the holder', () => {
    expect(appSaysWhere({ place: 'VAN', plateNo: 'LEA-101' })).toBe("On driver's van · LEA-101");
    expect(appSaysWhere({ place: 'CUSTOMER', customerName: 'Sana' })).toBe('With customer · Sana');
    expect(appSaysWhere({ place: 'STORE' })).toBe('In my store');
    expect(appSaysWhere({ place: 'NOT_FOUND' })).toBe('Missing');
    expect(appDayClosePlace({ custodyType: 'STORE', state: 'LOST' })).toBe('NOT_FOUND');
    expect(appDayClosePlace({ custodyType: 'VEHICLE', state: 'FULL' })).toBe('VAN');
    expect(appDayClosePlace({ custodyType: 'CLIENT', state: 'EMPTY' })).toBe('CUSTOMER');
    expect(appDayClosePlace({ custodyType: 'STORE', state: 'FAULTY' })).toBe('STORE');
    expect(types.DAY_SHEET_PLACE_WORDS).toEqual({ STORE: 'In my store', VAN: "On driver's van", CUSTOMER: 'With customer', NOT_FOUND: 'Missing' });
    expect(types.DAY_SHEET_STATE_WORDS).toEqual({ FULL: 'Full', EMPTY: 'Empty', PART_FILLED: 'Part-filled', FAULTY: 'Damaged' });
  });

  const line = (app: DayCloseCompareInput['app'], place: DayCloseCompareInput['sheet']['place'], state: DayCloseCompareInput['sheet']['state']) => ({
    app,
    sheet: { place, state },
  });
  const plan = (input: DayCloseCompareInput) => ({ diff: deriveDayCloseDiff(input), fix: deriveDayCloseFix(input) });

  it('the four differences of case DAY-002: each diff and fix follows from the stored values', () => {
    // AG-C0005 In my store / Damaged; AG-C0010 (on LEA-101) In my store / Full; AG-C0012 In my store / Empty;
    // AG-C0015 On driver's van / Empty.
    expect(plan(line({ place: 'STORE', state: 'FULL' }, 'STORE', 'FAULTY'))).toEqual({
      diff: 'STATE_DIFFERS',
      fix: { fix: 'SET_STATE', toPlace: null, toState: 'FAULTY' },
    });
    expect(plan(line({ place: 'VAN', state: 'FULL' }, 'STORE', 'FULL'))).toEqual({
      diff: 'PLACE_DIFFERS',
      fix: { fix: 'MOVE_TO_STORE', toPlace: 'STORE', toState: null },
    });
    expect(plan(line({ place: 'STORE', state: 'FULL' }, 'STORE', 'EMPTY'))).toEqual({
      diff: 'STATE_DIFFERS',
      fix: { fix: 'SET_STATE', toPlace: null, toState: 'EMPTY' },
    });
    expect(plan(line({ place: 'STORE', state: 'FULL' }, 'VAN', 'EMPTY'))).toEqual({
      diff: 'PLACE_AND_STATE_DIFFER',
      fix: { fix: 'NOTE_ONLY', toPlace: null, toState: null },
    });
  });

  it('the fixes of case DAY-009, Missing, a found LOST cylinder, blanks and the extra numbers', () => {
    // AG-C0013 in the store in the app, "On driver's van" on the sheet: nothing changes.
    expect(plan(line({ place: 'STORE', state: 'FULL' }, 'VAN', null)).fix).toEqual({ fix: 'NOTE_ONLY', toPlace: null, toState: null });
    // AG-C0016 Missing: LOST, holder unchanged.
    expect(plan(line({ place: 'STORE', state: 'FULL' }, 'NOT_FOUND', null))).toEqual({
      diff: 'PLACE_AND_STATE_DIFFER',
      fix: { fix: 'MARK_LOST', toPlace: null, toState: 'LOST' },
    });
    // A LOST cylinder still missing matches, whatever state is written beside "Missing".
    expect(plan(line({ place: 'NOT_FOUND', state: 'LOST' }, 'NOT_FOUND', 'FULL'))).toEqual({ diff: 'MATCH', fix: null });
    // A LOST cylinder found in the store (the row rules require a state): moved in with that state.
    expect(plan(line({ place: 'NOT_FOUND', state: 'LOST' }, 'STORE', 'EMPTY'))).toEqual({
      diff: 'PLACE_AND_STATE_DIFFER',
      fix: { fix: 'MOVE_TO_STORE', toPlace: 'STORE', toState: 'EMPTY' },
    });
    // With a customer in the app, in my store on the sheet with another state.
    expect(plan(line({ place: 'CUSTOMER', state: 'FULL' }, 'STORE', 'EMPTY')).fix).toEqual({ fix: 'MOVE_TO_STORE', toPlace: 'STORE', toState: 'EMPTY' });
    // Blank cells mean the same as the app; a blank state keeps the app's.
    expect(plan(line({ place: 'VAN', state: 'FULL' }, null, null))).toEqual({ diff: 'MATCH', fix: null });
    expect(plan(line({ place: 'STORE', state: 'EMPTY' }, null, 'PART_FILLED')).fix).toEqual({ fix: 'SET_STATE', toPlace: null, toState: 'PART_FILLED' });
    expect(plan(line({ place: 'STORE', state: 'FAULTY' }, 'STORE', 'FAULTY'))).toEqual({ diff: 'MATCH', fix: null });
    // DAY-007: an extra number becomes a new cylinder in the home store, with the row's state.
    expect(plan(line(null, null, 'EMPTY'))).toEqual({ diff: 'UNKNOWN_CYLINDER', fix: { fix: 'REGISTER', toPlace: 'STORE', toState: 'EMPTY' } });
  });

  it('the sheet layout is one contract: the names, the headers in DAY-001 order, the About keys and the limits', () => {
    expect(types.DAY_SHEET_NAMES).toEqual({ CYLINDERS: 'Cylinders', EXTRA: 'Extra cylinders', ABOUT: 'About' });
    expect(types.DAY_SHEET_CYLINDER_HEADERS).toEqual([
      'Cylinder number',
      'Size',
      'App says: where',
      'App says: state',
      'Your count: where',
      'Your count: state',
      'Why different',
    ]);
    expect(types.DAY_SHEET_EXTRA_HEADERS).toEqual(['Cylinder number', 'Size', 'State']);
    expect(types.DAY_SHEET_ABOUT_KEYS).toEqual(['format', 'distributorId', 'distributorCode', 'businessDate', 'sheetFileId']);
    expect(types.DAY_SHEET_FORMAT).toBe('smart-fleet-day-end/1');
    expect(types.DAY_SHEET_LIMITS).toMatchObject({ maxBytes: 2_097_152, maxMb: 2, maxRowsPerSheet: 20_000, maxListedRowErrors: 100, reasonMin: 3, reasonMax: 200 });
  });

  it('the row errors have the shorter English (final.json DAY-006, DAY-007), one per code', () => {
    expect(types.DAY_END_ROW_ERROR_EN).toEqual({
      PLACE_UNKNOWN: "Where: use In my store, On driver's van, With customer or Missing.",
      STATE_UNKNOWN: 'State: use Full, Empty, Part-filled or Damaged.',
      REASON_REQUIRED: 'Write why this row is different.',
      NOT_ON_LIST: 'Not your cylinder. Put new numbers on Extra cylinders.',
      DUPLICATE_NUMBER: 'This number is on the sheet twice.',
      NUMBER_INVALID: "This isn't a cylinder number.",
      OTHER_SHOP_NUMBER: "Another shop's label. Call the office.",
      ON_LIST: 'Already on the Cylinders sheet. Fill in its row there.',
      SIZE_UNKNOWN: 'Pick a size from the list, like 11.8 kg.',
    });
    expect(Object.keys(types.DAY_END_ROW_ERROR_EN)).toEqual([...types.DAY_END_ROW_ERROR_CODES]);
    for (const text of Object.values(types.DAY_END_ROW_ERROR_EN)) expect(text.split(/\s+/).length).toBeLessThanOrEqual(12);
  });
});

describe('refill counts and stage from the lines (Inc 3)', () => {
  it('counts every line as picked, a fill as filled (kept once returned) and a receive as received', () => {
    const lines = [
      { status: 'RETURNED' as const, filledAt: '2026-10-21T10:00:00Z' },
      { status: 'RETURNED' as const, filledAt: null },
      { status: 'FILLED' as const, filledAt: new Date() },
      { status: 'PICKED_UP' as const },
    ];
    expect(refillLineCounts({ requestedCount: 5, lines })).toEqual({ requested: 5, picked: 4, filled: 2, received: 2 });
    expect(refillLineCounts({ requestedCount: 2, lines: [] })).toEqual({ requested: 2, picked: 0, filled: 0, received: 0 });
  });

  it('reads BACK_AT_STORE from one received cylinder in Inc 3, whatever the step, and DONE once completed', () => {
    const counts = { requested: 2, picked: 2, filled: 1, received: 1 };
    for (const status of ['EMPTIES_PICKED', 'AT_STATION', 'FILLED'] as const) {
      expect(deriveRefillStage({ status, counts, increment: 3 })).toBe('BACK_AT_STORE');
    }
    expect(deriveRefillStage({ status: 'COMPLETED', counts, increment: 3 })).toBe('DONE');
    expect(deriveRefillStage({ status: 'ASSIGNED', counts: { picked: 1 }, increment: 3 })).toBe('PICKING_UP');
    expect(deriveRefillStage({ status: 'FILLED', counts: { picked: 2 }, increment: 3 })).toBe('COMING_BACK');
  });

  it('refill refusals render their documented text', () => {
    expect(renderMessage(types.ERROR_MESSAGE_EN.REFILL_COUNT_REACHED, { requested: 2 })).toBe('All picked up: 2 of 2.');
    expect(types.ERROR_DETAIL_KEYS.REFILL_COUNT_REACHED).toEqual(['requested', 'progress']);
  });
});

describe('the inc3 migration file', () => {
  const file = path.join(MIGRATIONS_DIR, INC3_MIGRATION, 'migration.sql');
  const sql = () => fs.readFileSync(file, 'utf8');
  const section = (text: string, from: string, to: string) => text.slice(text.indexOf(from) + from.length, text.indexOf(to)).trim();
  const diff = (from: string, to: string): string => {
    const run = spawnSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datamodel', from, '--to-schema-datamodel', to, '--script'],
      { cwd: API_DIR, encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.status !== 0) throw new Error(`prisma migrate diff failed: ${run.stderr}`);
    return run.stdout.replace(/\r\n/g, '\n').trim();
  };

  it('is the last migration of the Increment 3 release (users_app_seen and flat_delivery_cost come next), UTF-8 without a BOM, with LF line endings', () => {
    const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_/.test(name)).sort();
    expect(names.slice(names.indexOf(INC3_MIGRATION))).toEqual([INC3_MIGRATION, APP_SEEN_MIGRATION, FLAT_COST_MIGRATION]);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(false);
    expect(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)).toBe(true);
  });

  it('keeps the generated DDL unchanged (the diff from the Inc 2 schema to the Inc 3 schema)', () => {
    expect(section(sql(), '-- (2) GENERATED DDL (unchanged)', '-- (3) BACKFILLS')).toBe(diff(INC2_SCHEMA, INC3_SCHEMA));
  }, 120_000);

  it('uses no value it adds to an existing enum as a literal (55P04)', () => {
    const text = sql();
    const added = [...text.matchAll(/ALTER TYPE "\w+" ADD VALUE '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(['ADJUSTED', 'DAY_END_FIX', 'DAY_END_SUBMITTED', 'FILLED']);
    // foc_steps_chk's 'FILLED' is FillingOrderCylinderStatus.FILLED, of an enum CREATED in this file (allowed),
    // not the CylinderEventType.FILLED value added to an existing enum.
    const focSteps = /ALTER TABLE filling_order_cylinders ADD CONSTRAINT foc_steps_chk CHECK \([\s\S]*?\);/.exec(text)?.[0] ?? '';
    expect(focSteps).toContain("status = 'FILLED'");
    const handEdits = text.slice(text.indexOf('-- (3) BACKFILLS')).replace(focSteps, '');
    for (const value of added) {
      expect({ value, literalUses: [...handEdits.matchAll(new RegExp(`'${value}'`, 'g'))].length }).toEqual({ value, literalUses: 0 });
    }
  });

  it('raises MIGRATION_BLOCKED inc3 with its fix and the resolve command, from one pre-check', () => {
    const raises = [...sql().matchAll(/RAISE EXCEPTION 'MIGRATION_BLOCKED ([a-z0-9]+): ([^']|'')+'/g)].map((m) => m[0]);
    expect(raises).toHaveLength(1);
    expect(raises[0]).toContain('MIGRATION_BLOCKED inc3: refills in progress (%).');
    expect(raises[0]).toContain(`run "prisma migrate resolve --rolled-back ${INC3_MIGRATION}", then deploy again.`);
  });

  it('adds the DATA_MODEL §5.4 checks, NOT VALID only on the old refill table', () => {
    const checks = [...sql().matchAll(/ADD CONSTRAINT (\w+) CHECK [\s\S]*?;/g)].map((m) => ({ name: m[1], notValid: /NOT VALID;$/.test(m[0]) }));
    expect(checks).toEqual([
      { name: 'filling_orders_count_chk', notValid: true },
      { name: 'foc_pickup_state_chk', notValid: false },
      { name: 'foc_steps_chk', notValid: false },
      { name: 'day_closes_locked_chk', notValid: false },
      { name: 'dcl_unknown_chk', notValid: false },
    ]);
  });
});
