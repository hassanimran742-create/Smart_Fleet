/**
 * The Increment 2 test helpers (test/helpers/runs.ts, customer-links.ts) write rows exactly as the
 * Increment 2 services do, and the cross-lane stubs are registered: every lane's tests build on both.
 */
import type { INestApplication } from '@nestjs/common';
import { CustodyType, CylinderEventSource, CylinderEventType, CylinderState, OrderStatus, TripStatus, TripStopStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import {
  addDeliveryStop,
  confirmationToken,
  createClient,
  createConfirmation,
  createOrder,
  createStandardData,
  createTrip,
  customerLinkPath,
  cylinderHolder,
  describeDb,
  getTestPrisma,
  handOver,
  loadVan,
  placeOnVanFromEarlierRun,
  placeWithCustomer,
  registerCylinders,
  setCylinderState,
  setStopStatus,
  stopCylinders,
  takeBack,
  tokenFromUrl,
  walletMismatches,
  type StandardData,
} from '../../helpers';
import {
  CONFIRM_TOKEN_LENGTH,
  confirmationTokenHash,
  ConfirmationService,
  NoopConfirmationService,
  normalizeConfirmationToken,
} from '../../../src/modules/confirmation/confirmation.interface';
import { MESSAGING_PROVIDER, MessagingService, NoopMessagingService, type MessagingProvider } from '../../../src/modules/messaging/messaging.interface';
import { resetDb } from '../../helpers/db';

describeDb('Increment 2 test helpers', () => {
  const db = () => getTestPrisma();
  let std: StandardData;

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
  });

  it('createOrder numbers orders from the counter, and pays a cost like WalletService.debit', async () => {
    const free = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 1 }] });
    const paid = await createOrder({ distributor: std.DA, client: std.C2, lines: [{ cylinderTypeId: std.sizes.kg15, fullCount: 1 }], feePaisa: 40_000n });
    expect([free.orderNo, free.shortCode, paid.orderNo, paid.shortCode]).toEqual([1, 'AG-0001', 2, 'AG-0002']);
    const rows = await db().order.findMany({ where: { id: { in: [free.id, paid.id] } }, orderBy: { orderNo: 'asc' }, include: { lines: true } });
    expect(rows.map((o) => [o.status, o.feeStatus, o.deliveryFeePaisa, o.paymentStatus])).toEqual([
      ['PENDING', 'NONE', 0n, 'UNPAID'],
      ['PENDING', 'DEDUCTED', 40_000n, 'PAID_VIA_LEDGER'],
    ]);
    expect(rows[0].lines.map((l) => [l.fullCount, l.expectedReturnCount])).toEqual([[2, 1]]);
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa).toBe(460_000n);
    const debit = await db().ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: `order:${paid.id}:debit` } });
    expect(debit).toMatchObject({ entryType: 'DEBIT_ORDER', amountPaisa: -40_000n, balanceAfterPaisa: 460_000n, orderId: paid.id });
    expect(await walletMismatches()).toEqual([]);
  });

  it('createTrip makes the store pickup (seq 0) and one delivery stop per order, and assigns the orders', async () => {
    const o1 = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }] });
    const o2 = await createOrder({ distributor: std.DA, client: std.C2, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }] });
    const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [o1] });
    await addDeliveryStop({ trip, order: o2 });
    const stops = await db().tripStop.findMany({ where: { tripId: trip.id }, orderBy: { seq: 'asc' } });
    expect(stops.map((s) => [s.seq, s.stopType, s.orderId, s.storeId, s.status])).toEqual([
      [0, 'STORE_PICKUP', null, std.DA.homeStoreId, 'PENDING'],
      [1, 'DELIVERY', o1.id, null, 'PENDING'],
      [2, 'DELIVERY', o2.id, null, 'PENDING'],
    ]);
    expect(trip.pickupStopId).toBe(stops[0].id);
    expect(trip.deliveryStopFor(o2.id)).toBe(stops[2].id);
    const row = await db().trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(row).toMatchObject({ status: TripStatus.PLANNED, vehicleId: std.DR1.vehicleId, originStoreId: std.DA.homeStoreId });
    const orders = await db().order.findMany({ where: { tripId: trip.id } });
    expect(orders.map((o) => o.status).sort()).toEqual([OrderStatus.ASSIGNED, OrderStatus.ASSIGNED]);
    expect(orders.every((o) => o.assignedAt !== null)).toBe(true);
    await setStopStatus(stops[1].id, 'DONE');
    expect(await db().tripStop.findUniqueOrThrow({ where: { id: stops[1].id } })).toMatchObject({ status: TripStopStatus.DONE });
  });

  it('registerCylinders numbers labels from next_cylinder_no with a REGISTERED event into the home store', async () => {
    const cylinders = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 3 });
    expect(cylinders.map((c) => [c.shortNo, c.shortCode])).toEqual([
      [1, 'AG-C0001'],
      [2, 'AG-C0002'],
      [3, 'AG-C0003'],
    ]);
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextCylinderNo).toBe(4);
    const holder = await cylinderHolder(cylinders[0].id);
    expect(holder).toMatchObject({ custodyType: CustodyType.STORE, custodyId: std.DA.homeStoreId, state: CylinderState.FULL, shortNo: 1 });
    const event = await db().cylinderEvent.findUniqueOrThrow({ where: { id: holder.lastEventId as string } });
    expect(event).toMatchObject({ eventType: CylinderEventType.REGISTERED, source: CylinderEventSource.REGISTRATION, toCustodyType: 'STORE', toState: 'FULL' });
    // Another distributor's labels start at 1 too.
    expect((await registerCylinders({ distributor: std.DB, cylinderTypeId: std.sizes.kg11_8 }))[0].shortCode).toBe('BG-C0001');
  });

  it('loadVan, handOver and takeBack move cylinders as the scans do, with the stop rows and the first-load stamp', async () => {
    const order = await createOrder({
      distributor: std.DA,
      client: std.C1,
      lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 1 }],
    });
    const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
    const full = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 2 });
    const [old] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, state: CylinderState.FULL });
    await placeWithCustomer({ cylinder: old, client: std.C1, actor: std.DR2, state: CylinderState.EMPTY });

    await loadVan({ trip, driver: std.DR1, cylinders: full, finishLoading: true });
    const loaded = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(loaded.loadStartedAt).not.toBeNull();
    expect(loaded.status).toBe(OrderStatus.IN_TRANSIT);
    expect((await db().trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(TripStatus.IN_PROGRESS);
    expect(await cylinderHolder(full[0].id)).toMatchObject({ custodyType: CustodyType.VEHICLE, custodyId: std.DR1.vehicleId });

    await handOver({ trip, order, driver: std.DR1, cylinders: full });
    await takeBack({ trip, order, driver: std.DR1, cylinders: [old], returnState: 'PART_FILLED' });
    expect(await cylinderHolder(full[1].id)).toMatchObject({ custodyType: CustodyType.CLIENT, custodyId: std.C1.id, state: CylinderState.FULL });
    expect(await cylinderHolder(old.id)).toMatchObject({ custodyType: CustodyType.VEHICLE, custodyId: std.DR1.vehicleId, state: CylinderState.PART_FILLED });
    const rows = await stopCylinders(trip.deliveryStopFor(order.id));
    expect(rows.map((r) => [r.cylinderId, r.direction, r.returnState])).toEqual([
      [full[0].id, 'GIVEN', null],
      [full[1].id, 'GIVEN', null],
      [old.id, 'TAKEN_BACK', 'PART_FILLED'],
    ]);
    const events = await db().cylinderEvent.findMany({ where: { tripId: trip.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(events.map((e) => e.eventType)).toEqual(['SCAN_OUT', 'SCAN_OUT', 'DELIVERED', 'DELIVERED', 'PICKED_UP_EMPTY']);
    expect(events.every((e) => e.clientScanId !== null && e.tripStopId !== null)).toBe(true);
    expect((await db().tripStop.findUniqueOrThrow({ where: { id: trip.deliveryStopFor(order.id) } })).status).toBe(TripStopStatus.ARRIVED);
  });

  it('places a cylinder on a van from an earlier run, and sets FAULTY or LOST as a fixture', async () => {
    const earlier = await createTrip({ driver: std.DR1, distributor: std.DA, status: TripStatus.COMPLETED });
    const [left] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8 });
    await placeOnVanFromEarlierRun({ cylinder: left, vehicleId: std.DR1.vehicleId as string, earlierTripId: earlier.id, actor: std.DR1 });
    const holder = await cylinderHolder(left.id);
    expect(holder).toMatchObject({ custodyType: CustodyType.VEHICLE, custodyId: std.DR1.vehicleId });
    expect((await db().cylinderEvent.findUniqueOrThrow({ where: { id: holder.lastEventId as string } })).tripId).toBe(earlier.id);
    await setCylinderState(left.id, CylinderState.FAULTY);
    expect((await cylinderHolder(left.id)).state).toBe(CylinderState.FAULTY);
  });

  it('createConfirmation stores only the hash of a token derived like the service, and tokenFromUrl reads a link back', async () => {
    const customer = await createClient({ distributor: std.DA, name: 'Bad Number', phone: '042-35761234' });
    const order = await createOrder({ distributor: std.DA, client: customer, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED });
    const conf = await createConfirmation({ order });
    expect(conf.token).toHaveLength(CONFIRM_TOKEN_LENGTH);
    expect(conf.token).toBe(confirmationToken(conf.id, 1));
    expect(conf.path).toBe(customerLinkPath(conf.token));
    const row = await db().deliveryConfirmation.findUniqueOrThrow({ where: { id: conf.id } });
    expect(row).toMatchObject({ orderId: order.id, status: 'PENDING', tokenHash: confirmationTokenHash(conf.token), tokenVersion: 1, phoneE164: null });
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);
    expect(JSON.stringify(row)).not.toContain(conf.token);
    expect(row.snapshot).toMatchObject({ v: 1, shop: { name: 'Ahmed Gas', phoneE164: '+923211234567' }, orderNo: order.shortCode });
    expect(tokenFromUrl(`https://smartfleetpk.com/c/${conf.token.toUpperCase()}`)).toBe(conf.token);
    expect(normalizeConfirmationToken(conf.token.replace(/1/g, 'l').replace(/0/g, 'O'))).toBe(conf.token);
    const answered = await createConfirmation({
      order: await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED }),
      response: 'NO',
      comment: 'Nothing came',
    });
    expect(await db().deliveryConfirmation.findUniqueOrThrow({ where: { id: answered.id } })).toMatchObject({ status: 'ANSWERED', response: 'NO' });
  });

  describe('the cross-lane stubs in the running app', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createTestApp();
    });
    afterAll(async () => {
      await app?.close();
    });

    it('registers the no-op ConfirmationService and MessagingService and the mock provider', async () => {
      const confirmations = app.get(ConfirmationService);
      expect(confirmations).toBeInstanceOf(NoopConfirmationService);
      expect(app.get(MessagingService)).toBeInstanceOf(NoopMessagingService);
      const provider = app.get<MessagingProvider>(MESSAGING_PROVIDER);
      expect(provider.name).toBe('mock');
      const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }] });
      const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
      // Issuing inside a transaction does nothing until the confirmation lane lands (or while confirmation.enabled is off).
      const issued = await getTestPrisma().$transaction((tx) =>
        confirmations.issueForDeliveredOrder(tx, { orderId: order.id, stopId: trip.deliveryStopFor(order.id), deliveredAt: new Date() }),
      );
      expect(issued).toBeNull();
      await expect(confirmations.sendIssued(issued)).resolves.toBeUndefined();
      expect(await confirmations.summariesFor([order.id])).toEqual(new Map());
      expect(await confirmations.hasPendingForClient(std.C1.id)).toBe(false);
      expect(await db().deliveryConfirmation.count()).toBe(0);
      expect(await db().outboundMessage.count()).toBe(0);
    });
  });
});
