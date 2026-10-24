/**
 * The Increment 3 test helpers (test/helpers/refills.ts, day-end.ts, inc3-calls.ts) write rows exactly as
 * DATA_MODEL §5 and API_CONTRACT §10 describe them, pass every inc3 CHECK, never move money, and the API
 * reads what they write: every Inc 3 lane's tests build on them.
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState, DayCloseDiff, DayClosePlace, DayCloseStatus, FillingOrderStatus, StoredFilePurpose } from '@prisma/client';
import { DAY_SHEET_CYLINDER_HEADERS, DAY_SHEET_EXTRA_HEADERS, DAY_SHEET_FORMAT } from '@smartfleet/shared-types';
import { createTestApp } from '../../helpers/app';
import {
  addDayCloseLines,
  advanceRefill,
  buildDaySheet,
  cancelRefill,
  createDayClose,
  createRefill,
  createStandardData,
  createStation,
  createStoredFile,
  cylinderHolder,
  dayCloseLines,
  dayCloseOf,
  daySheetAbout,
  describeDb,
  fillDaySheet,
  fillForRefill,
  getTestPrisma,
  karachiTime,
  onOpenRefillLine,
  pickUpForRefill,
  readDaySheet,
  receiveForRefill,
  refillCalls,
  refillCountsOf,
  refillEvents,
  refillLines,
  registerCylinders,
  registerStandardCylinders,
  scanCalls,
  walletMismatches,
  type StandardData,
} from '../../helpers';
import { resetDb } from '../../helpers/db';

describeDb('Increment 3 test helpers', () => {
  const db = () => getTestPrisma();
  let std: StandardData;

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
  });

  it('createRefill numbers refills per distributor from next_refill_no, with no money and the home store as pickup', async () => {
    const station = await createStation();
    const a1 = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, station });
    const a2 = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg15, requestedCount: 1, station, assignTo: std.DR2, clientRequestId: '33000000-0000-4000-8000-000000000001' });
    const b1 = await createRefill({ distributor: std.DB, cylinderTypeId: std.sizes.kg11_8, requestedCount: 3, station });
    expect([a1.shortCode, a2.shortCode, b1.shortCode]).toEqual(['AG-R001', 'AG-R002', 'BG-R001']);
    const rows = await db().fillingOrder.findMany({ where: { id: { in: [a1.id, a2.id, b1.id] } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.refillNo, r.status, r.pricePerCylinderPaisa, r.totalCostPaisa, r.pickupStoreId])).toEqual([
      [1, 'PENDING', 0n, 0n, std.DA.homeStoreId],
      [2, 'ASSIGNED', 0n, 0n, std.DA.homeStoreId],
      [1, 'PENDING', 0n, 0n, std.DB.homeStoreId],
    ]);
    expect(rows[1]).toMatchObject({ assignedDriverId: std.DR2.id, assignedVehicleId: std.DR2.vehicleId, clientRequestId: '33000000-0000-4000-8000-000000000001' });
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextRefillNo).toBe(3);
    expect(await walletMismatches()).toEqual([]);
  });

  it('a refill run by fixtures: pickups onto the van, fills on the van, receives into the store that complete it; no money', async () => {
    const ledgerBefore = await db().ledgerEntry.count();
    const empties = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 3, state: CylinderState.EMPTY });
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 3, assignTo: std.DR2 });

    const pickups = await pickUpForRefill({ refill, driver: std.DR2, cylinders: empties.slice(0, 2) });
    expect(pickups).toHaveLength(2);
    for (const cylinder of empties.slice(0, 2)) {
      expect(await cylinderHolder(cylinder.id)).toMatchObject({ custodyType: CustodyType.VEHICLE, custodyId: std.DR2.vehicleId, state: CylinderState.EMPTY });
      expect(await onOpenRefillLine(cylinder.id)).toBe(true);
    }
    const pickupEvent = await db().cylinderEvent.findUniqueOrThrow({ where: { id: pickups[0] } });
    expect(pickupEvent).toMatchObject({ eventType: CylinderEventType.SCAN_OUT, fillingOrderId: refill.id, tripId: null, tripStopId: null, orderId: null, source: 'SCAN' });
    expect((await db().fillingOrder.findUniqueOrThrow({ where: { id: refill.id } })).pickedUpAt).not.toBeNull();
    expect(await refillCountsOf(refill.id)).toEqual({ status: 'ASSIGNED', requested: 3, picked: 2, filled: 0, received: 0 });

    await advanceRefill(refill, FillingOrderStatus.EMPTIES_PICKED);
    const fills = await fillForRefill({ refill, driver: std.DR2, cylinders: [empties[0]] });
    expect(await db().cylinderEvent.findUniqueOrThrow({ where: { id: fills[0] } })).toMatchObject({
      eventType: CylinderEventType.FILLED,
      fromCustodyType: CustodyType.VEHICLE,
      toCustodyType: CustodyType.VEHICLE,
      fromState: CylinderState.EMPTY,
      toState: CylinderState.EMPTY,
      fillingOrderId: refill.id,
    });
    expect(await refillCountsOf(refill.id)).toEqual({ status: 'AT_STATION', requested: 3, picked: 2, filled: 1, received: 0 });
    await advanceRefill(refill, FillingOrderStatus.FILLED);

    const first = await receiveForRefill({ refill, shop: std.DA, cylinders: [empties[0]] });
    expect(first.completed).toBe(false);
    expect(await cylinderHolder(empties[0].id)).toMatchObject({ custodyType: CustodyType.STORE, custodyId: std.DA.homeStoreId, state: CylinderState.FULL });
    expect(await onOpenRefillLine(empties[0].id)).toBe(false);
    // The unfilled one comes back as it went.
    const second = await receiveForRefill({ refill, shop: std.DA, cylinders: [empties[1]] });
    expect(second.completed).toBe(true);
    expect(await cylinderHolder(empties[1].id)).toMatchObject({ custodyType: CustodyType.STORE, state: CylinderState.EMPTY });
    expect(await refillCountsOf(refill.id)).toEqual({ status: 'COMPLETED', requested: 3, picked: 2, filled: 1, received: 2 });
    expect((await refillLines(refill.id)).map((line) => [line.status, line.filledAt !== null, line.returnedAt !== null])).toEqual([
      ['RETURNED', true, true],
      ['RETURNED', false, true],
    ]);
    expect((await refillEvents(refill.id)).map((event) => event.eventType)).toEqual(['SCAN_OUT', 'SCAN_OUT', 'FILLED', 'SCAN_IN', 'SCAN_IN']);
    // The third, never picked up, is still in the store.
    expect(await cylinderHolder(empties[2].id)).toMatchObject({ custodyType: CustodyType.STORE, state: CylinderState.EMPTY });
    expect(await db().ledgerEntry.count()).toBe(ledgerBefore);
    expect(await walletMismatches()).toEqual([]);
  });

  it('the API reads the fixtures: the refill, the store stock, and the refill pickup in the history', async () => {
    const empties = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 1, state: CylinderState.EMPTY });
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, assignTo: std.DR2 });
    await pickUpForRefill({ refill, driver: std.DR2, cylinders: empties });
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      const view = await refillCalls(app).get(std.DA, refill.id).expect(200);
      expect(view.body).toMatchObject({ id: refill.id, status: 'ASSIGNED', pricePerCylinderPaisa: '0', totalCostPaisa: '0' });
      const driverView = await refillCalls(app).get(std.DR2, refill.id).expect(200);
      expect(driverView.body.id).toBe(refill.id);
      await refillCalls(app).get(std.DB, refill.id).expect(404);
      const history = await scanCalls(app).cylinderHistory(std.DA, String(empties[0].shortNo)).expect(200);
      expect((history.body.events as Array<{ action: string }>).map((event) => event.action)).toEqual(['REGISTERED', 'SCAN_OUT']);
      expect(history.body.holder).toMatchObject({ type: 'VEHICLE', label: 'LEB-202' });
      const stock = await scanCalls(app).storeStock(std.DA).expect(200);
      expect(stock.body.total).toBe(0);
    } finally {
      await app?.close();
    }
  });

  it('cancelRefill cancels before pickup with who and when', async () => {
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 });
    await cancelRefill(refill, { by: { userId: std.DA.userId }, reason: 'Not needed' });
    expect(await db().fillingOrder.findUniqueOrThrow({ where: { id: refill.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelledByUserId: std.DA.userId,
      cancellationReason: 'Not needed',
    });
  });

  it('registerStandardCylinders makes AG-C0001…AG-C0035 and BG-C0001…BG-C0003 as the standard data lists them', async () => {
    const cyl = await registerStandardCylinders(std);
    expect(Object.keys(cyl.AG)).toHaveLength(35);
    expect(Object.keys(cyl.BG)).toEqual(['BG-C0001', 'BG-C0002', 'BG-C0003']);
    const sizeOf = (code: string) => cyl.AG[code].cylinderTypeId;
    expect([sizeOf('AG-C0001'), sizeOf('AG-C0020'), sizeOf('AG-C0021'), sizeOf('AG-C0030'), sizeOf('AG-C0031'), sizeOf('AG-C0035')]).toEqual([
      std.sizes.kg11_8,
      std.sizes.kg11_8,
      std.sizes.kg15,
      std.sizes.kg15,
      std.sizes.kg45_4,
      std.sizes.kg45_4,
    ]);
    const counters = await db().distributor.findMany({ where: { id: { in: [std.DA.id, std.DB.id] } }, select: { code: true, nextCylinderNo: true } });
    expect(Object.fromEntries(counters.map((c) => [c.code, c.nextCylinderNo]))).toEqual({ AG: 36, BG: 4 });
    const all = await db().cylinder.findMany({ where: { distributorId: std.DA.id }, include: { events: true } });
    for (const cylinder of all) {
      expect(cylinder).toMatchObject({ state: 'FULL', custodyType: 'STORE', custodyId: std.DA.homeStoreId });
      expect(cylinder.events.map((event) => event.eventType)).toEqual(['REGISTERED']);
    }
  });

  it('karachiTime gives the instant of a Karachi wall clock, and day rows and lines follow the inc3 CHECKs', async () => {
    expect(karachiTime('2026-10-22', '02:30').toISOString()).toBe('2026-10-21T21:30:00.000Z');
    expect(karachiTime('2026-10-21', '20:00').toISOString()).toBe('2026-10-21T15:00:00.000Z');
    const sheet = await createStoredFile({ purpose: StoredFilePurpose.DAY_END_SHEET, uploadedBy: { userId: std.DA.userId }, distributorId: std.DA.id });
    const open = await createDayClose({ distributor: std.DA, businessDate: '2026-10-21', sheetSnapshotAt: new Date(), sheetFileId: sheet.id });
    const approved = await createDayClose({ distributor: std.DA, businessDate: '2026-10-20', status: DayCloseStatus.APPROVED, uploadVersion: 2, approvedBy: { userId: std.SA1.id } });
    const read = await dayCloseOf(std.DA.id, '2026-10-21');
    expect(read).toMatchObject({ id: open.id, status: 'OPEN', lockedAt: null, sheetFileId: sheet.id, uploadVersion: 0 });
    expect(await dayCloseOf(std.DA.id, '2026-10-20')).toMatchObject({ id: approved.id, status: 'APPROVED', approvedByUserId: std.SA1.id });
    expect((await dayCloseOf(std.DA.id, '2026-10-20'))?.lockedAt).not.toBeNull();
    expect(await dayCloseOf(std.DA.id, '2026-10-19')).toBeNull();
    const [cylinder] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8 });
    await addDayCloseLines(open.id, [
      { cylinderId: cylinder.id, sheetKey: cylinder.shortCode, cylinderTypeId: std.sizes.kg11_8, systemPlace: DayClosePlace.STORE, systemState: CylinderState.FULL, reportedState: CylinderState.FAULTY, note: 'Valve leaking', diff: DayCloseDiff.STATE_DIFFERS },
      { sheetKey: 'AG-C0099', cylinderTypeId: std.sizes.kg11_8, reportedState: CylinderState.EMPTY, diff: DayCloseDiff.UNKNOWN_CYLINDER },
    ]);
    expect((await dayCloseLines(open.id)).map((line) => [line.sheetKey, line.diff, line.cylinderId !== null])).toEqual([
      [cylinder.shortCode, 'STATE_DIFFERS', true],
      ['AG-C0099', 'UNKNOWN_CYLINDER', false],
    ]);
    await expect(addDayCloseLines(open.id, [{ sheetKey: 'AG-C0098', diff: DayCloseDiff.MATCH }])).rejects.toThrow(/dcl_unknown_chk/);
    await expect(createDayClose({ distributor: std.DA, businessDate: '2026-10-21' })).rejects.toThrow(/Unique constraint/);
  });

  it('the sheet helpers build, read and fill in a day-end workbook with the contract layout', async () => {
    const about = daySheetAbout({ distributorId: std.DA.id, distributorCode: 'AG', businessDate: '2026-10-21', sheetFileId: '44000000-0000-4000-8000-000000000001' });
    const built = await buildDaySheet({
      about,
      cylinders: [
        { number: 'AG-C0001', size: '11.8 kg', appWhere: 'In my store', appState: 'Full' },
        { number: 'AG-C0002', size: '11.8 kg', appWhere: "On driver's van · LEA-101", appState: 'Full' },
        { number: 'AG-C0003', size: '15 kg', appWhere: 'Missing', appState: '' },
      ],
    });
    expect(built.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'binary'))).toBe(true);
    const read = await readDaySheet(built);
    expect(read.sheets).toEqual([
      { name: 'Cylinders', state: 'visible' },
      { name: 'Extra cylinders', state: 'visible' },
      { name: 'About', state: 'veryHidden' },
    ]);
    expect(read.about).toEqual({ format: DAY_SHEET_FORMAT, distributorId: std.DA.id, distributorCode: 'AG', businessDate: '2026-10-21', sheetFileId: '44000000-0000-4000-8000-000000000001' });
    expect(read.cylinderHeaders).toEqual([...DAY_SHEET_CYLINDER_HEADERS]);
    expect(read.extraHeaders).toEqual([...DAY_SHEET_EXTRA_HEADERS]);
    expect(read.cylinders.map((row) => [row.row, row.number, row.appWhere, row.countWhere])).toEqual([
      [2, 'AG-C0001', 'In my store', ''],
      [3, 'AG-C0002', "On driver's van · LEA-101", ''],
      [4, 'AG-C0003', 'Missing', ''],
    ]);

    const filled = await fillDaySheet(built, {
      rows: { 'ag-c0001': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } },
      extra: [{ number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }],
      deleteRows: ['AG-C0003'],
    });
    const after = await readDaySheet(filled);
    expect(after.cylinders.map((row) => [row.number, row.countWhere, row.countState, row.why])).toEqual([
      ['AG-C0001', 'In my store', 'Damaged', 'Valve leaking'],
      ['AG-C0002', '', '', ''],
    ]);
    expect(after.extra).toEqual([{ row: 2, number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }]);
    expect(after.about.format).toBe(DAY_SHEET_FORMAT);
    await expect(fillDaySheet(built, { rows: { 'AG-C0042': { where: 'Missing' } } })).rejects.toThrow(/no row for AG-C0042/);
    // A broken sheet for the upload's refusals: no About sheet, a renamed tab, a changed header.
    const broken = await readDaySheet(
      await buildDaySheet({ about, cylinders: [], omit: ['ABOUT'], cylindersSheetName: 'Sheet1', cylinderHeaders: ['Cylinder number', 'Size', 'Where'] }),
    );
    expect(broken.sheets.map((sheet) => sheet.name)).toEqual(['Sheet1', 'Extra cylinders']);
    expect(broken.about).toEqual({});
  });
});
