/**
 * [Inc 2] Typed cylinder numbers (API_CONTRACT §1.1, §9.2 steps 4-5; G05-08) and repeated scans (§9.2
 * steps 2 and 8): DRV-032, DRV-033, DRV-037 and HLD-008.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { buildWorld, messageOf, X1, type World } from './support/world';

jest.setTimeout(180_000);

describeDb('inc2 scan: typed numbers and repeated scans', () => {
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

  it('DRV-032 A typed cylinder number resolves only within the distributor and is audited', async () => {
    const { std, scans } = w;
    const bg1 = await w.bg(1);
    expect(bg1.shortNo).toBe(1);
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const typed = (code: string) => scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code, entryMethod: 'TYPED' });

    const first = await typed('0001');
    expect(first.status).toBe(201);
    expect(first.body.cylinder.shortCode).toBe('AG-C0001');
    const event = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: 'SCAN_OUT' } });
    expect(event.source).toBe('TYPED');

    for (const code of ['1', 'C0001', 'c0001', 'AG-C0001']) {
      const res = await typed(code);
      expect({ code, status: res.status, result: res.body.result, repeat: res.headers['x-already-applied'] }).toEqual({
        code,
        status: 200,
        result: 'ALREADY_RECORDED',
        repeat: 'true',
      });
      expect(res.body.cylinder.shortCode).toBe('AG-C0001');
    }

    for (const code of ['AG-0001', 'BG-C0001', '0099']) {
      const res = await typed(code);
      expect({ code, status: res.status, error: res.body.code }).toEqual({ code, status: 404, error: 'SCAN_CYLINDER_UNKNOWN' });
      expect(res.body.message).toBe(messageOf('SCAN_CYLINDER_UNKNOWN'));
    }

    const back = await scans.storeScan(std.DA, { code: '0001', entryMethod: 'TYPED' });
    expect(back.status).toBe(201);
    expect(await w.holder(1)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    const receive = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: 'SCAN_IN' } });
    expect(receive.source).toBe('TYPED');

    const audits = await w.db.auditLog.findMany({ where: { action: 'custody.typed_entry' }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => [a.actorUserId, a.resourceId, a.distributorId])).toEqual([
      [std.DR1.userId, w.ag(1).id, std.DA.id],
      [std.DA.userId, w.ag(1).id, std.DA.id],
    ]);
    expect(await w.db.cylinderEvent.count({ where: { cylinderId: bg1.id } })).toBe(1);
  });

  it('DRV-033 Typed entry can be switched off and on by the office', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);

    await w.as(std.SA1).patch('/settings/custody.typedEntry.enabled').send({ value: false, reason: 'Test typed entry off' }).expect(200);
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: 'setting.update' }, orderBy: { createdAt: 'desc' } });
    expect(audit.reason).toBe('Test typed entry off');
    expect(audit.diff).toMatchObject({ key: 'custody.typedEntry.enabled', from: true, to: false });
    const config = await http(app).get('/api/v1/app/config').expect(200);
    expect(config.body.features.typedCylinderNumber).toBe(false);

    const off = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: '0002', entryMethod: 'TYPED' });
    expect(off.status).toBe(403);
    expect(off.body).toMatchObject({ code: 'FEATURE_DISABLED', message: messageOf('FEATURE_DISABLED') });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE' });
    await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(2).qrCode, entryMethod: 'QR' }).expect(201);

    await w.as(std.SA1).patch('/settings/custody.typedEntry.enabled').send({ value: true, reason: 'Typed entry back on' }).expect(200);
    const on = await scans.tripScan(std.DR1, t1.id, { stopId: t1.pickupStopId, action: 'LOAD', code: '0031', entryMethod: 'TYPED' });
    expect(on.status).toBe(201);
    expect((await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(31).id, eventType: 'SCAN_OUT' } })).source).toBe('TYPED');
    expect(await w.db.auditLog.count({ where: { action: 'custody.typed_entry', resourceId: w.ag(31).id } })).toBe(1);
    const again = await http(app).get('/api/v1/app/config').expect(200);
    expect(again.body.features.typedCylinderNumber).toBe(true);
  });

  it('DRV-037 Resending a scan with the same scanId records it once; reusing a scanId for another cylinder is refused', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    const s1 = randomUUID();
    const first = await scans.tripScan(std.DR1, t1.id, { scanId: s1, stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    expect(first.body.result).toBe('RECORDED');

    const resend = await scans.tripScan(std.DR1, t1.id, { scanId: s1, stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode });
    expect(resend.status).toBe(200);
    expect(resend.headers['idempotent-replay']).toBe('true');
    expect(resend.body.result).toBe('ALREADY_RECORDED');
    expect(resend.body.scan).toEqual(first.body.scan);

    const reused = await scans.tripScan(std.DR1, t1.id, { scanId: s1, stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(2).qrCode });
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: 'SCAN_ID_REUSED', message: 'This scan was already used for something else. Scan again.' });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE' });

    expect(await w.eventCount(1, 'SCAN_OUT')).toBe(1);
    const trip = await scans.trip(std.DR1, t1.id).expect(200);
    const pickup = trip.body.stops.find((s: { id: string }) => s.id === t1.pickupStopId);
    expect(pickup.progress).toMatchObject({ doneCount: 1, neededCount: 3 });
  });

  it('HLD-008 Scanning the same cylinder twice (new scan id) records it once', async () => {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await scans.tripScan(std.DR1, t1.id, { scanId: randomUUID(), stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode }).expect(201);
    const s2 = await scans.tripScan(std.DR1, t1.id, { scanId: randomUUID(), stopId: t1.pickupStopId, action: 'LOAD', code: w.ag(1).qrCode });
    expect(s2.status).toBe(200);
    expect(s2.headers['x-already-applied']).toBe('true');
    expect(s2.body.result).toBe('ALREADY_RECORDED');
    expect(s2.body.stop.progress).toMatchObject({ doneCount: 1, neededCount: 3 });

    await w.load(std.DR1, t1, [2, 31]);
    await w.doneLoading(std.DR1, t1);
    const sana = await t1.stopFor(x1.id);
    await scans.tripScan(std.DR1, t1.id, { scanId: randomUUID(), stopId: sana, action: 'HANDOVER', code: w.ag(1).qrCode }).expect(201);
    const s4 = await scans.tripScan(std.DR1, t1.id, { scanId: randomUUID(), stopId: sana, action: 'HANDOVER', code: w.ag(1).qrCode });
    expect(s4.status).toBe(200);
    expect(s4.headers['x-already-applied']).toBe('true');
    expect(s4.body.result).toBe('ALREADY_RECORDED');
    expect(s4.body.stop.progress.give).toMatchObject({ doneCount: 1, neededCount: 3 });

    expect(await w.eventCount(1, 'SCAN_OUT')).toBe(1);
    expect(await w.eventCount(1, 'DELIVERED')).toBe(1);
    expect(await w.db.stopCylinder.count({ where: { tripStopId: sana, cylinderId: w.ag(1).id, direction: 'GIVEN' } })).toBe(1);
  });
});
