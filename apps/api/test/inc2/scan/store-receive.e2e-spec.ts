/**
 * [Inc 2] The store scans IN what drivers bring back (ADR-13, API_CONTRACT §9.2 STORE_RECEIVE, §9.4):
 * STR-001 to STR-009.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { CylinderState } from '@prisma/client';
import { authHeader } from '../../helpers/auth';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { buildWorld, X1, X2, Y1, type PlacedOrder, type Trip, type World } from './support/world';

jest.setTimeout(180_000);

describeDb('inc2 scan: the store receives', () => {
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

  /**
   * Fixture F1 (Sana holds AG-C0011, AG-C0012 and AG-C0032), then X1 delivered on DR1's T1 (AG-C0001,
   * AG-C0002, AG-C0031) with `back` taken back at Sana's (state as tapped) and the visit finished.
   */
  async function deliveredWith(back: Array<[number, 'EMPTY' | 'PART_FILLED' | 'FULL']>, extraWithSana: number[] = []): Promise<{ x1: PlacedOrder; t1: Trip }> {
    for (const n of [11, 12, 32, ...extraWithSana]) await w.withCustomer(n, 'C1');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 2 },
      { size: '45.4', full: 1, back: 1 },
    ]);
    const t1 = await w.assign(x1, w.std.DR1);
    await w.load(w.std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(w.std.DR1, t1);
    await w.hand(w.std.DR1, t1, x1, [1, 2, 31]);
    for (const [n, state] of back) await w.takeBack(w.std.DR1, t1, x1, n, state);
    expect((await w.finishVisit(w.std.DR1, t1, x1, { takeBackShort: { reasonCode: 'CUSTOMER_KEPT' } })).status).toBe(200);
    return { x1, t1 };
  }

  const sizeRow = (stock: { sizes: Array<{ sizeLabel: string; byState: Record<string, number> }> }, label: string) =>
    stock.sizes.find((s) => s.sizeLabel === label)?.byState ?? {};

  it('STR-001 The store scans in a taken-back cylinder from the driver\'s van', async () => {
    const { std, scans } = w;
    await deliveredWith([[11, 'EMPTY']]);
    const before = (await scans.storeStock(std.DA).expect(200)).body;

    const res = await scans.storeScan(std.DA, { scanId: randomUUID(), code: w.ag(11).qrCode, entryMethod: 'QR' }).expect(201);
    expect(res.body).toMatchObject({
      result: 'RECORDED',
      cylinder: { state: 'EMPTY', holder: { type: 'STORE', label: 'Ahmed Gas Store' } },
      stop: null,
      fromVan: { plateNo: 'LEA-101', driver: { id: std.DR1.id, name: 'Kashif' } },
      receivedToday: { count: 1, bySize: [{ cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', count: 1 }] },
    });
    expect(res.body.scan).toMatchObject({ action: 'STORE_RECEIVE' });

    const after = (await scans.storeStock(std.DA).expect(200)).body;
    expect(sizeRow(after, '11.8 kg').EMPTY).toBe((sizeRow(before, '11.8 kg').EMPTY ?? 0) + 1);
    expect(after.total).toBe(before.total + 1);
    const incoming = await scans.storeIncoming(std.DA).expect(200);
    expect(JSON.stringify(incoming.body)).not.toContain('AG-C0011');

    const event = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(11).id }, orderBy: { createdAt: 'desc' } });
    expect(event).toMatchObject({
      eventType: 'SCAN_IN',
      actorUserId: std.DA.userId,
      fromCustodyType: 'VEHICLE',
      fromCustodyId: std.DR1.vehicleId,
      toCustodyType: 'STORE',
      toCustodyId: std.DA.homeStoreId,
      source: 'SCAN',
    });
    expect(await w.balance()).toBe(452_000n);
  });

  it('STR-002 Receiving keeps the state the driver tapped: Part-filled and Empty never become Full', async () => {
    const { std, scans } = w;
    await w.withCustomer(13, 'C1');
    await w.markState(13, CylinderState.FAULTY);
    await deliveredWith([
      [11, 'PART_FILLED'],
      [12, 'EMPTY'],
      [32, 'FULL'],
      [13, 'EMPTY'],
    ]);
    const states: Record<number, string> = { 11: 'PART_FILLED', 12: 'EMPTY', 32: 'FULL' };
    for (const n of [11, 12, 32]) {
      const res = await w.receive(n);
      expect(res.status).toBe(201);
      expect(res.body.cylinder.state).toBe(states[n]);
    }
    const stock = (await scans.storeStock(std.DA).expect(200)).body;
    expect(sizeRow(stock, '11.8 kg')).toMatchObject({ PART_FILLED: 1, EMPTY: 1 });
    // AG-C0033 to AG-C0035 never left, plus AG-C0032 back Full (AG-C0031 is with Sana now).
    expect(sizeRow(stock, '45.4 kg').FULL).toBe(4);
    expect(await w.holder(32)).toMatchObject({ custodyType: 'STORE', state: 'FULL' });

    const next = await w.placeOrder(X1);
    const t2 = await w.assign(next, std.DR1);
    const partly = await scans.tripScan(std.DR1, t2.id, { stopId: t2.pickupStopId, action: 'LOAD', code: w.ag(11).qrCode });
    expect(partly.status).toBe(409);
    expect(partly.body.code).toBe('SCAN_NOT_FULL');
    await scans.tripScan(std.DR1, t2.id, { stopId: t2.pickupStopId, action: 'LOAD', code: w.ag(32).qrCode }).expect(201);

    const damaged = await w.receive(13);
    expect(damaged.status).toBe(201);
    expect(await w.holder(13)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FAULTY' });
    const blocked = await scans.tripScan(std.DR1, t2.id, { stopId: t2.pickupStopId, action: 'LOAD', code: w.ag(13).qrCode });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('SCAN_CYLINDER_BLOCKED');
  });

  it('STR-003 Receiving the same cylinder twice records it once (resend, second scan, two phones)', async () => {
    const { std, scans } = w;
    await deliveredWith([
      [11, 'EMPTY'],
      [32, 'FULL'],
    ]);
    const r1 = randomUUID();
    const first = await scans.storeScan(std.DA, { scanId: r1, code: w.ag(11).qrCode }).expect(201);
    expect(first.body.result).toBe('RECORDED');
    const resend = await scans.storeScan(std.DA, { scanId: r1, code: w.ag(11).qrCode });
    expect(resend.status).toBe(200);
    expect(resend.headers['idempotent-replay']).toBe('true');
    expect(resend.body.result).toBe('ALREADY_RECORDED');
    const second = await scans.storeScan(std.DA, { scanId: randomUUID(), code: w.ag(11).qrCode });
    expect(second.status).toBe(200);
    expect(second.headers['x-already-applied']).toBe('true');
    expect(second.body.result).toBe('ALREADY_RECORDED');

    // Two phones of the same shop: two tokens, one moment.
    const phone = (scanId: string) =>
      http(app)
        .post('/api/v1/store/scans')
        .set(authHeader(std.DA.actor))
        .send({ scanId, code: w.ag(32).qrCode, entryMethod: 'QR' })
        .then((r) => r);
    const both = await Promise.all([phone(randomUUID()), phone(randomUUID())]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    const soft = both.find((r) => r.status === 200);
    expect(soft?.headers['x-already-applied']).toBe('true');
    expect(soft?.body.result).toBe('ALREADY_RECORDED');

    expect(await w.eventCount(11, 'SCAN_IN')).toBe(1);
    expect(await w.eventCount(32, 'SCAN_IN')).toBe(1);
    const last = await scans.storeScan(std.DA, { code: w.ag(32).qrCode });
    expect(last.body.receivedToday.count).toBe(2);
  });

  it('STR-004 The store can\'t scan in a cylinder that isn\'t on a van', async () => {
    const { std, scans } = w;
    await deliveredWith([]);
    const res = await scans.storeScan(std.DA, { code: w.ag(12).qrCode });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'SCAN_NOT_ON_A_VAN', message: "This cylinder isn't on a van." });
    const unknown = await scans.storeScan(std.DA, { code: 'ZZ-NOT-A-CYLINDER' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('SCAN_CYLINDER_UNKNOWN');
    expect(await w.holder(12)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    expect(await w.eventCount(12, 'SCAN_IN')).toBe(0);
  });

  it('STR-005 Another distributor\'s store can\'t receive or see this distributor\'s cylinders', async () => {
    const { std, scans } = w;
    await deliveredWith([[11, 'EMPTY']]);
    const byQr = await scans.storeScan(std.DB, { code: w.ag(11).qrCode });
    expect(byQr.status).toBe(409);
    expect(byQr.body).toMatchObject({ code: 'SCAN_WRONG_OWNER', message: 'This cylinder belongs to another shop.' });
    const typed = await scans.storeScan(std.DB, { code: '0011', entryMethod: 'TYPED' });
    expect(typed.status).toBe(404);
    expect(typed.body.code).toBe('SCAN_CYLINDER_UNKNOWN');
    const incoming = await scans.storeIncoming(std.DB).expect(200);
    expect(incoming.body).toEqual({ vans: [] });
    const stock = await scans.storeStock(std.DB).expect(200);
    expect(JSON.stringify(stock.body)).not.toContain('AG-');
    expect(stock.body.total).toBe(0);
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
  });

  it('STR-006 Only the distributor\'s shop app can scan cylinders into the store', async () => {
    const { std, scans } = w;
    await deliveredWith([[11, 'EMPTY']]);
    for (const res of [
      await scans.storeScan(std.DR1, { code: w.ag(11).qrCode }),
      await scans.storeScan(std.SA1, { code: w.ag(11).qrCode }),
      await scans.storeIncoming(std.DR1),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    }
    expect(await w.holder(11)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
  });

  it('STR-007 Returns from any van go into the distributor\'s own store', async () => {
    const { std, scans } = w;
    const y1 = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(y1, std.DR2);
    await w.load(std.DR2, t2, [3]);
    await w.doneLoading(std.DR2, t2);
    await scans.failOrder(std.DR2, y1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);

    const res = await scans.storeScan(std.DA, { scanId: randomUUID(), code: w.ag(3).qrCode, entryMethod: 'QR' }).expect(201);
    expect(res.body.fromVan).toEqual({ plateNo: 'LEB-202', driver: { id: std.DR2.id, name: 'Imran' } });
    expect(await w.holder(3)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });
    const done = await scans.finishTrip(std.DR2, t2.id, {}).expect(200);
    expect(done.body.status).toBe('COMPLETED');
  });

  it('STR-008 The incoming list tells the store why each cylinder is coming back', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 1 },
      { size: '45.4', full: 1 },
    ]);
    const x2 = await w.placeOrder(X2, 'C2');
    const y1 = await w.placeOrder(Y1, 'C2');
    expect(await w.balance()).toBe(372_000n);
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(x2, std.DR1);
    await w.assign(y1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 3, 31, 21, 22, 23]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    await scans.failOrder(std.DR1, x2.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    const cancel = await w.as(std.DA).post(`/orders/${y1.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    expect(cancel.body.refundedPaisa).toBe('0');

    const incoming = await scans.storeIncoming(std.DA).expect(200);
    expect(incoming.body.vans).toHaveLength(1);
    const van = incoming.body.vans[0];
    expect(van).toMatchObject({
      vehicle: { id: std.DR1.vehicleId, plateNo: 'LEA-101' },
      driver: { id: std.DR1.id, name: 'Kashif' },
      trip: { id: t1.id, status: 'IN_PROGRESS' },
      counts: { total: 5, received: 0 },
    });
    expect(van.counts.bySize).toEqual([
      { cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', count: 2 },
      { cylinderTypeId: std.sizes.kg15, sizeLabel: '15 kg', count: 3 },
    ]);
    const byCode = Object.fromEntries(van.cylinders.map((c: { shortCode: string }) => [c.shortCode, c]));
    expect(byCode['AG-C0011']).toMatchObject({ state: 'EMPTY', came: 'TAKEN_BACK', from: { clientName: 'Sana', orderShortCode: x1.shortCode }, refill: null });
    for (const code of ['AG-C0021', 'AG-C0022', 'AG-C0023']) expect(byCode[code]).toMatchObject({ state: 'FULL', came: 'NOT_DELIVERED' });
    expect(byCode['AG-C0003']).toMatchObject({ state: 'FULL', came: 'SPARE' });

    for (const n of [11, 3]) expect((await w.receive(n)).status).toBe(201);
    const after = await scans.storeIncoming(std.DA).expect(200);
    expect(after.body.vans[0].counts.received).toBe(2);
    expect(after.body.vans[0].cylinders.map((c: { shortCode: string }) => c.shortCode).sort()).toEqual(['AG-C0021', 'AG-C0022', 'AG-C0023']);
    expect(await w.balance()).toBe(372_000n);
    await w.walletClean();
  });

  it('STR-009 A wrongly loaded cylinder scanned back in during loading must be replaced before "Done loading"', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2]);

    const back = await w.receive(2);
    expect(back.status).toBe(201);
    expect(back.body.fromVan).toMatchObject({ plateNo: 'LEA-101', driver: { name: 'Kashif' } });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', state: 'FULL' });

    const trip = await scans.trip(std.DR1, t1.id).expect(200);
    const line = trip.body.stops.find((s: { id: string }) => s.id === t1.pickupStopId).progress.lines.find((l: { sizeLabel: string }) => l.sizeLabel === '11.8 kg');
    expect(line).toMatchObject({ needed: 2, done: 1 });

    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(31).qrCode }).expect(201);
    const early = await scans.finishStop(std.DR1, t1.id, t1.pickupStopId);
    expect(early.status).toBe(409);
    expect(early.body.details).toMatchObject({ total: 3, done: 2 });
    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(4).qrCode }).expect(201);
    await scans.finishStop(std.DR1, t1.id, t1.pickupStopId).expect(200);

    const order = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body.loadStartedAt).toEqual(expect.any(String));
    expect(order.body.cancel.refundPaisa).toBe('0');
  });
});
