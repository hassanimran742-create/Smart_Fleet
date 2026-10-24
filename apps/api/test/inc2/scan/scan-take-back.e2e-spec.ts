/**
 * [Inc 2] Take back at the customer (API_CONTRACT §9.2 TAKE_BACK, §9.3 unlabelled returns): DRV-026
 * to DRV-028 and DRV-030.
 */
import type { INestApplication } from '@nestjs/common';
import { CylinderState } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, messageOf, type Line, type PlacedOrder, type Trip, type World } from './support/world';

jest.setTimeout(180_000);

/** X1 with its expected returns: 2 × 11.8 kg and 1 × 45.4 kg back (still Rs 480). */
const X1_BACK: Line[] = [
  { size: '11.8', full: 2, back: 2 },
  { size: '45.4', full: 1, back: 1 },
];

describeDb('inc2 scan: take back at the customer', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Fixture F1 (Sana holds AG-C0011, AG-C0012 and AG-C0032) and X1 loaded with "Done loading" finished. */
  async function atSana(): Promise<{ x1: PlacedOrder; t1: Trip; sana: string }> {
    for (const n of [11, 12, 32]) await w.withCustomer(n, 'C1');
    const x1 = await w.placeOrder(X1_BACK);
    expect(await w.balance()).toBe(452_000n);
    const t1 = await w.assign(x1, w.std.DR1);
    await w.load(w.std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(w.std.DR1, t1);
    return { x1, t1, sana: await t1.stopFor(x1.id) };
  }

  it('DRV-026 Take back records the tapped state (Empty, Part-filled, Full) in its own list', async () => {
    const { std, scans } = w;
    const { x1, t1, sana } = await atSana();
    await w.markState(12, CylinderState.FAULTY);

    const noState = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(11).qrCode, entryMethod: 'QR' });
    expect(noState.status).toBe(400);
    expect(noState.body).toMatchObject({ code: 'SCAN_RETURN_STATE_REQUIRED', message: 'Choose Empty, Part-filled or Full first.' });
    expect(await w.holder(11)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });

    const empty = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(11).qrCode, returnState: 'EMPTY' }).expect(201);
    expect(empty.body.cylinder).toMatchObject({ state: 'EMPTY', holder: { type: 'VEHICLE', label: 'LEA-101' } });
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId, state: 'EMPTY' });
    const row11 = await w.db.stopCylinder.findFirstOrThrow({ where: { tripStopId: sana, cylinderId: w.ag(11).id } });
    expect(row11).toMatchObject({ direction: 'TAKEN_BACK', returnState: 'EMPTY', orderId: x1.id });

    await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(32).qrCode, returnState: 'FULL' }).expect(201);
    expect((await w.holder(32)).state).toBe('FULL');
    const damaged = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(12).qrCode, returnState: 'PART_FILLED' });
    expect(damaged.status).toBe(201);
    expect((await w.holder(12)).state).toBe('FAULTY');
    expect(await w.db.stopCylinder.findFirstOrThrow({ where: { tripStopId: sana, cylinderId: w.ag(12).id } })).toMatchObject({
      direction: 'TAKEN_BACK',
      returnState: 'PART_FILLED',
    });

    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    const detail = await scans.stop(std.DR1, t1.id, sana).expect(200);
    const { takeBack, give } = detail.body.progress;
    expect(takeBack).toMatchObject({ expected: 3, count: 3, byState: { EMPTY: 1, PART_FILLED: 1, FULL: 1 }, unlabelled: [] });
    expect(give).toMatchObject({ doneCount: 3, neededCount: 3, complete: true });
    const item12 = takeBack.items.find((item: { shortNo: number }) => item.shortNo === 12);
    expect(item12).toMatchObject({ code: w.ag(12).qrCode, sizeLabel: '11.8 kg', state: 'PART_FILLED' });
    const rows = await w.db.stopCylinder.findMany({ where: { tripStopId: sana } });
    const given = new Set(rows.filter((r) => r.direction === 'GIVEN').map((r) => r.cylinderId));
    const back = new Set(rows.filter((r) => r.direction === 'TAKEN_BACK').map((r) => r.cylinderId));
    expect([...given].filter((id) => back.has(id))).toEqual([]);
    expect(given.size).toBe(3);
    expect(back.size).toBe(3);
  });

  it('DRV-027 A cylinder given on a visit can\'t be taken back on the same visit', async () => {
    const { std, scans } = w;
    const { x1, t1, sana } = await atSana();
    await w.hand(std.DR1, t1, x1, [1]);

    const swap = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(1).qrCode, returnState: 'EMPTY' });
    expect(swap.status).toBe(409);
    expect(swap.body).toMatchObject({ code: 'SCAN_GIVEN_THIS_VISIT', message: messageOf('SCAN_GIVEN_THIS_VISIT') });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id, state: 'FULL' });
    const rows = await w.db.stopCylinder.findMany({ where: { tripStopId: sana, cylinderId: w.ag(1).id } });
    expect(rows.map((r) => r.direction)).toEqual(['GIVEN']);

    // Finish the visit and the run; on a later visit the cylinder can come back.
    await w.hand(std.DR1, t1, x1, [2, 31]);
    expect((await w.finishVisit(std.DR1, t1, x1, { takeBackShort: { reasonCode: 'CUSTOMER_KEPT' } })).status).toBe(200);
    await scans.finishTrip(std.DR1, t1.id).expect(200);
    const later = await w.placeOrder([{ size: '11.8', full: 1, back: 1 }]);
    const t2 = await w.assign(later, std.DR1);
    expect(t2.id).not.toBe(t1.id);
    await w.load(std.DR1, t2, [4]);
    await w.doneLoading(std.DR1, t2);
    const res = await scans.tripScan(std.DR1, t2.id, { stopId: await t2.stopFor(later.id), action: 'TAKE_BACK', code: w.ag(1).qrCode, returnState: 'EMPTY' });
    expect(res.status).toBe(201);
  });

  it('DRV-028 Take back refuses a cylinder the records don\'t place with this customer', async () => {
    const { std, scans } = w;
    const { t1, sana } = await atSana();
    await w.withCustomer(14, 'C2');
    const before = await Promise.all([14, 5].map((n) => w.eventCount(n)));
    for (const n of [14, 5]) {
      const res = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(n).qrCode, returnState: 'EMPTY' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'SCAN_NOT_WITH_THIS_CUSTOMER', message: "Our records don't show this cylinder with this customer." });
    }
    expect(await w.holder(14)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C2.id });
    expect(await w.holder(5)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    expect(await Promise.all([14, 5].map((n) => w.eventCount(n)))).toEqual(before);
    expect(await w.db.stopCylinder.count({ where: { tripStopId: sana, direction: 'TAKEN_BACK' } })).toBe(0);
  });

  it('DRV-030 Unlabelled or other-brand returns are counted by size, and a resend replaces the count', async () => {
    const { std, scans } = w;
    const { t1, sana } = await atSana();
    const stockBefore = await scans.storeStock(std.DA).expect(200);

    const one = await scans.unlabelledReturns(std.DR1, t1.id, sana, [{ cylinderTypeId: std.sizes.kg11_8, state: 'EMPTY', count: 1 }]).expect(200);
    expect(one.body.progress.takeBack.unlabelled).toEqual([{ cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', state: 'EMPTY', count: 1 }]);
    expect(one.body.progress.takeBack).toMatchObject({ count: 1, byState: { EMPTY: 1, PART_FILLED: 0, FULL: 0 } });

    const resend = await scans.unlabelledReturns(std.DR1, t1.id, sana, [{ cylinderTypeId: std.sizes.kg11_8, state: 'EMPTY', count: 1 }]).expect(200);
    expect(resend.body.progress.takeBack.unlabelled[0].count).toBe(1);

    const two = await scans.unlabelledReturns(std.DR1, t1.id, sana, [{ cylinderTypeId: std.sizes.kg11_8, state: 'EMPTY', count: 2 }]).expect(200);
    expect(two.body.progress.takeBack.unlabelled[0].count).toBe(2);

    const none = await scans.unlabelledReturns(std.DR1, t1.id, sana, [{ cylinderTypeId: std.sizes.kg11_8, state: 'EMPTY', count: 0 }]).expect(200);
    expect(none.body.progress.takeBack.unlabelled).toEqual([]);
    expect(await w.db.stopUnlabelledReturn.count({ where: { tripStopId: sana } })).toBe(0);
    const faulty = await scans.unlabelledReturns(std.DR1, t1.id, sana, [{ cylinderTypeId: std.sizes.kg11_8, state: 'FAULTY' as never, count: 1 }]);
    expect(faulty.status).toBe(400);
    expect(faulty.body.code).toBe('VALIDATION_FAILED');
    expect(await w.db.stopUnlabelledReturn.count({ where: { tripStopId: sana } })).toBe(0);

    const stranger = await scans.unlabelledReturns(std.DR2, t1.id, sana, [{ cylinderTypeId: std.sizes.kg11_8, state: 'EMPTY', count: 1 }]);
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe('NOT_FOUND');

    const stockAfter = await scans.storeStock(std.DA).expect(200);
    expect(stockAfter.body).toEqual(stockBefore.body);
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: sana } })).arrivedAt).not.toBeNull();
  });
});
