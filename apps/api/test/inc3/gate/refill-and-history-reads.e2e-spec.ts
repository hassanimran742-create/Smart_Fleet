/**
 * [Inc 2/3 UI gate] What the refill and the cylinder history add for the screens:
 * - `FillingOrderDto.assignedAt` on the routes that show one refill (the shop's refill timeline "Driver
 *   assigned · 9:40 am"): the office's `refill.assign`; null before; the lists leave it out.
 * - The cylinder history (UX_ADMIN §3.5): a FILLED move names its station ("Filled at Lahore Filling
 *   Station · refill AG-R001"), every move says the state after it (`toState`), and a move an approved
 *   day-end made carries that day ("Fixed at day-end Wed 21 Oct · approved by Owner").
 * Read only; nothing here moves money.
 */
import type { INestApplication } from '@nestjs/common';
import { CylinderState } from '@prisma/client';
import { randomUUID } from 'crypto';
import { describeDb } from '../../helpers/describe-db';
import { refillCalls, type RefillCalls } from '../../helpers/inc3-calls';
import { createStation, type TestStation } from '../../helpers/refills';
import { setCylinderState } from '../../helpers/runs';
import { BOOT_TIMEOUT_MS, CASE_TIMEOUT_MS, D21, approve, createDayEndApp, freshWorld, submittedDay, type DayWorld } from '../dayend/support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('Inc 2/3 UI gate: the refill time and the history words', () => {
  let app: INestApplication;
  let w: DayWorld;
  let refills: RefillCalls;
  let station: TestStation;

  beforeAll(async () => {
    app = await createDayEndApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    w = await freshWorld(app);
    refills = refillCalls(app);
    station = await createStation();
  });

  it('REF-027 a refill carries the time the office assigned its driver, on the routes that show one refill', async () => {
    const created = await refills
      .create(w.std.DA, { fillingStationId: station.id, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 2 }, randomUUID())
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.assignedAt).toBeNull();
    expect((await refills.get(w.std.DA, id).expect(200)).body.assignedAt).toBeNull();

    const before = Date.now();
    const assigned = await refills.assign(w.std.SA1, id, w.std.DR1.id).expect(200);
    expect(assigned.body.assignedAt).toEqual(expect.any(String));
    const shop = await refills.get(w.std.DA, id).expect(200);
    expect(shop.body).toMatchObject({ status: 'ASSIGNED', assignedAt: assigned.body.assignedAt });
    expect(new Date(shop.body.assignedAt).getTime()).toBeGreaterThanOrEqual(before - 5_000);

    // Assigning the same driver again is a repeat: the time stays the first one.
    const again = await refills.assign(w.std.SA1, id, w.std.DR1.id).expect(200);
    expect(again.body.assignedAt).toBe(assigned.body.assignedAt);

    // The lists leave it out, like the picked cylinders.
    const mine = await refills.mine(w.std.DA).expect(200);
    const row = (mine.body as Array<{ id: string }>).find((refill) => refill.id === id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('assignedAt');
  });

  it('RHS-019 the history names the station of a fill, the state after each move and the day of a day-end fix', async () => {
    await setCylinderState(w.ag(1).id, CylinderState.EMPTY);
    const created = await refills
      .create(w.std.DA, { fillingStationId: station.id, cylinderTypeId: w.std.sizes.kg11_8, requestedCount: 1 }, randomUUID())
      .expect(201);
    const id = created.body.id as string;
    await refills.assign(w.std.SA1, id, w.std.DR1.id).expect(200);
    await refills.scan(w.std.DR1, id, { phase: 'PICKUP', code: w.ag(1).qrCode }).expect(201);
    await refills.advance(w.std.DR1, id, 'EMPTIES_PICKED').expect(200);
    await refills.scan(w.std.DR1, id, { phase: 'FILL', code: w.ag(1).qrCode }).expect(201);

    const filled = await w.scans.cylinderHistory(w.std.SA1, 'AG-C0001').expect(200);
    const events = filled.body.events as Array<Record<string, unknown>>;
    const registered = events.find((event) => event.action === 'REGISTERED');
    expect(registered).toMatchObject({ toState: 'FULL', station: null, dayEnd: null });
    const fill = events.find((event) => event.action === 'FILLED');
    expect(fill).toMatchObject({ refill: { shortCode: 'AG-R001' }, station: { name: station.name }, dayEnd: null });
    expect(events.find((event) => event.action === 'SCAN_OUT')).toMatchObject({ station: null, toState: 'EMPTY' });

    // A day-end fix the office approves carries its day.
    const day = await submittedDay(w, { 'AG-C0005': { where: 'In my store', state: 'Damaged', why: 'Valve leaking' } });
    await approve(w, day.id, day.version);
    const fixed = await w.scans.cylinderHistory(w.std.SA1, 'AG-C0005').expect(200);
    const adjusted = (fixed.body.events as Array<Record<string, unknown>>).find((event) => event.action === 'ADJUSTED');
    expect(adjusted).toMatchObject({ toState: 'FAULTY', dayEnd: { businessDate: D21 }, station: null });
    expect(fixed.body.cylinder.state).toBe('FAULTY');
  });
});
