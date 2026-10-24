/**
 * [Inc 2] The holder rules (ADR-13, API_CONTRACT §9.2, §9.11): HLD-001 to HLD-003 and HLD-009 to HLD-012.
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { recordMove } from '../../helpers/runs';
import { buildWorld, X1, X2, Y1, type World } from './support/world';

jest.setTimeout(300_000);

describeDb('inc2 scan: holder rules', () => {
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

  /** Every DA cylinder has one holder, equal to where its last move (its newest) put it; returns the counts. */
  async function checkpoint(label: string): Promise<{ store: number; vans: number; customers: number }> {
    const cylinders = await w.db.cylinder.findMany({
      where: { distributorId: w.std.DA.id },
      select: { id: true, custodyType: true, custodyId: true, lastEventId: true, events: { select: { id: true, createdAt: true } } },
    });
    expect({ label, count: cylinders.length }).toEqual({ label, count: 35 });
    const counts = { store: 0, vans: 0, customers: 0 };
    for (const cylinder of cylinders) {
      expect({ label, type: ['STORE', 'VEHICLE', 'CLIENT'].includes(cylinder.custodyType), id: !!cylinder.custodyId }).toEqual({ label, type: true, id: true });
      const last = await w.db.cylinderEvent.findUniqueOrThrow({ where: { id: cylinder.lastEventId as string } });
      expect({ label, to: [last.toCustodyType, last.toCustodyId] }).toEqual({ label, to: [cylinder.custodyType, cylinder.custodyId] });
      const newest = Math.max(...cylinder.events.map((e) => e.createdAt.getTime()));
      expect(last.createdAt.getTime()).toBe(newest);
      if (cylinder.custodyType === 'STORE') counts.store += 1;
      else if (cylinder.custodyType === 'VEHICLE') counts.vans += 1;
      else counts.customers += 1;
    }
    expect(counts.store + counts.vans + counts.customers).toBe(35);
    return counts;
  }

  it('HLD-001 Every cylinder has exactly one holder at every step of a full day', async () => {
    const { std, scans } = w;
    for (const n of [11, 12, 32]) await w.withCustomer(n, 'C1');
    await checkpoint('start');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 1 },
      { size: '45.4', full: 1, back: 1 },
    ]);
    const x2 = await w.placeOrder(X2, 'C2');
    const y1 = await w.placeOrder(Y1, 'C2');
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(x2, std.DR1);
    const t2 = await w.assign(y1, std.DR2);

    for (const n of [1, 2, 31, 21, 22, 23]) {
      await w.load(std.DR1, t1, [n]);
      await checkpoint(`load ${n}`);
    }
    await w.doneLoading(std.DR1, t1);
    await w.load(std.DR2, t2, [3]);
    await checkpoint('DR2 load');
    await w.doneLoading(std.DR2, t2);
    for (const n of [1, 2, 31]) {
      await w.hand(std.DR1, t1, x1, [n]);
      await checkpoint(`hand ${n}`);
    }
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');
    await checkpoint('take back 11');
    await w.takeBack(std.DR1, t1, x1, 32, 'FULL');
    await checkpoint('take back 32');
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    await scans.failOrder(std.DR1, x2.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    await w.hand(std.DR2, t2, y1, [3]);
    await checkpoint('DR2 hand 3');
    expect((await w.finishVisit(std.DR2, t2, y1)).status).toBe(200);
    for (const n of [11, 32, 21, 22, 23]) {
      expect((await w.receive(n)).status).toBe(201);
      await checkpoint(`receive ${n}`);
    }
    await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    await scans.finishTrip(std.DR2, t2.id, {}).expect(200);

    const end = await checkpoint('end of day');
    expect(end).toEqual({ store: 30, vans: 0, customers: 5 });
    const sana = await w.db.cylinder.findMany({ where: { custodyType: 'CLIENT', custodyId: std.C1.id }, select: { shortNo: true } });
    expect(sana.map((c) => c.shortNo).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 12, 31]);
    const usman = await w.db.cylinder.findMany({ where: { custodyType: 'CLIENT', custodyId: std.C2.id }, select: { shortNo: true } });
    expect(usman.map((c) => c.shortNo)).toEqual([3]);

    const stock = await scans.storeStock(std.DA).expect(200);
    expect(stock.body.total).toBe(30);
    const bySize = Object.fromEntries(stock.body.sizes.map((s: { sizeLabel: string; byState: Record<string, number> }) => [s.sizeLabel, s.byState]));
    expect(bySize['11.8 kg']).toMatchObject({ FULL: 15, EMPTY: 1, PART_FILLED: 0 });
    expect(bySize['15 kg']).toMatchObject({ FULL: 10 });
    expect(bySize['45.4 kg']).toMatchObject({ FULL: 4 });
    const incoming = await scans.storeIncoming(std.DA).expect(200);
    expect(incoming.body).toEqual({ vans: [] });
    expect(await w.db.cylinderEvent.count({ where: { OR: [{ toCustodyType: 'DISTRIBUTOR' }, { eventType: 'RETURNED_TO_DISTRIBUTOR' }] } })).toBe(0);
    await w.walletClean();
  });

  it('HLD-002 Only a scan moves a holder: clients can\'t choose the destination, and transfers are off', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);

    const withHolder = { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode, toCustodyType: 'CLIENT', toCustodyId: std.C3.id };
    const chosen = await scans.tripScan(std.DR1, t1.id, withHolder as never);
    expect(chosen.status).toBe(400);
    expect(chosen.body.code).toBe('VALIDATION_FAILED');
    expect(chosen.body.details.fields.map((f: { path: string; code: string }) => [f.path, f.code])).toEqual(
      expect.arrayContaining([['toCustodyType', 'NOT_ALLOWED'], ['toCustodyId', 'NOT_ALLOWED']]),
    );
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE' });

    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    const withStore = { code: w.ag(1).qrCode, toCustodyId: std.DB.homeStoreId };
    const storeChosen = await scans.storeScan(std.DA, withStore as never);
    expect(storeChosen.status).toBe(400);
    expect(storeChosen.body.code).toBe('VALIDATION_FAILED');
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });

    const move = { fromStoreId: std.DA.homeStoreId, toStoreId: std.DB.homeStoreId, cylinderIds: [w.ag(2).id] };
    const byShop = await w.as(std.DA).post('/transfers').send(move);
    const byOffice = await w.as(std.SA1).post('/transfers').send(move);
    expect([byShop.status, byOffice.status]).toEqual([403, 403]);
    // The office passes the role check and meets the switch; the shop never had the role (§3.4 order).
    expect(byOffice.body).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(['PERMISSION_DENIED', 'FEATURE_DISABLED']).toContain(byShop.body.code);
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });

    const mine = await w.as(std.DR1).get('/transfers/mine').expect(200);
    expect(mine.body).toEqual([]);
    expect(mine.headers['x-feature-disabled']).toBe('transfers');
  });

  it('HLD-003 No IN, no OUT: a cylinder not loaded on this van can\'t be handed over', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    const y1 = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(y1, std.DR2);
    await w.load(std.DR2, t2, [3]);
    const sana = await t1.stopFor(x1.id);

    for (const n of [5, 3]) {
      const res = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: w.ag(n).qrCode });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'SCAN_NOT_ON_YOUR_VAN', message: "Not loaded on your van. Don't deliver it. Call office." });
    }
    expect(await w.holder(5)).toMatchObject({ custodyType: 'STORE' });
    expect(await w.holder(3)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR2.vehicleId });
    expect(await w.db.stopCylinder.count({ where: { tripStopId: sana } })).toBe(0);
    const detail = await scans.stop(std.DR1, t1.id, sana).expect(200);
    expect(detail.body.progress.give).toMatchObject({ doneCount: 0, neededCount: 3 });
  });

  it('HLD-009 A scan of another distributor\'s cylinder is refused on the driver\'s run', async () => {
    const { std, scans } = w;
    const bg1 = await w.bg(1);
    const bg2 = await w.bg(2);
    await recordMove({
      cylinderId: bg1.id,
      eventType: CylinderEventType.SCAN_IN,
      actorUserId: std.SA1.id,
      from: { type: CustodyType.STORE, id: std.DB.homeStoreId },
      to: { type: CustodyType.STORE, id: std.DA.homeStoreId },
      fromState: CylinderState.FULL,
      toState: CylinderState.FULL,
    });
    await recordMove({
      cylinderId: bg2.id,
      eventType: CylinderEventType.DELIVERED,
      actorUserId: std.SA1.id,
      from: { type: CustodyType.STORE, id: std.DB.homeStoreId },
      to: { type: CustodyType.CLIENT, id: std.C1.id },
      fromState: CylinderState.FULL,
      toState: CylinderState.FULL,
    });
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);

    const load = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: bg1.qrCode });
    expect(load.status).toBe(409);
    expect(load.body).toMatchObject({ code: 'SCAN_WRONG_OWNER', message: 'This cylinder belongs to another shop.' });
    expect(load.body.details.progress).toMatchObject({ doneCount: 0, neededCount: 3 });

    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    const back = await scans.tripScan(std.DR1, t1.id, { stopId: await t1.stopFor(x1.id), action: 'TAKE_BACK', code: bg2.qrCode, returnState: 'EMPTY' });
    expect(back.status).toBe(409);
    expect(back.body.code).toBe('SCAN_WRONG_OWNER');

    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: bg1.id } })).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    expect(await w.db.cylinder.findUniqueOrThrow({ where: { id: bg2.id } })).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    expect(await w.db.cylinderEvent.count({ where: { cylinderId: { in: [bg1.id, bg2.id] } } })).toBe(4);
  });

  it('HLD-010 Two drivers loading the same cylinder at once: one wins, it lands on one van', async () => {
    for (let round = 1; round <= 20; round += 1) {
      if (round > 1) {
        await resetDb();
        w = await buildWorld(app);
      }
      const { std, scans } = w;
      const x1 = await w.placeOrder(X1);
      const t1 = await w.assign(x1, std.DR1);
      const y1 = await w.placeOrder(Y1, 'C2');
      const t2 = await w.assign(y1, std.DR2);
      const [a, b] = await Promise.all([
        scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).then((r) => r),
        scans.tripScan(std.DR2, t2.id, { stopId: t2.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).then((r) => r),
      ]);
      expect({ round, statuses: [a.status, b.status].sort() }).toEqual({ round, statuses: [201, 409] });
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('SCAN_NOT_AT_STORE');
      const winnerVan = a.status === 201 ? std.DR1.vehicleId : std.DR2.vehicleId;
      expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: winnerVan });
      expect(await w.eventCount(1, 'SCAN_OUT')).toBe(1);
      const winnerTrip = a.status === 201 ? t1 : t2;
      const loserTrip = a.status === 201 ? t2 : t1;
      const won = await scans.trip(a.status === 201 ? std.DR1 : std.DR2, winnerTrip.id).expect(200);
      const lost = await scans.trip(a.status === 201 ? std.DR2 : std.DR1, loserTrip.id).expect(200);
      expect(won.body.stops.find((s: { id: string }) => s.id === winnerTrip.pickupStopId).progress.doneCount).toBe(1);
      expect(lost.body.stops.find((s: { id: string }) => s.id === loserTrip.pickupStopId).progress.doneCount).toBe(0);
    }
  });

  it('HLD-011 A cylinder left on the van from an earlier run can\'t be handed over on today\'s run', async () => {
    const { std, scans } = w;
    await w.setting('trip.allowFinishWithLeftovers', true);
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await scans.failOrder(std.DR1, x1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    await scans.finishTrip(std.DR1, t1.id, { leftoverReason: 'Customer away, store shut' }).expect(200);

    const x1c = await w.placeOrder(X1);
    const t3 = await w.assign(x1c, std.DR1);
    expect(t3.id).not.toBe(t1.id);
    const view = await scans.trip(std.DR1, t3.id).expect(200);
    expect(view.body.stops.find((s: { id: string }) => s.id === t3.pickupStopId).progress).toMatchObject({ doneCount: 0, neededCount: 3 });

    await w.load(std.DR1, t3, [4, 5, 33]);
    await w.doneLoading(std.DR1, t3);
    const sana = await t3.stopFor(x1c.id);
    const stale = await scans.tripScan(std.DR1, t3.id, { stopId: sana, action: 'HANDOVER', code: w.ag(1).qrCode });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('SCAN_NOT_ON_YOUR_VAN');
    expect(stale.body.details.progress.give).toMatchObject({ doneCount: 0 });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
    await scans.tripScan(std.DR1, t3.id, { stopId: sana, action: 'HANDOVER', code: w.ag(4).qrCode }).expect(201);
  });

  it('HLD-012 A Full cylinder taken back never goes straight to another customer', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 1 },
      { size: '45.4', full: 1 },
    ]);
    const y1 = await w.placeOrder(Y1, 'C2');
    expect(await w.balance()).toBe(412_000n);
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(y1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 3, 31]);
    await w.doneLoading(std.DR1, t1);

    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'FULL');
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    const usman = await t1.stopFor(y1.id);
    const straight = await scans.tripScan(std.DR1, t1.id, { stopId: usman, action: 'HANDOVER', code: w.ag(11).qrCode });
    expect(straight.status).toBe(409);
    expect(straight.body).toMatchObject({ code: 'SCAN_TAKEN_BACK_NOT_UNLOADED', message: 'Taken back from a customer. Unload it at the store first.' });
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId, state: 'FULL' });

    await scans.tripScan(std.DR1, t1.id, { stopId: usman, action: 'HANDOVER', code: w.ag(3).qrCode }).expect(201);
    expect((await w.finishVisit(std.DR1, t1, y1)).status).toBe(200);
    expect((await w.receive(11)).status).toBe(201);
    expect(await w.holder(11)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });

    const later = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(later, std.DR2);
    await scans.tripScan(std.DR2, t2.id, { stopId: t2.pickupStopId, action: 'LOAD', code: w.ag(11).qrCode }).expect(201);
  });
});
