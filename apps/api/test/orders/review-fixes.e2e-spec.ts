/**
 * Regression tests for the verified review findings fixed in the orders, trips, pricing and refill
 * modules (the confirming tests live under test/review/**). Each case is named after its finding.
 *
 * - money-data-01: a driver change after the driver reached the customer keeps the order started.
 * - money-data-04: the price lookup's one statement returns the price exactly as stored.
 * - money-data-06: load scans queued on the store's inventory lot each take one off it.
 * - security-01: GET /orders/:id/tracking gives the shop the driver's position only while on the way.
 * - security-03: a DISTRIBUTOR or DRIVER caller without its profile id is refused (403) at every
 *   scoped site, before anything is read, instead of reading every tenant through an `undefined` filter.
 * - robustness-ops-08: POST /orders answers although the auto-dispatch enqueue never settles.
 */
import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { systemActor, type UserActor } from '../../src/common/auth/actor';
import { ClientsController } from '../../src/modules/clients/clients.controller';
import { DistributorHomeController, DistributorsController } from '../../src/modules/distributors/distributors.controller';
import { FillingOrdersController } from '../../src/modules/filling-orders/filling-orders.controller';
import { FillingOrdersService } from '../../src/modules/filling-orders/filling-orders.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PricingController } from '../../src/modules/pricing/pricing.controller';
import { ZonePriceLookup } from '../../src/modules/pricing/zone-price.lookup';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { TripsController } from '../../src/modules/trips/trips.controller';
import type { TestActor } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createDriver } from '../helpers/factories';
import { createStandardData, x1OrderBody } from '../helpers/standard-data';
import { newKey, OrdersFixture, together, type OrderBody } from './support/fixture';
import { createOrdersTestApp, freshSettings } from './support/orders-app';
import { holdRowLock, waitForLockWaiters } from './support/row-lock';

jest.setTimeout(120_000);

interface Tracking {
  orderId: string;
  status: string;
  driverLocation: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  driver: { id: string; name: string; phone: string; vehiclePlate: string | null } | null;
  tripId: string | null;
}

describeDb('orders: review fixes', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------- money-data-01 ----------

  it('REV money-data-01 after an arrival and a driver change, the office can still record "could not deliver" and nothing is refunded', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const { tripId } = await f.assign(x1.id, std.DR1);
    const delivery = (await f.stops(tripId)).find((stop) => stop.stopType === 'DELIVERY')!;
    await f.as(std.DR1).patch(`/trips/stops/${delivery.id}/arrive`).expect(200);
    const moved = await f.assign(x1.id, std.DR2);
    expect(moved.reassignedFromTripId).toBe(tripId);

    const office = (await f.as(std.SA1).get(`/orders/${x1.id}`).expect(200)).body as OrderBody;
    expect({ cancel: office.cancel, markFailed: office.allowedActions.includes('MARK_FAILED') }).toEqual({
      cancel: { allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' },
      markFailed: true,
    });
    const failed = await f.fail(x1.id, { reasonCode: 'CUSTOMER_NOT_HOME', note: 'Nobody at Sana\'s house' }, std.SA1).expect(200);
    expect(failed.body.status).toBe('FAILED');
    expect(await f.ledger({ entryType: 'CREDIT_ORDER_REVERSAL', orderId: x1.id })).toEqual([]);
    expect(await f.balance()).toBe(500_000n - 25_000n);
  });

  // ---------- money-data-04 ----------

  it('REV money-data-04 the one-statement price read returns the price as stored, and no price as null', async () => {
    const { std } = f;
    const lookup = app.get(ZonePriceLookup);
    // DA's North price as the office last saved it: the one cost per order, a note and its editor.
    await f.as(std.SA1).put(`/pricing/prices/${std.DA.id}/${std.zones.North.id}`).send({ basePaisa: '26000', note: 'Ring road surcharge' }).expect(200);
    const stored = async (zoneId: string) => {
      const price = await f.db.distributorZonePrice.findUnique({ where: { distributorId_zoneId: { distributorId: std.DA.id, zoneId } } });
      if (!price) return null;
      const { id, basePaisa, note, updatedAt, updatedByUserId } = price;
      return { id, basePaisa, note, updatedAt, updatedByUserId };
    };

    for (const zone of [std.zones.North, std.zones.South, std.zones.East]) expect(await lookup.priceFor(std.DA.id, zone.id)).toEqual(await stored(zone.id));
    expect(await lookup.priceFor(std.DA.id, std.zones.North.id)).toMatchObject({ basePaisa: 26_000n, note: 'Ring road surcharge', updatedByUserId: std.SA1.id });
    expect(await lookup.priceFor(std.DA.id, std.zones.East.id)).toBeNull();
    // X1 (2 × 11.8 kg, 1 × 45.4 kg) is quoted from it: Rs 260 once, whatever the cylinders.
    const quote = await f.as(std.DA).post('/orders/quote').send(x1OrderBody(std)).expect(200);
    expect(String(quote.body.quote.totalPaisa)).toBe('26000');
  });

  // ---------- money-data-06 ----------

  it('REV money-data-06 four load scans queued on the store\'s 11.8 kg lot at the same moment each take one off it', async () => {
    const { std } = f;
    const lotKey = { holderType: 'STORE' as const, holderId: std.DA.homeStoreId, distributorId: std.DA.id, cylinderTypeId: std.sizes.kg11_8, state: 'FULL' as const };
    // The standard data has 20 FULL 11.8 kg cylinders in the store (AG-C0001..AG-C0020); the lot agrees.
    const lot = await f.db.inventoryLot.create({ data: { ...lotKey, count: 20 } });
    const drivers = [std.DR1, std.DR2, await createDriver({ zone: std.zones.North }), await createDriver({ zone: std.zones.North })];
    const trips: string[] = [];
    for (const driver of drivers) trips.push((await f.assign((await f.x1()).id, driver)).tripId);

    // The lot row is held until all four scans wait for it, so each reaches the lot after the others
    // could have read it: a read-then-write would write the same stale count four times.
    const holder = await holdRowLock((tx) => tx.$queryRaw`SELECT id FROM inventory_lots WHERE id = ${lot.id}::uuid FOR UPDATE`);
    const scans = together(...drivers.map((driver, i) => f.loadScan(driver, trips[i], `AG-C000${i + 1}`)));
    try {
      await waitForLockWaiters(holder, 'inventory_lots', 4);
    } finally {
      await holder.release();
    }
    expect((await scans).map((scan) => scan.status)).toEqual([201, 201, 201, 201]);

    const after = await f.db.inventoryLot.findUniqueOrThrow({ where: { inventory_unique: lotKey } });
    const inStore = await f.db.cylinder.count({
      where: { custodyType: 'STORE', custodyId: std.DA.homeStoreId, cylinderTypeId: std.sizes.kg11_8, state: 'FULL' },
    });
    expect({ lot: after.count, cylindersInStore: inStore }).toEqual({ lot: 16, cylindersInStore: 16 });
    // Each van's lot got its one cylinder.
    const vans = await f.db.inventoryLot.findMany({ where: { holderType: 'VEHICLE', cylinderTypeId: std.sizes.kg11_8, state: 'FULL' } });
    expect(vans.map((van) => van.count)).toEqual([1, 1, 1, 1]);
  });

  // ---------- security-01 ----------

  async function reportPosition(driver: typeof f.std.DR1, at: { lat: number; lng: number }): Promise<void> {
    await f.as(driver).patch(`/drivers/${driver.id}/location`).send(at).expect(200);
  }

  async function trackingOf(orderId: string, as: { actor: TestActor } = f.std.DA): Promise<Tracking> {
    return (await f.as(as).get(`/orders/${orderId}/tracking`).expect(200)).body as Tracking;
  }

  /** From Inc 2 the store stop's depart is "Done loading" (API_CONTRACT §9.10): X1's three cylinders go on first. */
  async function loadX1(driver: typeof f.std.DR1, tripId: string, codes: readonly string[]): Promise<void> {
    for (const code of codes) await f.loadScan(driver, tripId, code).expect(201);
  }

  it('REV security-01 the shop sees the driver only while its order is on the way; the shape stays the same', async () => {
    const { std } = f;
    const x1 = await f.x1();
    const { tripId } = await f.assign(x1.id, std.DR1);
    await reportPosition(std.DR1, { lat: 31.521, lng: 74.221 });

    // Assigned, not yet on the way: no position for the shop (no TRACK button), the office still sees it.
    const waiting = await trackingOf(x1.id);
    expect(Object.keys(waiting).sort()).toEqual(['deliveryFeePaisa', 'destination', 'driver', 'driverLocation', 'orderId', 'paymentStatus', 'status', 'tripId']);
    expect({ status: waiting.status, driverLocation: waiting.driverLocation, driver: waiting.driver?.id, tripId: waiting.tripId }).toEqual({
      status: 'ASSIGNED',
      driverLocation: null,
      driver: std.DR1.id,
      tripId,
    });
    expect((await trackingOf(x1.id, std.SA1)).driverLocation).toEqual({ lat: 31.521, lng: 74.221 });

    // The store stop departs: ON_THE_WAY, TRACK is offered, and the shop sees the driver.
    await loadX1(std.DR1, tripId, ['AG-C0001', 'AG-C0002', 'AG-C0031']);
    const store = (await f.stops(tripId)).find((stop) => stop.stopType === 'STORE_PICKUP')!;
    await f.as(std.DR1).patch(`/trips/stops/${store.id}/depart`).expect(200);
    const dto = (await f.as(std.DA).get(`/orders/${x1.id}`).expect(200)).body as OrderBody;
    expect({ stage: dto.stage, track: dto.allowedActions.includes('TRACK') }).toEqual({ stage: 'ON_THE_WAY', track: true });
    expect((await trackingOf(x1.id)).driverLocation).toEqual({ lat: 31.521, lng: 74.221 });

    // Delivered: the driver's position is never shown again, wherever he goes next. From Inc 2 the tap
    // needs every cylinder handed over first (§9.10).
    for (const code of ['AG-C0001', 'AG-C0002', 'AG-C0031']) {
      await f.as(std.DR1).post('/custody/scan').send({ qrCode: `${code}-QR`, eventType: 'DELIVERED', tripId, orderId: x1.id }).expect(201);
    }
    await f.as(std.DR1).patch(`/orders/${x1.id}/status`).send({ status: 'DELIVERED' }).expect(200);
    await reportPosition(std.DR1, std.C3.location as { lat: number; lng: number });
    const done = await trackingOf(x1.id);
    expect({ status: done.status, driverLocation: done.driverLocation, driver: done.driver?.id, destination: done.destination !== null }).toEqual({
      status: 'DELIVERED',
      driverLocation: null,
      driver: std.DR1.id,
      destination: true,
    });
  });

  it('REV security-01 a cancelled, a failed and a reassigned order never show a driver who is not on the way with it', async () => {
    const { std } = f;
    await reportPosition(std.DR1, { lat: 31.531, lng: 74.231 });
    await reportPosition(std.DR2, { lat: 31.541, lng: 74.241 });

    // Cancelled before loading (full refund).
    const cancelled = await f.x1();
    await f.assign(cancelled.id, std.DR1);
    await f.cancel(cancelled.id, { reasonCode: 'WRONG_ORDER' }).expect(200);
    expect(await trackingOf(cancelled.id)).toMatchObject({ status: 'CANCELLED', driverLocation: null });

    // Failed after leaving the store.
    const failed = await f.x1();
    const failedTrip = await f.assign(failed.id, std.DR1);
    await loadX1(std.DR1, failedTrip.tripId, ['AG-C0001', 'AG-C0002', 'AG-C0031']);
    const store = (await f.stops(failedTrip.tripId)).find((stop) => stop.stopType === 'STORE_PICKUP')!;
    await f.as(std.DR1).patch(`/trips/stops/${store.id}/depart`).expect(200);
    await f.fail(failed.id, { reasonCode: 'CUSTOMER_NOT_HOME' }, std.DR1).expect(200);
    expect(await trackingOf(failed.id)).toMatchObject({ status: 'FAILED', driverLocation: null });

    // Reassigned from DR1 to DR2 before loading: DR1 is never shown, nor DR2 until he is on the way.
    const moved = await f.x1();
    await f.assign(moved.id, std.DR1);
    const second = await f.assign(moved.id, std.DR2);
    expect(await trackingOf(moved.id)).toMatchObject({ status: 'ASSIGNED', driverLocation: null, driver: { id: std.DR2.id } });
    await loadX1(std.DR2, second.tripId, ['AG-C0003', 'AG-C0004', 'AG-C0032']);
    const secondStore = (await f.stops(second.tripId)).find((stop) => stop.stopType === 'STORE_PICKUP')!;
    await f.as(std.DR2).patch(`/trips/stops/${secondStore.id}/depart`).expect(200);
    expect((await trackingOf(moved.id)).driverLocation).toEqual({ lat: 31.541, lng: 74.241 });
  });

  // ---------- security-03 ----------

  it('REV security-03 a DISTRIBUTOR caller without its distributor id is refused at every scoped site, before any read', async () => {
    const { std } = f;
    const profileless: UserActor = { kind: 'USER', userId: std.DA.userId, role: UserRole.DISTRIBUTOR };
    const orders = app.get(OrdersService);
    const body = x1OrderBody(std) as never;
    const refusals = await Promise.all(
      [
        () => orders.list(profileless, {} as never),
        () => orders.quote(profileless, body),
        () => orders.create(profileless, body, newKey()),
        () => app.get(ClientsController).list(profileless, {} as never),
        () => app.get(ClientsController).create(profileless, newKey(), { name: 'Hina', phone: '+923009876543' } as never),
        () => app.get(FillingOrdersController).mine(profileless),
        () => app.get(FillingOrdersService).create(profileless, { fillingStationId: std.DA.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 3 } as never),
        () => app.get(DistributorsController).me(profileless),
        () => app.get(DistributorHomeController).home(profileless),
        () => app.get(PricingController).quote(profileless, { lat: 31.52, lng: 74.22 } as never),
      ].map(async (call) => {
        try {
          await call();
          return 'answered';
        } catch (error) {
          return (error as { code?: string }).code ?? String(error);
        }
      }),
    );
    expect(refusals).toEqual(Array(10).fill('PERMISSION_DENIED'));
    // Nothing was created on the way.
    expect(await f.db.order.count()).toBe(0);
  });

  it('REV security-03 a DRIVER caller without its driver id is refused at every scoped site', async () => {
    const { std } = f;
    const x1 = await f.x1();
    await f.assign(x1.id, std.DR1);
    const profileless: UserActor = { kind: 'USER', userId: std.DR1.userId, role: UserRole.DRIVER };
    const refusals = await Promise.all(
      [
        () => app.get(TripsController).mine(profileless),
        () => app.get(TripsController).next(profileless),
        () => app.get(FillingOrdersController).driverMine(profileless),
      ].map(async (call) => {
        try {
          return { answered: await call() };
        } catch (error) {
          return (error as { code?: string }).code ?? String(error);
        }
      }),
    );
    expect(refusals).toEqual(['PERMISSION_DENIED', 'PERMISSION_DENIED', 'PERMISSION_DENIED']);
    // The same calls with the profile id still answer the driver's own data.
    const own = await app.get(TripsController).mine({ ...profileless, driverId: std.DR1.id });
    expect(own.map((trip) => trip.driverId)).toEqual([std.DR1.id]);
  });

  // ---------- robustness-ops-08 ----------

  it('REV robustness-ops-08 with auto-assign on, POST /orders answers even when the dispatch enqueue never settles', async () => {
    const settings = app.get(SettingsService);
    const queue = (app.get(OrdersService) as unknown as { dispatchQueue: { add: (...args: unknown[]) => Promise<unknown> } }).dispatchQueue;
    // Redis down: BullMQ waits for it to come back instead of failing.
    const add = jest.spyOn(queue, 'add').mockImplementation(() => new Promise(() => undefined));
    await settings.set('dispatch.autoAssign.enabled', true, systemActor('cli:settings'), 'review: enqueue never settles', { allowNotEditable: true });
    try {
      const started = Date.now();
      const placed = await f.placeX1().expect(201);
      const took = Date.now() - started;
      expect({ queued: add.mock.calls.map((call) => call[1]), took: took < 5_000 }).toEqual({ queued: [{ orderId: placed.body.id }], took: true });
      expect(await f.balance()).toBe(500_000n - 25_000n);
    } finally {
      add.mockRestore();
      await settings.set('dispatch.autoAssign.enabled', false, systemActor('cli:settings'), 'review: back to off', { allowNotEditable: true });
    }
  });
});
