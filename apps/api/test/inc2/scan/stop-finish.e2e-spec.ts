/**
 * [Inc 2] "Finish visit" (API_CONTRACT §9.3 DELIVERY finish, §9.8): DRV-021, DRV-022, DRV-029 and
 * FEE-027 (the scan flow moves no money after placement).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, messageOf, X1, type World } from './support/world';

jest.setTimeout(180_000);

describeDb('inc2 scan: finish a visit', () => {
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

  it('DRV-021 "Finish visit" is refused while any cylinder of the order isn\'t handed over', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2]);

    const res = await w.finishVisit(std.DR1, t1, x1, {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'DELIVERY_SCANS_INCOMPLETE', message: messageOf('DELIVERY_SCANS_INCOMPLETE') });
    expect(res.body.details.missing).toEqual([{ sizeLabel: '45.4 kg', needed: 1, given: 0 }]);

    const order = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body.status).toBe('IN_TRANSIT');
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: await t1.stopFor(x1.id) } })).status).toBe('ARRIVED');
  });

  it('DRV-022 "Finish visit" with matching scans delivers the order once and moves no money', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);

    const res = await w.finishVisit(std.DR1, t1, x1, {});
    expect(res.status).toBe(200);
    expect(res.headers['x-already-applied']).toBeUndefined();
    expect(res.body.nextStopId).toBeNull();
    expect(res.body.order).toMatchObject({ id: x1.id, status: 'DELIVERED', deliveryMethod: 'SCANNED', stage: 'DELIVERED', deliveredAt: expect.any(String) });
    const sana = await t1.stopFor(x1.id);
    expect((await w.db.tripStop.findUniqueOrThrow({ where: { id: sana } })).status).toBe('DONE');

    const again = await w.finishVisit(std.DR1, t1, x1, {});
    expect(again.status).toBe(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body.order.deliveredAt).toBe(res.body.order.deliveredAt);

    const wallet = await w.as(std.SA1).get(`/admin/distributors/${std.DA.id}/wallet`).expect(200);
    expect(wallet.body.balancePaisa).toBe('475000');
    expect(wallet.body.integrity.ok).toBe(true);
    const ledger = await w.db.ledgerEntry.findMany({ where: { orderId: x1.id } });
    expect(ledger.map((row) => [row.entryType, row.amountPaisa])).toEqual([['DEBIT_ORDER', -25_000n]]);
    expect(await w.db.deliveryConfirmation.count({ where: { orderId: x1.id } })).toBe(0);
  });

  it('DRV-029 A short take-back needs a reason, and a finished visit takes no more scans', async () => {
    const { std, scans } = w;
    for (const n of [11, 12]) await w.withCustomer(n, 'C1');
    await w.withCustomer(32, 'C1');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 2 },
      { size: '45.4', full: 1, back: 1 },
    ]);
    expect(await w.balance()).toBe(475_000n);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');

    const short = await w.finishVisit(std.DR1, t1, x1, {});
    expect(short.status).toBe(409);
    expect(short.body).toMatchObject({ code: 'TAKE_BACK_SHORT', message: 'The customer gave back 1 of 3. Say why to finish.' });
    expect(short.body.details).toMatchObject({ expected: 3, taken: 1 });

    const noNote = await w.finishVisit(std.DR1, t1, x1, { takeBackShort: { reasonCode: 'OTHER' } });
    expect(noNote.status).toBe(400);
    expect(noNote.body.code).toBe('VALIDATION_FAILED');

    const kept = await w.finishVisit(std.DR1, t1, x1, { takeBackShort: { reasonCode: 'CUSTOMER_KEPT' } });
    expect(kept.status).toBe(200);
    expect(kept.body.order).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'SCANNED' });
    const sana = await t1.stopFor(x1.id);
    const stop = await w.db.tripStop.findUniqueOrThrow({ where: { id: sana } });
    expect(stop.status).toBe('DONE');
    expect(JSON.parse(stop.notes as string)).toEqual({ takeBackShort: { reasonCode: 'CUSTOMER_KEPT', note: null, expected: 3, taken: 1 } });

    const late = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'TAKE_BACK', code: w.ag(12).qrCode, returnState: 'EMPTY' });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: 'SCAN_STOP_CLOSED', message: messageOf('SCAN_STOP_CLOSED') });
    expect(late.body.details.currentStatus).toBe('DONE');
    expect(await w.holder(12)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    expect(await w.balance()).toBe(475_000n);
    await w.walletClean();
  });

  it('FEE-027 Inc 2: the first LOAD scan ends the refund, and a scanned delivery with a short take-back moves no money', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder([
      { size: '11.8', full: 2, back: 2 },
      { size: '45.4', full: 1, back: 1 },
    ]);
    expect(await w.balance()).toBe(475_000n);
    const t = await w.assign(x1, std.DR1);

    const load = await scans.tripScan(std.DR1, t.id, { stopId: t.pickupStopId, action: 'LOAD', code: w.ag(5).qrCode, entryMethod: 'QR' });
    expect(load.status).toBe(201);
    expect(load.body.result).toBe('RECORDED');
    expect((await w.db.order.findUniqueOrThrow({ where: { id: x1.id } })).loadStartedAt).not.toBeNull();

    const order = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(order.body.cancel).toEqual({ allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' });

    await w.load(std.DR1, t, [6, 31]);
    await w.doneLoading(std.DR1, t);
    await w.hand(std.DR1, t, x1, [5, 6, 31]);
    await w.takeBack(std.DR1, t, x1, 11, 'EMPTY');
    const short = await w.finishVisit(std.DR1, t, x1);
    expect(short.status).toBe(409);
    expect(short.body.code).toBe('TAKE_BACK_SHORT');
    expect(short.body.details).toMatchObject({ expected: 3, taken: 1 });

    const done = await w.finishVisit(std.DR1, t, x1, { takeBackShort: { reasonCode: 'CUSTOMER_KEPT' } });
    expect(done.status).toBe(200);
    expect(done.body.order).toMatchObject({ status: 'DELIVERED', deliveryMethod: 'SCANNED', fee: { status: 'DEDUCTED' } });
    expect(await w.balance()).toBe(475_000n);
    const ledger = await w.db.ledgerEntry.findMany({ where: { orderId: x1.id } });
    expect(ledger.map((row) => row.entryType)).toEqual(['DEBIT_ORDER']);
    expect((await w.db.order.findUniqueOrThrow({ where: { id: x1.id } })).feeStatus).toBe('DEDUCTED');
    await w.walletClean();
  });
});
