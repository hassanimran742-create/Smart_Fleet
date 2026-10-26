/**
 * [Inc 2] Deliver at the customer (API_CONTRACT §9.2 HANDOVER, §9.3): DRV-018 to DRV-020, and DRV-008
 * (could not deliver once a cylinder was handed over).
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { registerCylinders } from '../../helpers/runs';
import { buildWorld, messageOf, X1, X2, Y1, type World } from './support/world';

jest.setTimeout(240_000);

describeDb('inc2 scan: deliver at the customer', () => {
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

  it('DRV-018 Deliver hands a loaded cylinder to the customer, keeps it Full and shows progress', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    const sana = await t1.stopFor(x1.id);

    const first = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: w.ag(1).qrCode, entryMethod: 'QR' }).expect(201);
    expect(first.body.result).toBe('RECORDED');
    expect(first.body.cylinder).toMatchObject({ holder: { type: 'CLIENT', label: 'Sana' }, state: 'FULL' });
    expect(first.body.stop.progress.give).toEqual({
      lines: [
        { cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', needed: 2, done: 1 },
        { cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg', needed: 1, done: 0 },
      ],
      doneCount: 1,
      neededCount: 3,
      complete: false,
    });

    const detail = await scans.stop(std.DR1, t1.id, sana).expect(200);
    expect(detail.body.stop).toMatchObject({ id: sana, status: 'ARRIVED', arrivedAt: expect.any(String), type: 'DELIVERY', title: 'Sana' });
    expect(detail.body.order).toMatchObject({ id: x1.id, status: 'IN_TRANSIT' });
    const rows = await w.db.stopCylinder.findMany({ where: { tripStopId: sana } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cylinderId: w.ag(1).id, orderId: x1.id, direction: 'GIVEN', returnState: null });

    let last = first;
    for (const n of [2, 31]) last = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: w.ag(n).qrCode }).expect(201);
    expect(last.body.stop.progress.give).toMatchObject({ complete: true, doneCount: 3, neededCount: 3 });
    expect(last.body.stop.progress).toMatchObject({ canFinish: true, blockers: [] });

    const events = await w.db.cylinderEvent.findMany({ where: { eventType: 'DELIVERED', orderId: x1.id } });
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event).toMatchObject({
        actorUserId: std.DR1.userId,
        fromCustodyType: 'VEHICLE',
        fromCustodyId: std.DR1.vehicleId,
        toCustodyType: 'CLIENT',
        toCustodyId: std.C1.id,
        fromState: 'FULL',
        toState: 'FULL',
        tripStopId: sana,
      });
    }
    expect(await w.balance()).toBe(475_000n);
  });

  it('DRV-019 Deliver accepts only the sizes and counts the order needs', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const x2 = await w.placeOrder(X2, 'C2');
    const y1 = await w.placeOrder(Y1, 'C2');
    expect(await w.balance()).toBe(395_000n);
    const t1 = await w.assign(x1, std.DR1);
    expect((await w.assign(x2, std.DR1)).id).toBe(t1.id);
    expect((await w.assign(y1, std.DR1)).id).toBe(t1.id);
    await w.load(std.DR1, t1, [1, 2, 3, 31, 21, 22, 23]);
    await w.doneLoading(std.DR1, t1);
    const sana = await t1.stopFor(x1.id);

    const wrongSize = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: w.ag(21).qrCode });
    expect(wrongSize.status).toBe(409);
    expect(wrongSize.body).toMatchObject({ code: 'SCAN_SIZE_NOT_IN_ORDER', message: "This is 15 kg. This order doesn't need it." });
    expect(wrongSize.body.details).toMatchObject({ sizeLabel: '15 kg', progress: { type: 'DELIVERY' } });

    for (const n of [1, 2]) await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: w.ag(n).qrCode }).expect(201);
    const third = await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: w.ag(3).qrCode });
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ code: 'SCAN_COUNT_REACHED', message: 'You already have all 2 × 11.8 kg.' });
    expect(third.body.details).toMatchObject({ needed: 2, sizeLabel: '11.8 kg', progress: { type: 'DELIVERY' } });

    const detail = await scans.stop(std.DR1, t1.id, sana).expect(200);
    expect(detail.body.progress.give.lines).toEqual([
      { cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', needed: 2, done: 2 },
      { cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg', needed: 1, done: 0 },
    ]);
    for (const n of [3, 21]) expect(await w.holder(n)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
  });

  it('DRV-020 Two hand-overs at the same moment can\'t exceed the order\'s count', async () => {
    const { std, scans } = w;
    const outcomes: string[] = [];
    for (let round = 1; round <= 20; round += 1) {
      await w.topUp(880);
      const x1 = await w.placeOrder(X1);
      const y1 = await w.placeOrder(Y1, 'C2');
      const t1 = await w.assign(x1, std.DR1);
      expect((await w.assign(y1, std.DR1)).id).toBe(t1.id);
      const fulls = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 3, actor: std.SA1 });
      const [big] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg45_4, count: 1, actor: std.SA1 });
      for (const cylinder of [...fulls, big]) {
        await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: cylinder.qrCode }).expect(201);
      }
      await w.doneLoading(std.DR1, t1);
      const sana = await t1.stopFor(x1.id);
      await scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: fulls[0].qrCode }).expect(201);

      const answers = await Promise.all([
        scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: fulls[1].qrCode }).then((r) => r),
        scans.tripScan(std.DR1, t1.id, { stopId: sana, action: 'HANDOVER', code: fulls[2].qrCode }).then((r) => r),
      ]);
      const statuses = answers.map((a) => a.status).sort();
      expect({ round, statuses }).toEqual({ round, statuses: [201, 409] });
      const refused = answers.find((a) => a.status === 409);
      expect(refused?.body.code).toBe('SCAN_COUNT_REACHED');
      outcomes.push(answers[0].status === 201 ? 'first' : 'second');
      expect(await w.db.stopCylinder.count({ where: { tripStopId: sana, direction: 'GIVEN', cylinderTypeId: std.sizes.kg11_8 } })).toBe(2);

      // The refused one is still on the van and goes to Usman.
      const left = answers[0].status === 409 ? fulls[1] : fulls[2];
      const leftNow = await w.db.cylinder.findUniqueOrThrow({ where: { id: left.id } });
      expect(leftNow).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
      const usman = await t1.stopFor(y1.id);
      await scans.tripScan(std.DR1, t1.id, { stopId: usman, action: 'HANDOVER', code: left.qrCode }).expect(201);
    }
    expect(outcomes).toHaveLength(20);
  });

  it('DRV-008 Could not deliver is refused once a cylinder has been handed over', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1]);

    const res = await scans.failOrder(std.DR1, x1.id, { reasonCode: 'CUSTOMER_REFUSED' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ORDER_HANDOVER_STARTED', message: messageOf('ORDER_HANDOVER_STARTED') });
    expect((await w.db.order.findUniqueOrThrow({ where: { id: x1.id } })).status).toBe('IN_TRANSIT');
    expect(await w.holder(1)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });
    expect(await w.balance()).toBe(475_000n);
  });
});
