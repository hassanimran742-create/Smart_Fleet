/**
 * The custody module's Inc 3 extension points (src/modules/custody/custody-moves.ts): the one move write
 * the refill scans and the day-end approval use (an event with its holders, states, source, reason and
 * refill; the cylinder's holder, state and last event; the legacy lots), the lock, and the one rule for
 * "on an open refill line". No money moves.
 */
import { CustodyType, CylinderEventSource, CylinderEventType, CylinderState, FillingOrderStatus } from '@prisma/client';
import { lockCylinderForMove, openRefillLineCylinderIds, recordCustodyMove } from '../../../src/modules/custody/custody-moves';
import {
  advanceRefill,
  createRefill,
  createStandardData,
  cylinderHolder,
  describeDb,
  getTestPrisma,
  pickUpForRefill,
  receiveForRefill,
  registerCylinders,
  walletMismatches,
  type StandardData,
} from '../../helpers';
import { resetDb } from '../../helpers/db';

describeDb('custody moves for the Inc 3 lanes', () => {
  const db = () => getTestPrisma();
  let std: StandardData;

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
  });

  it('records a refill pickup as one move: SCAN_OUT with the refill and no trip, onto the van, with the lots in step', async () => {
    const [empty] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, state: CylinderState.EMPTY });
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 1, assignTo: std.DR2 });
    const event = await db().$transaction(async (tx) => {
      const cylinder = await lockCylinderForMove(tx, empty.id);
      return recordCustodyMove(tx, {
        cylinder,
        eventType: CylinderEventType.SCAN_OUT,
        to: { type: CustodyType.VEHICLE, id: std.DR2.vehicleId as string },
        toState: cylinder.state,
        source: CylinderEventSource.SCAN,
        actorUserId: std.DR2.userId,
        clientScanId: '55000000-0000-4000-8000-000000000001',
        fillingOrderId: refill.id,
        lat: 31.52,
        lng: 74.22,
      });
    });
    expect(event).toMatchObject({
      eventType: 'SCAN_OUT',
      source: 'SCAN',
      fromCustodyType: 'STORE',
      fromCustodyId: std.DA.homeStoreId,
      toCustodyType: 'VEHICLE',
      toCustodyId: std.DR2.vehicleId,
      fromState: 'EMPTY',
      toState: 'EMPTY',
      tripId: null,
      orderId: null,
      fillingOrderId: refill.id,
      clientScanId: '55000000-0000-4000-8000-000000000001',
    });
    expect(await cylinderHolder(empty.id)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR2.vehicleId, state: 'EMPTY', lastEventId: event.id });
    const [located] = await db().$queryRaw<Array<{ lng: number; lat: number }>>`SELECT ST_X(location) AS lng, ST_Y(location) AS lat FROM cylinder_events WHERE id = ${event.id}::uuid`;
    expect(located).toEqual({ lng: 74.22, lat: 31.52 });
    const lots = await db().inventoryLot.findMany({ where: { distributorId: std.DA.id, cylinderTypeId: std.sizes.kg11_8, state: 'EMPTY' } });
    expect(Object.fromEntries(lots.map((lot) => [lot.holderType, lot.count]))).toMatchObject({ VEHICLE: 1 });
  });

  it('records a day-end fix only with its reason (DAY_END_FIX), and an unknown cylinder is SCAN_CYLINDER_UNKNOWN', async () => {
    const [full] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8 });
    const fix = (reason: string | null) =>
      db().$transaction(async (tx) => {
        const cylinder = await lockCylinderForMove(tx, full.id);
        return recordCustodyMove(tx, {
          cylinder,
          eventType: CylinderEventType.ADJUSTED,
          to: { type: cylinder.custody_type, id: cylinder.custody_id },
          toState: CylinderState.FAULTY,
          source: CylinderEventSource.DAY_END_FIX,
          actorUserId: std.SA1.id,
          reason,
        });
      });
    await expect(fix(null)).rejects.toThrow(/needs its reason/);
    const event = await fix('Valve leaking');
    expect(event).toMatchObject({ eventType: 'ADJUSTED', source: 'DAY_END_FIX', reason: 'Valve leaking', fromState: 'FULL', toState: 'FAULTY', toCustodyType: 'STORE' });
    expect(await cylinderHolder(full.id)).toMatchObject({ custodyType: 'STORE', state: 'FAULTY', lastEventId: event.id });
    await expect(db().$transaction((tx) => lockCylinderForMove(tx, '56000000-0000-4000-8000-000000000000'))).rejects.toMatchObject({
      code: 'SCAN_CYLINDER_UNKNOWN',
    });
    expect(await walletMismatches()).toEqual([]);
  });

  it('finds the cylinders on an open refill line, by cylinder or by van, and never a returned one', async () => {
    const empties = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 3, state: CylinderState.EMPTY });
    const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 3, assignTo: std.DR2 });
    await pickUpForRefill({ refill, driver: std.DR2, cylinders: empties.slice(0, 2) });
    await advanceRefill(refill, FillingOrderStatus.EMPTIES_PICKED);
    const open = await openRefillLineCylinderIds(db());
    expect([...open.keys()].sort()).toEqual([empties[0].id, empties[1].id].sort());
    expect(open.get(empties[0].id)).toEqual({ fillingOrderId: refill.id, refillNo: 1 });
    expect([...(await openRefillLineCylinderIds(db(), { vehicleId: std.DR2.vehicleId as string })).keys()]).toHaveLength(2);
    expect((await openRefillLineCylinderIds(db(), { vehicleId: std.DR1.vehicleId as string })).size).toBe(0);
    expect((await openRefillLineCylinderIds(db(), { cylinderIds: [empties[2].id] })).size).toBe(0);
    expect((await openRefillLineCylinderIds(db(), { cylinderIds: [] })).size).toBe(0);
    await receiveForRefill({ refill, shop: std.DA, cylinders: [empties[0]] });
    expect([...(await openRefillLineCylinderIds(db(), { cylinderIds: empties.map((c) => c.id) })).keys()]).toEqual([empties[1].id]);
    // A cancelled or completed refill holds nothing.
    await db().fillingOrder.update({ where: { id: refill.id }, data: { status: FillingOrderStatus.COMPLETED } });
    expect((await openRefillLineCylinderIds(db())).size).toBe(0);
  });
});
