/**
 * [Inc 3] The refill run on scans (API_CONTRACT §10.1, §9.2): PICKUP (store → the refill's van, SCAN_OUT
 * with the refill and no trip), FILL (FILLED, the van keeps it), "Leave store" and "Leave station", the
 * driver-only rules, repeats and resends, and the owner's cancel before the first pickup. Every refusal
 * leaves the cylinder where it was with no new event, and nothing here writes money.
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { resetDb } from '../../helpers/db';
import { refillEvents, refillLines } from '../../helpers/refills';
import { placeWithCustomer, recordMove, registerCylinders } from '../../helpers/runs';
import { buildRefillWorld, messageOf, scanId, type RefillWorld } from './support/refill-world';

jest.setTimeout(180_000);

describeDb('inc3 refills: the scan steps', () => {
  let app: INestApplication;
  let w: RefillWorld;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildRefillWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REF-014 Pickup scan moves an empty cylinder from the store onto the refill van', async () => {
    const { std, scans } = w;
    await w.empty(1);
    await w.markState(6, CylinderState.PART_FILLED);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    expect(r1.shortCode).toBe('AG-R001');
    const ledger = await w.ledgerCount();

    // Step 1.
    const S1 = scanId();
    const first = await w.pickup(std.DR1, r1, 1, S1).expect(201);
    expect(first.body).toMatchObject({
      result: 'RECORDED',
      scan: { scanId: S1, action: 'REFILL_PICKUP' },
      cylinder: { shortCode: 'AG-C0001', size: { label: '11.8 kg' }, state: 'EMPTY', holder: { type: 'VEHICLE', label: 'LEA-101' } },
      stop: null,
      refill: { status: 'ASSIGNED', picked: 1, filled: 0, received: 0, requested: 2 },
    });

    // Step 2.
    const second = await w.pickup(std.DR1, r1, 6).expect(201);
    expect(second.body.refill).toEqual({ status: 'ASSIGNED', picked: 2, filled: 0, received: 0, requested: 2 });
    expect(second.body.cylinder).toMatchObject({ shortCode: 'AG-C0006', state: 'PART_FILLED' });

    // Step 3.
    const history = await scans.cylinderHistory(std.SA1, 'AG-C0001').expect(200);
    expect(history.body.holder).toMatchObject({ type: 'VEHICLE', label: 'LEA-101', responsible: { userId: std.DR1.userId, name: 'Kashif', role: 'DRIVER' } });
    expect(history.body.events.at(-1)).toMatchObject({ action: 'SCAN_OUT', from: 'Ahmed Gas Store', to: 'LEA-101', actor: { name: 'Kashif', role: 'DRIVER' }, order: null });

    // Step 4.
    const lines = await refillLines(r1.id);
    expect(lines.map((line) => [line.cylinderId, line.status, line.stateAtPickup, line.filledAt, line.returnedAt])).toEqual([
      [w.ag(1).id, 'PICKED_UP', 'EMPTY', null, null],
      [w.ag(6).id, 'PICKED_UP', 'PART_FILLED', null, null],
    ]);
    const events = await refillEvents(r1.id);
    expect(events).toHaveLength(2);
    for (const [event, n, state] of [
      [events[0], 1, 'EMPTY'],
      [events[1], 6, 'PART_FILLED'],
    ] as const) {
      expect(event).toMatchObject({
        cylinderId: w.ag(n).id,
        eventType: 'SCAN_OUT',
        source: 'SCAN',
        fromCustodyType: 'STORE',
        fromCustodyId: std.DA.homeStoreId,
        toCustodyType: 'VEHICLE',
        toCustodyId: std.DR1.vehicleId,
        fromState: state,
        toState: state,
        actorUserId: std.DR1.userId,
        tripId: null,
        tripStopId: null,
        orderId: null,
        fillingOrderId: r1.id,
      });
      expect((await w.holder(n)).lastEventId).toBe(event.id);
    }
    const refill = await w.db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } });
    expect(refill.pickedUpAt?.getTime()).toBe(lines[0].pickedUpAt.getTime());
    // No ledger row is written.
    expect(await w.ledgerCount()).toBe(ledger);

    // Step 5.
    await w.advance(std.DR1, r1, 'EMPTIES_PICKED').expect(200);
    await w.fill(std.DR1, r1, 1).expect(201);
    const later = await scans.cylinderHistory(std.SA1, 'AG-C0001').expect(200);
    expect(later.body.holder).toMatchObject({ type: 'VEHICLE', label: 'LEA-101', responsible: { name: 'Kashif', role: 'DRIVER' } });
    expect(later.body.events.at(-1)).toMatchObject({ action: 'FILLED', from: 'LEA-101', to: 'LEA-101', actor: { name: 'Kashif' } });
    await w.walletClean();
  });

  it('REF-015 Pickup refuses full, wrong-size and not-in-store cylinders', async () => {
    const { std, db } = w;
    await w.markState(21, CylinderState.EMPTY);
    // AG-C0008 was taken back by Imran from Sana and is still on LEB-202 (not yet scanned in).
    await placeWithCustomer({ cylinder: w.ag(8), client: std.C1, actor: std.DR2 });
    await recordMove({
      cylinderId: w.ag(8).id,
      eventType: CylinderEventType.PICKED_UP_EMPTY,
      actorUserId: std.DR2.userId,
      from: { type: CustodyType.CLIENT, id: std.C1.id },
      to: { type: CustodyType.VEHICLE, id: std.DR2.vehicleId as string },
      fromState: CylinderState.FULL,
      toState: CylinderState.EMPTY,
    });
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    const eventsBefore = await db.cylinderEvent.count();
    const progress = { type: 'REFILL', status: 'ASSIGNED', requested: 2, picked: 0, filled: 0, received: 0 };

    // Step 1.
    const full = await w.pickup(std.DR1, r1, 5).expect(409);
    expect(full.body).toMatchObject({
      code: 'REFILL_CYLINDER_NOT_EMPTY',
      message: 'Only empty or part-filled cylinders go for refill.',
      details: { progress },
    });

    // Step 2.
    const size = await w.pickup(std.DR1, r1, 21).expect(409);
    expect(size.body).toMatchObject({ code: 'REFILL_CYLINDER_WRONG_SIZE', message: 'This refill is for 11.8 kg only.', details: { sizeLabel: '11.8 kg', progress } });

    // Step 3.
    const away = await w.pickup(std.DR1, r1, 8).expect(409);
    expect(away.body).toMatchObject({
      code: 'SCAN_NOT_AT_STORE',
      message: "This cylinder isn't in Ahmed Gas Store's stock. Load only from this store.",
      details: { store: 'Ahmed Gas Store', progress },
    });

    // Step 4.
    const view = await w.refills.get(std.DR1, r1.id).expect(200);
    expect(view.body).toMatchObject({ status: 'ASSIGNED', counts: { picked: 0 }, cylinders: [] });
    expect(await w.holder(5)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'FULL' });
    expect(await w.holder(21)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId, state: 'EMPTY' });
    expect(await w.holder(8)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR2.vehicleId, state: 'EMPTY' });
    expect(await db.cylinderEvent.count()).toBe(eventsBefore);
    expect(await db.fillingOrderCylinder.count()).toBe(0);
  });

  it('REF-015 The pickup checks run in their order: another open refill before the store, and damaged or lost first of all', async () => {
    const { std } = w;
    await w.empty(1, 2);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    const r2 = await w.refill({ count: 2, assignTo: std.DR2 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    // AG-C0001 is on R1's open line (and on LEA-101, not in the store): the other-refill rule answers first.
    const other = await w.pickup(std.DR2, r2, 1).expect(409);
    expect(other.body).toMatchObject({ code: 'REFILL_CYLINDER_ON_OTHER_REFILL', message: messageOf('REFILL_CYLINDER_ON_OTHER_REFILL') });
    // Damaged or lost is refused before the refill's own rules.
    await w.markState(2, CylinderState.FAULTY);
    const blocked = await w.pickup(std.DR1, r1, 2).expect(409);
    expect(blocked.body).toMatchObject({ code: 'SCAN_CYLINDER_BLOCKED', message: messageOf('SCAN_CYLINDER_BLOCKED') });
    // Another shop's cylinder: SCAN_WRONG_OWNER. A number nobody has: SCAN_CYLINDER_UNKNOWN.
    const [bilal] = await registerCylinders({ distributor: std.DB, cylinderTypeId: std.sizes.kg11_8, state: CylinderState.EMPTY });
    expect((await w.refills.scan(std.DR1, r1.id, { phase: 'PICKUP', code: bilal.qrCode }).expect(409)).body.code).toBe('SCAN_WRONG_OWNER');
    expect((await w.refills.scan(std.DR1, r1.id, { phase: 'PICKUP', code: 'NO-SUCH-QR' }).expect(404)).body.code).toBe('SCAN_CYLINDER_UNKNOWN');
    // A typed number is read within the refill's shop: "3" is AG-C0003, Bilal's own number form is unknown.
    await w.empty(3);
    const typed = await w.refills.scan(std.DR1, r1.id, { phase: 'PICKUP', code: '3', entryMethod: 'TYPED' }).expect(201);
    expect(typed.body).toMatchObject({ cylinder: { shortCode: 'AG-C0003' }, refill: { picked: 2 } });
    const typedEvent = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(3).id, eventType: 'SCAN_OUT' } });
    expect(typedEvent.source).toBe('TYPED');
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: 'custody.typed_entry' } });
    expect(audit.diff).toMatchObject({ typed: '3', shortCode: 'AG-C0003', action: 'REFILL_PICKUP', eventId: typedEvent.id, fillingOrderId: r1.id });
    // The body can never choose where a cylinder goes.
    const named = await w.refills.scan(std.DR1, r1.id, { phase: 'PICKUP', code: w.ag(4).qrCode, ...({ toCustodyType: 'STORE', toCustodyId: std.DA.homeStoreId } as unknown as Record<string, never>) }).expect(400);
    expect(named.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(named.body.details.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'toCustodyType', code: 'NOT_ALLOWED' })]));
  });

  it('REF-016 Pickups never exceed the request or double-book a cylinder, even when two arrive at once', async () => {
    const { std, db } = w;
    await w.empty(1, 2, 7, 9);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    const r2 = await w.refill({ count: 2, assignTo: std.DR2 });
    const r3 = await w.refill({ count: 2, assignTo: std.DR1 });
    expect([r1.shortCode, r2.shortCode, r3.shortCode]).toEqual(['AG-R001', 'AG-R002', 'AG-R003']);
    await w.pickup(std.DR1, r1, 1).expect(201);

    // Step 1.
    const [a, b] = await Promise.all([w.pickup(std.DR1, r1, 2), w.pickup(std.DR1, r1, 7)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const refused = a.status === 409 ? a : b;
    const refusedNo = refused === a ? 2 : 7;
    expect(refused.body).toMatchObject({
      code: 'REFILL_COUNT_REACHED',
      message: 'All picked up: 2 of 2.',
      details: { requested: 2, progress: { type: 'REFILL', picked: 2, requested: 2 } },
    });
    expect((await refillLines(r1.id)).length).toBe(2);
    expect(await w.holder(refusedNo)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    expect((await w.events(refusedNo)).map((event) => event.eventType)).toEqual(['REGISTERED']);

    // Step 2.
    const more = await w.pickup(std.DR1, r1, 9).expect(409);
    expect(more.body).toMatchObject({ code: 'REFILL_COUNT_REACHED', details: { requested: 2 } });

    // Step 3.
    const [c, d] = await Promise.all([w.pickup(std.DR2, r2, 9), w.pickup(std.DR1, r3, 9)]);
    expect([c.status, d.status].sort()).toEqual([201, 409]);
    const loser = c.status === 409 ? c : d;
    expect(loser.body).toMatchObject({ code: 'REFILL_CYLINDER_ON_OTHER_REFILL', message: 'This cylinder is already on another refill.' });
    const winnerVan = c.status === 201 ? std.DR2.vehicleId : std.DR1.vehicleId;

    // Step 4.
    const lines = await db.fillingOrderCylinder.findMany({ where: { cylinderId: w.ag(9).id, fillingOrderId: { in: [r2.id, r3.id] } } });
    expect(lines.map((line) => line.status)).toEqual(['PICKED_UP']);
    expect((await w.events(9)).filter((event) => event.eventType === 'SCAN_OUT')).toHaveLength(1);
    expect(await w.holder(9)).toMatchObject({ custodyType: 'VEHICLE', custodyId: winnerVan });
    expect((await refillLines(r1.id)).length).toBe(2);
  });

  it('REF-017 Scans, "Leave store" and "Leave station" follow the refill steps', async () => {
    const { std } = w;
    await w.empty(1, 2, 7);
    const r = await w.refill({ count: 3, assignTo: std.DR1 });

    // Step 1.
    const early = await w.advance(std.DR1, r, 'EMPTIES_PICKED').expect(409);
    expect(early.body).toMatchObject({ code: 'REFILL_WRONG_STEP', message: "This refill isn't at that step.", details: { currentStatus: 'ASSIGNED' } });
    expect((await w.db.fillingOrder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('ASSIGNED');

    // Step 2.
    const fillFirst = await w.fill(std.DR1, r, 1).expect(409);
    expect(fillFirst.body).toMatchObject({ code: 'REFILL_WRONG_STEP', message: "This refill isn't at that step.", details: { currentStatus: 'ASSIGNED' } });

    // Step 3.
    await w.pickup(std.DR1, r, 1).expect(201);
    const two = await w.pickup(std.DR1, r, 2).expect(201);
    expect(two.body.refill).toMatchObject({ status: 'ASSIGNED', picked: 2 });
    const assigned = await w.refills.get(std.DR1, r.id).expect(200);
    expect(assigned.body).toMatchObject({ stage: 'PICKING_UP', allowedActions: ['PICKUP', 'LEAVE_STORE'] });
    const leave = await w.advance(std.DR1, r, 'EMPTIES_PICKED').expect(200);
    expect(leave.headers['x-already-applied']).toBeUndefined();
    expect(leave.body).toMatchObject({ status: 'EMPTIES_PICKED', stage: 'PICKED_UP', counts: { requested: 3, picked: 2, filled: 0, received: 0 }, allowedActions: ['FILL'] });
    const repeat = await w.advance(std.DR1, r, 'EMPTIES_PICKED').expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body.status).toBe('EMPTIES_PICKED');

    // Step 4.
    const late = await w.pickup(std.DR1, r, 7).expect(409);
    expect(late.body).toMatchObject({ code: 'REFILL_WRONG_STEP', details: { currentStatus: 'EMPTIES_PICKED' } });
    expect(await w.holder(7)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });

    // Step 5.
    const noFill = await w.advance(std.DR1, r, 'FILLED').expect(409);
    expect(noFill.body).toMatchObject({ code: 'REFILL_WRONG_STEP', details: { currentStatus: 'EMPTIES_PICKED' } });
    expect((await w.db.fillingOrder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('EMPTIES_PICKED');

    // Step 6.
    const filled = await w.fill(std.DR1, r, 1).expect(201);
    expect(filled.body.refill).toMatchObject({ status: 'AT_STATION', filled: 1, picked: 2 });
    const atStation = await w.refills.get(std.DR1, r.id).expect(200);
    expect(atStation.body).toMatchObject({ stage: 'AT_STATION', allowedActions: ['FILL', 'LEAVE_STATION'] });
    const away = await w.advance(std.DR1, r, 'FILLED').expect(200);
    expect(away.body).toMatchObject({ status: 'FILLED', stage: 'COMING_BACK', counts: { picked: 2, filled: 1, received: 0 }, allowedActions: [] });
    const after = await w.fill(std.DR1, r, 2).expect(409);
    expect(after.body).toMatchObject({ code: 'REFILL_WRONG_STEP', details: { currentStatus: 'FILLED' } });
    expect((await w.refills.get(std.DR1, r.id).expect(200)).body.counts.filled).toBe(1);
    // Going back a step is refused too.
    expect((await w.advance(std.DR1, r, 'EMPTIES_PICKED').expect(409)).body.details.currentStatus).toBe('FILLED');
  });

  it('REF-018 Only the assigned driver scans a refill, and only its own shop receives it', async () => {
    const { std, scans } = w;
    await w.empty(1, 2);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    const before = { one: await w.events(1), two: await w.events(2) };

    // Step 1.
    const notTheirs = await w.pickup(std.DR2, r1, 2).expect(404);
    expect(notTheirs.body).toMatchObject({ code: 'NOT_FOUND', message: "We couldn't find this. It may have been removed." });
    expect(notTheirs.body.details?.progress).toBeUndefined();
    expect((await w.advance(std.DR2, r1, 'EMPTIES_PICKED').expect(404)).body.code).toBe('NOT_FOUND');

    // Step 2.
    expect((await w.pickup(std.SA1, r1, 2).expect(403)).body).toMatchObject({ code: 'PERMISSION_DENIED', message: "Your account can't do this." });

    // Step 3.
    expect((await w.pickup(std.DA, r1, 2).expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect((await w.advance(std.DA, r1, 'EMPTIES_PICKED').expect(403)).body.code).toBe('PERMISSION_DENIED');

    // Step 4.
    const bilal = await scans.storeScan(std.DB, { code: w.ag(1).qrCode }).expect(409);
    expect(bilal.body).toMatchObject({ code: 'SCAN_WRONG_OWNER', message: 'This cylinder belongs to another shop.' });

    // Step 5.
    const view = await w.refills.get(std.DA, r1.id).expect(200);
    expect(view.body).toMatchObject({ status: 'ASSIGNED', counts: { picked: 1 } });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
    expect(await w.events(1)).toEqual(before.one);
    expect(await w.events(2)).toEqual(before.two);
  });

  it('REF-019 Fill scan keeps the cylinder on the van and works only for picked cylinders', async () => {
    const { std, scans } = w;
    await w.empty(1, 2, 7);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r1, 1).expect(201);
    await w.pickup(std.DR1, r1, 2).expect(201);
    await w.advance(std.DR1, r1, 'EMPTIES_PICKED').expect(200);

    // Step 1.
    const F1 = scanId();
    const one = await w.fill(std.DR1, r1, 1, F1).expect(201);
    expect(one.body).toMatchObject({
      result: 'RECORDED',
      scan: { scanId: F1, action: 'REFILL_FILL' },
      cylinder: { shortCode: 'AG-C0001', state: 'EMPTY', holder: { type: 'VEHICLE', label: 'LEA-101' } },
      stop: null,
      refill: { status: 'AT_STATION', filled: 1, picked: 2, received: 0, requested: 2 },
    });
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId, state: 'EMPTY' });
    const fillEvent = await w.db.cylinderEvent.findFirstOrThrow({ where: { cylinderId: w.ag(1).id, eventType: 'FILLED' } });
    expect(fillEvent).toMatchObject({
      fromCustodyType: 'VEHICLE',
      fromCustodyId: std.DR1.vehicleId,
      toCustodyType: 'VEHICLE',
      toCustodyId: std.DR1.vehicleId,
      fromState: 'EMPTY',
      toState: 'EMPTY',
      fillingOrderId: r1.id,
      tripId: null,
      actorUserId: std.DR1.userId,
      clientScanId: F1,
    });
    const line = (await refillLines(r1.id)).find((l) => l.cylinderId === w.ag(1).id);
    expect(line).toMatchObject({ status: 'FILLED', returnedAt: null });
    expect(line?.filledAt?.getTime()).toBe(fillEvent.createdAt.getTime());

    // Step 2.
    const notPicked = await w.fill(std.DR1, r1, 7).expect(409);
    expect(notPicked.body).toMatchObject({
      code: 'REFILL_CYLINDER_NOT_ON_THIS_REFILL',
      message: "This cylinder wasn't picked up for this refill.",
      details: { progress: { type: 'REFILL', status: 'AT_STATION', filled: 1, picked: 2 } },
    });
    expect(await w.holder(7)).toMatchObject({ custodyType: 'STORE', state: 'EMPTY' });
    expect((await w.events(7)).map((event) => event.eventType)).toEqual(['REGISTERED']);

    // Step 3.
    const two = await w.fill(std.DR1, r1, 2, scanId()).expect(201);
    expect(two.body.refill).toMatchObject({ status: 'AT_STATION', filled: 2 });

    // Step 4.
    const again = await w.fill(std.DR1, r1, 1, scanId()).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    expect(again.body).toMatchObject({ result: 'ALREADY_RECORDED', scan: { scanId: F1, action: 'REFILL_FILL' }, refill: { filled: 2, picked: 2 } });
    expect(await w.db.cylinderEvent.count({ where: { cylinderId: w.ag(1).id, eventType: 'FILLED' } })).toBe(1);

    // Step 5.
    const history = await scans.cylinderHistory(std.SA1, 'AG-C0001').expect(200);
    const moves = (history.body.events as Array<{ action: string; to: string }>).slice(1);
    expect(moves.map((event) => [event.action, event.to])).toEqual([
      ['SCAN_OUT', 'LEA-101'],
      ['FILLED', 'LEA-101'],
    ]);
    expect(history.body.holder).toMatchObject({ type: 'VEHICLE', label: 'LEA-101' });
    expect(await w.db.cylinderEvent.count({ where: { cylinderId: w.ag(1).id, toCustodyType: { notIn: ['VEHICLE', 'STORE'] } } })).toBe(0);
  });

  it('REF-021 A repeated scan is recorded once, and a reused scan ID is refused (the driver scans)', async () => {
    const { std } = w;
    await w.empty(1, 2);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    const S1 = scanId();

    // Step 1.
    await w.pickup(std.DR1, r1, 1, S1).expect(201);

    // Step 2.
    const resend = await w.pickup(std.DR1, r1, 1, S1).expect(200);
    expect(resend.headers['idempotent-replay']).toBe('true');
    expect(resend.body).toMatchObject({ result: 'ALREADY_RECORDED', scan: { scanId: S1, action: 'REFILL_PICKUP' }, refill: { picked: 1 } });
    expect((await w.events(1)).filter((event) => event.eventType === 'SCAN_OUT')).toHaveLength(1);
    // The same move under a new scan id: X-Already-Applied, nothing written, the counts unchanged.
    const sameMove = await w.pickup(std.DR1, r1, 1, scanId()).expect(200);
    expect(sameMove.headers['x-already-applied']).toBe('true');
    expect(sameMove.body).toMatchObject({ result: 'ALREADY_RECORDED', scan: { scanId: S1 }, refill: { picked: 1 } });

    // Step 3.
    const reused = await w.pickup(std.DR1, r1, 2, S1).expect(409);
    expect(reused.body).toMatchObject({ code: 'SCAN_ID_REUSED', message: 'This scan was already used for something else. Scan again.', details: { progress: { picked: 1 } } });
    expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    // The same scan id for the other phase is refused too.
    expect((await w.fill(std.DR1, r1, 1, S1).expect(409)).body.code).toBe('SCAN_ID_REUSED');

    // Step 4.
    await w.pickup(std.DR1, r1, 2, scanId()).expect(201);
    await w.advance(std.DR1, r1, 'EMPTIES_PICKED').expect(200);
    // A resend of a pickup after "Leave store" still answers the recorded scan (§9.2 step 2 comes before the step check).
    const lateResend = await w.pickup(std.DR1, r1, 1, S1).expect(200);
    expect(lateResend.headers['idempotent-replay']).toBe('true');
    const F = scanId();
    await w.fill(std.DR1, r1, 1, F).expect(201);
    await w.fill(std.DR1, r1, 2).expect(201);
    expect((await w.fill(std.DR1, r1, 1, F).expect(200)).headers['idempotent-replay']).toBe('true');
    const left = await w.advance(std.DR1, r1, 'FILLED').expect(200);
    expect(left.body).toMatchObject({ status: 'FILLED', counts: { picked: 2, filled: 2, received: 0 } });
    expect(await w.db.cylinderEvent.count({ where: { fillingOrderId: r1.id } })).toBe(4);
  });

  it('REF-023 The owner can cancel only before the first pickup, and a cancel never wins against a pickup', async () => {
    const { std, db } = w;
    await w.empty(1, 2);
    const r1 = await w.refill({ count: 2, assignTo: std.DR1 });
    const r2 = await w.refill({ count: 2, assignTo: std.DR1 });
    const r3 = await w.refill({ count: 2, assignTo: std.DR1 });
    await w.pickup(std.DR1, r2, 1).expect(201);
    const ledger = await w.ledgerCount();

    // Step 1.
    const one = await w.refills.cancel(std.DA, r1.id, 'Not needed today').expect(200);
    expect(one.body).toMatchObject({ status: 'CANCELLED', stage: 'CANCELLED', cancellationReason: 'Not needed today', allowedActions: [] });
    expect(one.body.cancelledAt).toEqual(expect.any(String));
    const row = await db.fillingOrder.findUniqueOrThrow({ where: { id: r1.id } });
    expect([row.status, row.cancelledByUserId, row.cancelledAt instanceof Date]).toEqual(['CANCELLED', std.DA.userId, true]);
    const audits = await db.auditLog.findMany({ where: { action: 'refill.cancel', resourceId: r1.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.DA.userId, reason: 'Not needed today' });
    // A repeat answers as the first cancel did.
    expect((await w.refills.cancel(std.DA, r1.id, 'Not needed today').expect(200)).headers['x-already-applied']).toBe('true');

    // Step 2.
    const picked = await w.refills.cancel(std.DA, r2.id, 'Changed my mind').expect(409);
    expect(picked.body).toMatchObject({ code: 'REFILL_NOT_CANCELLABLE', message: "This refill can't be cancelled after pickup." });
    expect((await db.fillingOrder.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('ASSIGNED');
    expect(await w.holder(1)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
    // The shop's view says so: no Cancel once a cylinder is picked up.
    expect((await w.refills.get(std.DA, r2.id).expect(200)).body.allowedActions).toEqual([]);

    // Step 3.
    const [cancel, pickup] = await Promise.all([w.refills.cancel(std.DA, r3.id, 'Race with the driver'), w.pickup(std.DR1, r3, 2)]);
    const r3Row = await db.fillingOrder.findUniqueOrThrow({ where: { id: r3.id } });
    if (cancel.status === 200) {
      expect(pickup.status).toBe(409);
      expect(pickup.body).toMatchObject({ code: 'REFILL_WRONG_STEP', details: { currentStatus: 'CANCELLED' } });
      expect(r3Row.status).toBe('CANCELLED');
      expect(await w.holder(2)).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    } else {
      expect([cancel.status, cancel.body.code, pickup.status]).toEqual([409, 'REFILL_NOT_CANCELLABLE', 201]);
      expect(r3Row.status).toBe('ASSIGNED');
      expect(await w.holder(2)).toMatchObject({ custodyType: 'VEHICLE', custodyId: std.DR1.vehicleId });
    }
    // A cancelled refill never has a cylinder on the van.
    const cancelled = await db.fillingOrder.findMany({ where: { status: 'CANCELLED' }, select: { id: true } });
    expect(await db.fillingOrderCylinder.count({ where: { fillingOrderId: { in: cancelled.map((c) => c.id) } } })).toBe(0);

    // Step 4.
    expect((await w.refills.cancel(std.SA1, r2.id, 'Office').expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect(await w.ledgerCount()).toBe(ledger);
  });
});
