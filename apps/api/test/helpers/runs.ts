/**
 * [Inc 2] Run fixtures: orders, trips with their store pickup and delivery stops, labelled cylinders,
 * loaded vans and cylinders held by a van or a customer. Rows are written the way the Inc 2 services
 * write them (DATA_MODEL §3.6, §4.5), so the holder rules read them like real scans:
 *
 * - every move is one `cylinder_events` row (source, holders, states, trip, stop, order) and updates the
 *   cylinder's holder, state and `last_event_id`;
 * - a hand-over or a take-back also writes its `stop_cylinders` row (GIVEN / TAKEN_BACK);
 * - the first load on a trip stamps `load_started_at` on its open orders and starts the trip;
 * - an order with a cost is paid like `WalletService.debit` (guarded balance update plus its DEBIT_ORDER
 *   row), so the nightly wallet check stays clean.
 *
 *   const std = await createStandardData();
 *   const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 1 }] });
 *   const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
 *   const full = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 2 });
 *   await loadVan({ trip, driver: std.DR1, cylinders: full });                 // LOAD at the store stop
 *   const old = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 1, state: 'EMPTY' });
 *   await placeWithCustomer({ cylinder: old[0], client: std.C1, actor: std.DR2 }); // an earlier delivery
 *
 * Nothing here calls the API: use scan-calls.ts for the HTTP routes.
 */
import { randomUUID } from 'crypto';
import {
  CustodyType,
  CylinderEventSource,
  CylinderEventType,
  CylinderState,
  OrderStatus,
  Prisma,
  PrismaClient,
  StopCylinderDirection,
  TripStatus,
  TripStopType,
} from '@prisma/client';
import { formatNo } from '@smartfleet/shared-utils';
import { getTestPrisma } from './db';
import { uniquePhone, type LatLng, type TestClient, type TestDistributor, type TestDriver, type TestUser } from './factories';

type Db = PrismaClient | Prisma.TransactionClient;

/** "now" for timestamp(3) columns, which hold UTC (as the services write them). */
const NOW_UTC = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;

/** Who did a move: any test person (user id is enough). */
export type MoveActor = { userId: string } | Pick<TestUser, 'id'> | Pick<TestDriver, 'userId'>;

function actorId(actor: MoveActor): string {
  if ('userId' in actor) return actor.userId;
  return actor.id;
}

type ShopRef = Pick<TestDistributor, 'id' | 'code' | 'homeStoreId'> & { store?: { location: LatLng } };

// ---------- orders ----------

export interface TestOrderLine {
  id: string;
  cylinderTypeId: string;
  fullCount: number;
  expectedReturnCount: number;
}

export interface TestOrder {
  id: string;
  orderNo: number;
  /** "AG-0142". */
  shortCode: string;
  distributorId: string;
  clientId: string;
  destination: LatLng;
  lines: TestOrderLine[];
}

/**
 * An order placed for `client`, numbered from the distributor's counter like a real one (DATA_MODEL
 * §3.6). By default it costs nothing (fee NONE, no ledger row); with `feePaisa` the cost is deducted
 * like `WalletService.debit` (the distributor's balance must cover it).
 */
export async function createOrder(
  opts: {
    distributor: ShopRef;
    client: Pick<TestClient, 'id' | 'location' | 'zoneId'>;
    lines: Array<{ cylinderTypeId: string; fullCount: number; expectedReturnCount?: number }>;
    status?: OrderStatus;
    feePaisa?: bigint;
    /** The delivery point; default the customer's address pin. */
    destination?: LatLng;
    /** The destination zone; default the customer's address zone, else the distributor store's zone. */
    zoneId?: string;
    label?: string;
  },
  db: Db = getTestPrisma(),
): Promise<TestOrder> {
  const destination = opts.destination ?? opts.client.location ?? opts.distributor.store?.location;
  if (!destination) throw new Error('createOrder: pass destination (the customer has no address)');
  const zoneId = opts.zoneId ?? opts.client.zoneId ?? (await storeZoneId(opts.distributor.homeStoreId, db));
  const fee = opts.feePaisa ?? 0n;
  const rows = await db.$queryRaw<Array<{ id: string; order_no: number }>>`
    WITH n AS (
      UPDATE distributors SET next_order_no = next_order_no + 1 WHERE id = ${opts.distributor.id}::uuid
      RETURNING next_order_no - 1 AS no
    )
    INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id,
                        origin_store_id, order_no, status, payment_status, delivery_fee_paisa, fee_status, fee_strategy,
                        fee_base_paisa, fee_quoted_at, created_at, updated_at)
    SELECT gen_random_uuid(), ${opts.distributor.id}::uuid, ${opts.client.id}::uuid,
           ST_SetSRID(ST_MakePoint(${destination.lng}, ${destination.lat}), 4326), ${opts.label ?? 'Test address'},
           ${zoneId}::uuid, ${opts.distributor.homeStoreId}::uuid, n.no, ${opts.status ?? OrderStatus.PENDING}::"OrderStatus",
           ${fee > 0n ? 'PAID_VIA_LEDGER' : 'UNPAID'}::"OrderPaymentStatus", ${fee},
           ${fee > 0n ? 'DEDUCTED' : 'NONE'}::"OrderFeeStatus", 'DISTRIBUTOR_ZONE'::"FeeStrategy", ${fee},
           ${NOW_UTC}, ${NOW_UTC}, ${NOW_UTC}
    FROM n
    RETURNING id, order_no`;
  const order = rows[0];
  const lines: TestOrderLine[] = [];
  for (const line of opts.lines) {
    const row = await db.orderLine.create({
      data: {
        orderId: order.id,
        cylinderTypeId: line.cylinderTypeId,
        fullCount: line.fullCount,
        expectedReturnCount: line.expectedReturnCount ?? 0,
      },
    });
    lines.push({ id: row.id, cylinderTypeId: row.cylinderTypeId, fullCount: row.fullCount, expectedReturnCount: row.expectedReturnCount });
  }
  if (fee > 0n) await debitForOrder(db, opts.distributor.id, order.id, fee);
  return {
    id: order.id,
    orderNo: Number(order.order_no),
    shortCode: formatNo(opts.distributor.code, 'ORDER', Number(order.order_no)),
    distributorId: opts.distributor.id,
    clientId: opts.client.id,
    destination,
    lines,
  };
}

/** The order cost as WalletService.debit takes it: guarded balance update, then DEBIT_ORDER `order:<id>:debit`. */
async function debitForOrder(db: Db, distributorId: string, orderId: string, fee: bigint): Promise<void> {
  const moved = await db.$queryRaw<Array<{ balance: bigint }>>`
    UPDATE distributors SET advance_balance_paisa = advance_balance_paisa - ${fee}, updated_at = ${NOW_UTC}
    WHERE id = ${distributorId}::uuid AND advance_balance_paisa >= ${fee}
    RETURNING advance_balance_paisa AS balance`;
  if (moved.length !== 1) throw new Error(`createOrder: the distributor's balance doesn't cover ${fee} paisa`);
  await db.$executeRaw`
    INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, order_id, created_at)
    VALUES (gen_random_uuid(), ${distributorId}::uuid, 'DEBIT_ORDER'::"LedgerEntryType", ${-fee}, ${moved[0].balance},
            ${`order:${orderId}:debit`}, ${orderId}::uuid,
            GREATEST(${NOW_UTC}, (SELECT max(created_at) + interval '1 millisecond' FROM ledger_entries WHERE distributor_id = ${distributorId}::uuid)))`;
}

// ---------- trips and stops ----------

export interface TestStop {
  id: string;
  seq: number;
  type: TripStopType;
  /** The order of a DELIVERY stop. */
  orderId: string | null;
}

export interface TestTrip {
  id: string;
  driverId: string;
  /** The trip's van (`trip.vehicleId`): the one a load puts cylinders on. */
  vehicleId: string;
  originStoreId: string;
  distributorId: string;
  /** The STORE_PICKUP stop (seq 0) at the distributor's store. */
  pickupStopId: string;
  stops: TestStop[];
  orders: TestOrder[];
  /** The DELIVERY stop of an order on this trip. */
  deliveryStopFor(orderId: string): string;
}

function toTestTrip(trip: Omit<TestTrip, 'deliveryStopFor'>): TestTrip {
  return {
    ...trip,
    deliveryStopFor(orderId: string): string {
      const stop = trip.stops.find((s) => s.type === TripStopType.DELIVERY && s.orderId === orderId);
      if (!stop) throw new Error(`order ${orderId} has no DELIVERY stop on trip ${trip.id}`);
      return stop.id;
    },
  };
}

/**
 * A trip as assign-driver makes it (API_CONTRACT §7.6 rule 5, §9.5): PLANNED, a STORE_PICKUP stop
 * (seq 0, `store_id`) at the distributor's store, then one DELIVERY stop per order (seq 1, 2...); each
 * order becomes ASSIGNED on it with `assigned_at`. `status: 'IN_PROGRESS'` also sets `started_at`.
 */
export async function createTrip(
  opts: {
    driver: Pick<TestDriver, 'id' | 'vehicleId'>;
    distributor: ShopRef;
    orders?: TestOrder[];
    status?: TripStatus;
    /** Default the driver's van. */
    vehicleId?: string;
  },
  db: Db = getTestPrisma(),
): Promise<TestTrip> {
  const vehicleId = opts.vehicleId ?? opts.driver.vehicleId;
  if (!vehicleId) throw new Error('createTrip: the driver has no van; pass vehicleId');
  const status = opts.status ?? TripStatus.PLANNED;
  const trip = await db.trip.create({
    data: {
      driverId: opts.driver.id,
      vehicleId,
      originStoreId: opts.distributor.homeStoreId,
      status,
      startedAt: status === TripStatus.IN_PROGRESS || status === TripStatus.COMPLETED ? new Date() : null,
    },
    select: { id: true },
  });
  const pickup = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO trip_stops (id, trip_id, seq, stop_type, store_id, status, location)
    SELECT gen_random_uuid(), ${trip.id}::uuid, 0, 'STORE_PICKUP', s.id, 'PENDING', s.location
    FROM stores s WHERE s.id = ${opts.distributor.homeStoreId}::uuid
    RETURNING id`;
  const stops: TestStop[] = [{ id: pickup[0].id, seq: 0, type: TripStopType.STORE_PICKUP, orderId: null }];
  const base = toTestTrip({
    id: trip.id,
    driverId: opts.driver.id,
    vehicleId,
    originStoreId: opts.distributor.homeStoreId,
    distributorId: opts.distributor.id,
    pickupStopId: pickup[0].id,
    stops,
    orders: [],
  });
  for (const order of opts.orders ?? []) await addDeliveryStop({ trip: base, order }, db);
  return base;
}

/**
 * Appends a DELIVERY stop for `order` to `trip` (the next seq) and puts the order on the trip:
 * ASSIGNED, `trip_id`, `assigned_at`. Mutates `trip.stops` and `trip.orders`.
 */
export async function addDeliveryStop(opts: { trip: TestTrip; order: TestOrder }, db: Db = getTestPrisma()): Promise<string> {
  const seq = Math.max(...opts.trip.stops.map((s) => s.seq)) + 1;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, status, location)
    VALUES (gen_random_uuid(), ${opts.trip.id}::uuid, ${opts.order.id}::uuid, ${seq}, 'DELIVERY', 'PENDING',
            ST_SetSRID(ST_MakePoint(${opts.order.destination.lng}, ${opts.order.destination.lat}), 4326))
    RETURNING id`;
  await db.$executeRaw`
    UPDATE orders SET status = 'ASSIGNED', trip_id = ${opts.trip.id}::uuid, assigned_at = ${NOW_UTC}, updated_at = ${NOW_UTC}
    WHERE id = ${opts.order.id}::uuid`;
  opts.trip.stops.push({ id: rows[0].id, seq, type: TripStopType.DELIVERY, orderId: opts.order.id });
  opts.trip.orders.push(opts.order);
  return rows[0].id;
}

/** Sets a stop's status with its timestamps, as arrive, finish, cancel and fail do. */
export async function setStopStatus(
  stopId: string,
  status: 'PENDING' | 'ARRIVED' | 'DONE' | 'FAILED' | 'CANCELLED',
  db: Db = getTestPrisma(),
): Promise<void> {
  await db.$executeRaw`
    UPDATE trip_stops SET status = ${status}::"TripStopStatus",
      arrived_at   = CASE WHEN ${status} IN ('ARRIVED', 'DONE') THEN COALESCE(arrived_at, ${NOW_UTC}) ELSE arrived_at END,
      departed_at  = CASE WHEN ${status} = 'DONE' THEN COALESCE(departed_at, ${NOW_UTC}) ELSE departed_at END,
      completed_at = CASE WHEN ${status} IN ('DONE', 'FAILED') THEN COALESCE(completed_at, ${NOW_UTC}) ELSE completed_at END,
      cancelled_at = CASE WHEN ${status} = 'CANCELLED' THEN COALESCE(cancelled_at, ${NOW_UTC}) ELSE cancelled_at END
    WHERE id = ${stopId}::uuid`;
}

// ---------- cylinders ----------

export interface TestCylinder {
  id: string;
  /** The QR value (scan with `entryMethod: 'QR'`). */
  qrCode: string;
  serial: string;
  distributorId: string;
  cylinderTypeId: string;
  /** The label number: type it as `String(shortNo)` with `entryMethod: 'TYPED'`. */
  shortNo: number;
  /** "AG-C0042". */
  shortCode: string;
}

/**
 * Labelled cylinders as the Inc 2 bulk-register makes them (API_CONTRACT §9.5): each gets the next
 * `short_no` from the distributor's `next_cylinder_no`, starts in the home store (FULL by default) and has
 * one REGISTERED event (source REGISTRATION) as its last move. `actor` defaults to a new super admin.
 */
export async function registerCylinders(
  opts: {
    distributor: ShopRef;
    cylinderTypeId: string;
    count?: number;
    state?: CylinderState;
    actor?: MoveActor;
  },
  db: Db = getTestPrisma(),
): Promise<TestCylinder[]> {
  const actor = opts.actor ? actorId(opts.actor) : await officeUserId(db);
  const state = opts.state ?? CylinderState.FULL;
  const out: TestCylinder[] = [];
  for (let i = 0; i < (opts.count ?? 1); i++) {
    const [{ no }] = await db.$queryRaw<Array<{ no: number }>>`
      UPDATE distributors SET next_cylinder_no = next_cylinder_no + 1 WHERE id = ${opts.distributor.id}::uuid
      RETURNING next_cylinder_no - 1 AS no`;
    const shortCode = formatNo(opts.distributor.code, 'CYLINDER', Number(no));
    const unique = randomUUID().slice(0, 8);
    const cylinder = await db.cylinder.create({
      data: {
        serial: `SN-${shortCode}-${unique}`,
        qrCode: `QR-${shortCode}-${unique}`,
        distributorId: opts.distributor.id,
        cylinderTypeId: opts.cylinderTypeId,
        shortNo: Number(no),
        state,
        custodyType: CustodyType.STORE,
        custodyId: opts.distributor.homeStoreId,
      },
    });
    await recordMove(
      {
        cylinderId: cylinder.id,
        eventType: CylinderEventType.REGISTERED,
        source: CylinderEventSource.REGISTRATION,
        actorUserId: actor,
        from: null,
        to: { type: CustodyType.STORE, id: opts.distributor.homeStoreId },
        fromState: null,
        toState: state,
      },
      db,
    );
    out.push({
      id: cylinder.id,
      qrCode: cylinder.qrCode,
      serial: cylinder.serial,
      distributorId: opts.distributor.id,
      cylinderTypeId: opts.cylinderTypeId,
      shortNo: Number(no),
      shortCode,
    });
  }
  return out;
}

/** One move, written as ScanService writes it (DATA_MODEL §4.5 steps 4–6). Returns the event id. */
export async function recordMove(
  move: {
    cylinderId: string;
    eventType: CylinderEventType;
    source?: CylinderEventSource;
    actorUserId: string;
    from: { type: CustodyType; id: string } | null;
    to: { type: CustodyType; id: string };
    fromState: CylinderState | null;
    toState: CylinderState;
    tripId?: string | null;
    tripStopId?: string | null;
    orderId?: string | null;
    clientScanId?: string | null;
    reason?: string | null;
    /** Also write this cylinder's `stop_cylinders` row on `tripStopId` (a hand-over or a take-back). */
    stopRow?: { direction: StopCylinderDirection; orderId: string; returnState?: CylinderState | null };
    at?: Date;
  },
  db: Db = getTestPrisma(),
): Promise<string> {
  const event = await db.cylinderEvent.create({
    data: {
      cylinderId: move.cylinderId,
      eventType: move.eventType,
      source: move.source ?? CylinderEventSource.SCAN,
      fromCustodyType: move.from?.type ?? null,
      fromCustodyId: move.from?.id ?? null,
      toCustodyType: move.to.type,
      toCustodyId: move.to.id,
      fromState: move.fromState,
      toState: move.toState,
      reason: move.reason ?? null,
      actorUserId: move.actorUserId,
      clientScanId: move.clientScanId ?? null,
      tripId: move.tripId ?? null,
      tripStopId: move.tripStopId ?? null,
      orderId: move.orderId ?? null,
      ...(move.at ? { createdAt: move.at } : {}),
    },
    select: { id: true },
  });
  const cylinder = await db.cylinder.update({
    where: { id: move.cylinderId },
    data: { custodyType: move.to.type, custodyId: move.to.id, state: move.toState, lastEventId: event.id },
    select: { cylinderTypeId: true },
  });
  if (move.stopRow) {
    if (!move.tripStopId) throw new Error('recordMove: a stop row needs tripStopId');
    await db.stopCylinder.create({
      data: {
        tripStopId: move.tripStopId,
        orderId: move.stopRow.orderId,
        cylinderId: move.cylinderId,
        cylinderTypeId: cylinder.cylinderTypeId,
        direction: move.stopRow.direction,
        returnState: move.stopRow.direction === StopCylinderDirection.TAKEN_BACK ? move.stopRow.returnState ?? CylinderState.EMPTY : null,
        eventId: event.id,
      },
    });
  }
  return event.id;
}

async function cylinderNow(cylinderId: string, db: Db) {
  return db.cylinder.findUniqueOrThrow({
    where: { id: cylinderId },
    select: { custodyType: true, custodyId: true, state: true },
  });
}

/**
 * A loaded van: each cylinder (in the trip's store) is LOADed onto the trip's van at its STORE_PICKUP
 * stop (SCAN_OUT, the trip's driver), as `POST /trips/:tripId/scans` records it. The first load stamps
 * `load_started_at` on the trip's open orders, starts the trip and arrives the pickup stop.
 * `finishLoading: true` also finishes the pickup stop ("Done loading"): DONE, and the trip's ASSIGNED
 * orders on the way (IN_TRANSIT with `on_the_way_at`).
 */
export async function loadVan(
  opts: { trip: TestTrip; driver: Pick<TestDriver, 'userId'>; cylinders: Array<Pick<TestCylinder, 'id'>>; finishLoading?: boolean },
  db: Db = getTestPrisma(),
): Promise<string[]> {
  const events: string[] = [];
  for (const cylinder of opts.cylinders) {
    const now = await cylinderNow(cylinder.id, db);
    if (now.custodyType !== CustodyType.STORE || now.custodyId !== opts.trip.originStoreId) {
      throw new Error(`loadVan: cylinder ${cylinder.id} is not in the trip's store`);
    }
    events.push(
      await recordMove(
        {
          cylinderId: cylinder.id,
          eventType: CylinderEventType.SCAN_OUT,
          actorUserId: opts.driver.userId,
          from: { type: CustodyType.STORE, id: opts.trip.originStoreId },
          to: { type: CustodyType.VEHICLE, id: opts.trip.vehicleId },
          fromState: now.state,
          toState: now.state,
          tripId: opts.trip.id,
          tripStopId: opts.trip.pickupStopId,
          clientScanId: randomUUID(),
        },
        db,
      ),
    );
  }
  if (opts.cylinders.length > 0) {
    await db.$executeRaw`
      UPDATE orders SET load_started_at = ${NOW_UTC}
      WHERE trip_id = ${opts.trip.id}::uuid AND load_started_at IS NULL AND status IN ('PENDING','CONFIRMED','ASSIGNED','IN_TRANSIT')`;
    await db.$executeRaw`
      UPDATE trips SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, ${NOW_UTC})
      WHERE id = ${opts.trip.id}::uuid AND status = 'PLANNED'`;
    await db.$executeRaw`
      UPDATE trip_stops SET status = 'ARRIVED', arrived_at = COALESCE(arrived_at, ${NOW_UTC})
      WHERE id = ${opts.trip.pickupStopId}::uuid AND status = 'PENDING'`;
  }
  if (opts.finishLoading) {
    await setStopStatus(opts.trip.pickupStopId, 'DONE', db);
    await db.$executeRaw`
      UPDATE orders SET status = 'IN_TRANSIT', on_the_way_at = COALESCE(on_the_way_at, ${NOW_UTC}), updated_at = ${NOW_UTC}
      WHERE trip_id = ${opts.trip.id}::uuid AND status = 'ASSIGNED'`;
  }
  return events;
}

/**
 * A hand-over on a visit: each cylinder (loaded on this trip, on its van) goes to the order's customer
 * at the order's DELIVERY stop (DELIVERED; a GIVEN stop row; the state stays as it was, FULL). The
 * first move arrives the stop. It doesn't finish the stop or deliver the order.
 */
export async function handOver(
  opts: { trip: TestTrip; order: TestOrder; driver: Pick<TestDriver, 'userId'>; cylinders: Array<Pick<TestCylinder, 'id'>> },
  db: Db = getTestPrisma(),
): Promise<string[]> {
  const stopId = opts.trip.deliveryStopFor(opts.order.id);
  const events: string[] = [];
  for (const cylinder of opts.cylinders) {
    const now = await cylinderNow(cylinder.id, db);
    events.push(
      await recordMove(
        {
          cylinderId: cylinder.id,
          eventType: CylinderEventType.DELIVERED,
          actorUserId: opts.driver.userId,
          from: { type: now.custodyType, id: now.custodyId },
          to: { type: CustodyType.CLIENT, id: opts.order.clientId },
          fromState: now.state,
          toState: now.state,
          tripId: opts.trip.id,
          tripStopId: stopId,
          orderId: opts.order.id,
          clientScanId: randomUUID(),
          stopRow: { direction: StopCylinderDirection.GIVEN, orderId: opts.order.id },
        },
        db,
      ),
    );
  }
  await db.$executeRaw`
    UPDATE trip_stops SET status = 'ARRIVED', arrived_at = COALESCE(arrived_at, ${NOW_UTC})
    WHERE id = ${stopId}::uuid AND status = 'PENDING'`;
  return events;
}

/**
 * A take-back on a visit: each cylinder (with the order's customer) goes onto the trip's van at the
 * order's DELIVERY stop (PICKED_UP_EMPTY; a TAKEN_BACK stop row with `returnState`; the state becomes
 * `returnState`, except FAULTY and LOST, which stay). The first move arrives the stop.
 */
export async function takeBack(
  opts: {
    trip: TestTrip;
    order: TestOrder;
    driver: Pick<TestDriver, 'userId'>;
    cylinders: Array<Pick<TestCylinder, 'id'>>;
    returnState?: 'EMPTY' | 'PART_FILLED' | 'FULL';
  },
  db: Db = getTestPrisma(),
): Promise<string[]> {
  const stopId = opts.trip.deliveryStopFor(opts.order.id);
  const returnState = (opts.returnState ?? 'EMPTY') as CylinderState;
  const events: string[] = [];
  for (const cylinder of opts.cylinders) {
    const now = await cylinderNow(cylinder.id, db);
    const blocked = now.state === CylinderState.FAULTY || now.state === CylinderState.LOST;
    events.push(
      await recordMove(
        {
          cylinderId: cylinder.id,
          eventType: CylinderEventType.PICKED_UP_EMPTY,
          actorUserId: opts.driver.userId,
          from: { type: now.custodyType, id: now.custodyId },
          to: { type: CustodyType.VEHICLE, id: opts.trip.vehicleId },
          fromState: now.state,
          toState: blocked ? now.state : returnState,
          tripId: opts.trip.id,
          tripStopId: stopId,
          orderId: opts.order.id,
          clientScanId: randomUUID(),
          stopRow: { direction: StopCylinderDirection.TAKEN_BACK, orderId: opts.order.id, returnState },
        },
        db,
      ),
    );
  }
  await db.$executeRaw`
    UPDATE trip_stops SET status = 'ARRIVED', arrived_at = COALESCE(arrived_at, ${NOW_UTC})
    WHERE id = ${stopId}::uuid AND status = 'PENDING'`;
  return events;
}

/**
 * A cylinder held by a customer from an earlier delivery: one DELIVERED event to `client` (on no trip
 * unless given), state FULL by default. Use it for a take-back that isn't from this visit.
 */
export async function placeWithCustomer(
  opts: {
    cylinder: Pick<TestCylinder, 'id'>;
    client: Pick<TestClient, 'id'>;
    actor: MoveActor;
    state?: CylinderState;
    tripId?: string;
    orderId?: string;
    at?: Date;
  },
  db: Db = getTestPrisma(),
): Promise<string> {
  const now = await cylinderNow(opts.cylinder.id, db);
  return recordMove(
    {
      cylinderId: opts.cylinder.id,
      eventType: CylinderEventType.DELIVERED,
      actorUserId: actorId(opts.actor),
      from: { type: now.custodyType, id: now.custodyId },
      to: { type: CustodyType.CLIENT, id: opts.client.id },
      fromState: now.state,
      toState: opts.state ?? now.state,
      tripId: opts.tripId ?? null,
      orderId: opts.orderId ?? null,
      at: opts.at,
    },
    db,
  );
}

/**
 * A cylinder left on a van with no load on the given run: one SCAN_OUT on `earlierTripId` (another,
 * finished trip) onto `vehicleId`. A hand-over on a later run must refuse it (`SCAN_NOT_ON_YOUR_VAN`).
 */
export async function placeOnVanFromEarlierRun(
  opts: { cylinder: Pick<TestCylinder, 'id'>; vehicleId: string; earlierTripId: string; actor: MoveActor },
  db: Db = getTestPrisma(),
): Promise<string> {
  const now = await cylinderNow(opts.cylinder.id, db);
  return recordMove(
    {
      cylinderId: opts.cylinder.id,
      eventType: CylinderEventType.SCAN_OUT,
      actorUserId: actorId(opts.actor),
      from: { type: now.custodyType, id: now.custodyId },
      to: { type: CustodyType.VEHICLE, id: opts.vehicleId },
      fromState: now.state,
      toState: now.state,
      tripId: opts.earlierTripId,
    },
    db,
  );
}

/**
 * Sets a cylinder's state without a move: the fixture way to make one FAULTY or LOST (no pilot route
 * does that before the Inc 3 day-end fixes, API_CONTRACT §9.2).
 */
export async function setCylinderState(cylinderId: string, state: CylinderState, db: Db = getTestPrisma()): Promise<void> {
  await db.cylinder.update({ where: { id: cylinderId }, data: { state } });
}

/** Where a cylinder is now: holder, state and last move. */
export async function cylinderHolder(cylinderId: string, db: Db = getTestPrisma()) {
  return db.cylinder.findUniqueOrThrow({
    where: { id: cylinderId },
    select: { custodyType: true, custodyId: true, state: true, lastEventId: true, shortNo: true },
  });
}

/** The `stop_cylinders` rows of a stop, oldest first. */
export async function stopCylinders(stopId: string, db: Db = getTestPrisma()) {
  return db.stopCylinder.findMany({ where: { tripStopId: stopId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

// ---------- internals ----------

async function storeZoneId(storeId: string, db: Db): Promise<string> {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { zoneId: true } });
  return store.zoneId;
}

let officeId: { db: Db; id: string } | undefined;
/** A super admin to act for registrations when the test names none (one per database client). */
async function officeUserId(db: Db): Promise<string> {
  if (officeId?.db === db) {
    const still = await db.user.findUnique({ where: { id: officeId.id }, select: { id: true } });
    if (still) return officeId.id;
  }
  const user = await db.user.create({
    data: { phone: uniquePhone(), name: 'Fixture office', role: 'SUPER_ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  officeId = { db, id: user.id };
  return user.id;
}
