/**
 * [Inc 2] Cylinder history and the responsible driver (API_CONTRACT §9.2, §9.4, G06-02), registration
 * (§9.5) and the reserved custody settings (§6): HLD-013 to HLD-017.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, type PlacedOrder, type Trip, type World } from './support/world';

jest.setTimeout(180_000);

describeDb('inc2 scan: cylinder history, registration and custody settings', () => {
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

  /** DR1 delivers X1 (AG-C0001, AG-C0002, AG-C0031) and finishes the run. */
  async function dr1Delivers(): Promise<{ x1: PlacedOrder; t1: Trip }> {
    const { std, scans } = w;
    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    return { x1, t1 };
  }

  /** A later order for Sana on DR2's run, where DR2 takes AG-C0001 back as Empty. */
  async function dr2TakesBack(): Promise<{ later: PlacedOrder; t2: Trip }> {
    const later = await w.placeOrder([{ size: '11.8', full: 1, back: 1 }]);
    const t2 = await w.assign(later, w.std.DR2);
    await w.load(w.std.DR2, t2, [4]);
    await w.doneLoading(w.std.DR2, t2);
    await w.takeBack(w.std.DR2, t2, later, 1, 'EMPTY');
    return { later, t2 };
  }

  it('HLD-013 The responsible driver is the last one who scanned the cylinder onto a van', async () => {
    const { std, scans } = w;
    const history = async () => (await scans.cylinderHistory(std.DA, 'AG-C0001').expect(200)).body;

    const x1 = await w.placeOrder(X1);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1]);
    expect((await history()).holder).toMatchObject({ type: 'VEHICLE', label: 'LEA-101', responsible: { name: 'Kashif', role: 'DRIVER', userId: std.DR1.userId } });

    await w.load(std.DR1, t1, [2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    expect((await history()).holder).toMatchObject({ type: 'CLIENT', label: 'Sana', responsible: { name: 'Kashif', role: 'DRIVER' } });

    await dr2TakesBack();
    const taken = await history();
    expect(taken.holder).toMatchObject({ type: 'VEHICLE', label: 'LEB-202', responsible: { name: 'Imran', role: 'DRIVER' } });
    const takeBack = taken.events.find((e: { action: string }) => e.action === 'PICKED_UP_EMPTY');
    expect(takeBack.actor).toEqual({ name: 'Imran', role: 'DRIVER' });
    for (const event of taken.events) expect(event.actor).toMatchObject({ name: expect.any(String), role: expect.any(String) });

    expect((await w.receive(1)).status).toBe(201);
    expect((await history()).holder).toEqual({ type: 'STORE', label: 'Ahmed Gas Store', since: expect.any(String), responsible: null });
  });

  it('HLD-014 Holder history lists every move in order with who, where, order, source and state', async () => {
    const { std, scans } = w;
    const { x1 } = await dr1Delivers();
    const { later } = await dr2TakesBack();
    await scans.storeScan(std.DA, { code: '0001', entryMethod: 'TYPED' }).expect(201);

    const res = await scans.cylinderHistory(std.DA, 'AG-C0001').expect(200);
    expect(res.body.cylinder).toMatchObject({ shortCode: 'AG-C0001', shortNo: 1, size: { label: '11.8 kg' }, state: 'EMPTY' });
    expect(res.body.holder).toMatchObject({ type: 'STORE', label: 'Ahmed Gas Store' });
    const moves = res.body.events.map((e: Record<string, unknown>) => ({
      action: e.action,
      actor: (e.actor as { name: string }).name,
      role: (e.actor as { role: string }).role,
      from: e.from,
      to: e.to,
      order: (e.order as { shortCode: string } | null)?.shortCode ?? null,
      source: e.source,
      returnState: e.returnState,
      refill: e.refill,
    }));
    expect(moves).toEqual([
      { action: 'REGISTERED', actor: 'Owner', role: 'SUPER_ADMIN', from: null, to: 'Ahmed Gas Store', order: null, source: 'REGISTRATION', returnState: null, refill: null },
      { action: 'SCAN_OUT', actor: 'Kashif', role: 'DRIVER', from: 'Ahmed Gas Store', to: 'LEA-101', order: null, source: 'SCAN', returnState: null, refill: null },
      { action: 'DELIVERED', actor: 'Kashif', role: 'DRIVER', from: 'LEA-101', to: 'Sana', order: x1.shortCode, source: 'SCAN', returnState: null, refill: null },
      { action: 'PICKED_UP_EMPTY', actor: 'Imran', role: 'DRIVER', from: 'Sana', to: 'LEB-202', order: later.shortCode, source: 'SCAN', returnState: 'EMPTY', refill: null },
      { action: 'SCAN_IN', actor: 'Ahmed Gas', role: 'DISTRIBUTOR', from: 'LEB-202', to: 'Ahmed Gas Store', order: null, source: 'TYPED', returnState: null, refill: null },
    ]);
    const text = JSON.stringify(res.body);
    for (const secret of ['passwordHash', 'cnic', 'tokenHash', 'codeHash']) expect(text).not.toContain(secret);
  });

  it('HLD-015 Another distributor can\'t read a cylinder\'s history', async () => {
    const { std, scans } = w;
    await w.bg(1);
    const strip = (body: Record<string, unknown>) => ({ statusCode: body.statusCode, code: body.code, message: body.message, details: body.details });
    const theirs = await scans.cylinderHistory(std.DB, 'AG-C0001');
    const nobody = await scans.cylinderHistory(std.DB, 'AG-C0999');
    expect(theirs.status).toBe(404);
    expect(strip(theirs.body)).toEqual(strip(nobody.body));
    expect(theirs.body.code).toBe('NOT_FOUND');
    const byId = await w.as(std.DB).get(`/custody/cylinders/${w.ag(1).id}/history`);
    expect(byId.status).toBe(404);
    expect(byId.body.code).toBe('NOT_FOUND');

    const own = await scans.cylinderHistory(std.DB, 'BG-C0001').expect(200);
    expect(own.body.cylinder.shortCode).toBe('BG-C0001');
    await scans.cylinderHistory(std.SA2, 'AG-C0001').expect(200);
    await scans.cylinderHistory(std.DA, 'AG-C0001').expect(200);
    // The office needs the full number or the QR value; a bare number names no shop.
    await scans.cylinderHistory(std.SA2, w.ag(1).qrCode).expect(200);
    expect((await scans.cylinderHistory(std.SA2, '0001')).status).toBe(404);

    for (const res of [await scans.cylinderHistory(std.DR1, 'AG-C0001'), await w.as(std.DR1).get(`/custody/cylinders/${w.ag(1).id}/history`)]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    }
  });

  it('HLD-016 Registering new cylinders gives them the store as their first holder and the next short numbers', async () => {
    const { std, scans } = w;
    const body = { distributorId: std.DA.id, cylinderTypeId: std.sizes.kg11_8, quantity: 2, state: 'FULL' as const };
    const res = await scans.bulkRegister(std.SA1, body).expect(201);
    expect(res.body).toEqual([
      { id: expect.any(String), code: expect.any(String), shortNo: 36, shortCode: 'AG-C0036', sizeLabel: '11.8 kg' },
      { id: expect.any(String), code: expect.any(String), shortNo: 37, shortCode: 'AG-C0037', sizeLabel: '11.8 kg' },
    ]);
    for (const row of res.body as Array<{ id: string }>) {
      const events = await w.db.cylinderEvent.findMany({ where: { cylinderId: row.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ eventType: 'REGISTERED', source: 'REGISTRATION', toCustodyType: 'STORE', toCustodyId: std.DA.homeStoreId, actorUserId: std.SA1.id });
      expect((await w.db.cylinder.findUniqueOrThrow({ where: { id: row.id } })).lastEventId).toBe(events[0].id);
    }

    expect((await scans.bulkRegister(std.DA, body)).status).toBe(403);
    const van = await scans.bulkRegister(std.SA1, { ...body, initialCustodyType: 'VEHICLE' } as never);
    expect(van.status).toBe(400);
    expect(van.body.details.fields).toEqual([expect.objectContaining({ path: 'initialCustodyType', code: 'NOT_ALLOWED' })]);
    const otherStore = await scans.bulkRegister(std.SA1, { ...body, initialCustodyId: std.DB.homeStoreId } as never);
    expect(otherStore.status).toBe(400);
    expect(otherStore.body.details.fields).toEqual([expect.objectContaining({ path: 'initialCustodyId', code: 'NOT_ALLOWED' })]);
    expect(await w.db.cylinder.count({ where: { distributorId: std.DA.id } })).toBe(37);

    const stock = await scans.storeStock(std.DA).expect(200);
    expect(stock.body.sizes.find((s: { sizeLabel: string }) => s.sizeLabel === '11.8 kg').byState.FULL).toBe(22);
    const audits = await w.db.auditLog.findMany({ where: { action: 'cylinders.bulk_register' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(std.SA1.id);
  });

  it('HLD-017 Reserved custody settings can\'t be changed over the API', async () => {
    const { std } = w;
    const before = await w.db.auditLog.count({ where: { action: 'setting.update' } });
    for (const [key, value] of [
      ['custody.forgottenInPolicy', 'BLOCK_OUT_MANUAL_DELIVERY'],
      ['walkIn.counterSwap.enabled', true],
    ] as const) {
      const res = await w.as(std.SA1).patch(`/settings/${key}`).send({ value, reason: 'Try to edit' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'SETTING_NOT_EDITABLE', message: "This setting can't be changed here." });
    }
    const settings = await w.as(std.SA1).get('/settings').expect(200);
    const rows = Object.fromEntries((settings.body as Array<{ key: string; value: unknown }>).map((row) => [row.key, row.value]));
    expect(rows['custody.forgottenInPolicy']).toBe('BLOCK_OUT_MANUAL_DELIVERY');
    expect(rows['walkIn.counterSwap.enabled']).toBe(false);
    expect(await w.db.auditLog.count({ where: { action: 'setting.update' } })).toBe(before);
  });
});
