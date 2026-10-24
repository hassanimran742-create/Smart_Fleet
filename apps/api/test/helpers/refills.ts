/**
 * [Inc 3] Refill fixtures (API_CONTRACT §10.1, DATA_MODEL §5): stations, refill requests numbered from the
 * shop's counter, and the scan steps written the way the Inc 3 refill scans write them, so the holder and
 * refill rules read them like real scans:
 *
 * - a PICKUP is one SCAN_OUT event with `filling_order_id` and no trip, store → the refill's van, the state
 *   unchanged, plus a PICKED_UP line (`state_at_pickup`); the first one stamps `picked_up_at`. The refill's
 *   driver becomes the responsible driver; the refill stays ASSIGNED until "Leave store";
 * - a FILL is one FILLED event (the van keeps the cylinder, the state is unchanged until received) and
 *   sets the line's `filled_at` (status FILLED); the first fill makes the refill AT_STATION;
 * - the store's RECEIVE of a refill cylinder is one SCAN_IN event (with `filling_order_id`), van → the
 *   home store, FULL when the line was filled (else the state stays), and makes the line RETURNED; when no
 *   picked line is left un-received the refill becomes COMPLETED (`completed_at`). No money, ever.
 *
 *   const std = await createStandardData();
 *   const station = await createStation();
 *   const empties = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 2, state: 'EMPTY' });
 *   const refill = await createRefill({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, station, assignTo: std.DR2 });
 *   await pickUpForRefill({ refill, driver: std.DR2, cylinders: empties });   // AG-R001, both on LEB-202
 *   await advanceRefill(refill, 'EMPTIES_PICKED');                            // "Leave store"
 *   await fillForRefill({ refill, driver: std.DR2, cylinders: empties });     // AT_STATION
 *   await advanceRefill(refill, 'FILLED');                                     // "Leave station"
 *   await receiveForRefill({ refill, shop: std.DA, cylinders: empties });     // FULL in the store, COMPLETED
 *
 * Nothing here calls the API: use refillCalls(app) in refill-calls.ts for the routes.
 */
import { randomUUID } from 'crypto';
import {
  CustodyType,
  CylinderEventType,
  CylinderState,
  FillingOrderCylinderStatus,
  FillingOrderStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { formatNo } from '@smartfleet/shared-utils';
import { getTestPrisma } from './db';
import type { LatLng, TestDistributor, TestDriver } from './factories';
import { recordMove, type MoveActor, type TestCylinder } from './runs';

type Db = PrismaClient | Prisma.TransactionClient;

/** "now" for timestamp(3) columns, which hold UTC (as the services write them). */
const NOW_UTC = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;

function actorId(actor: MoveActor): string {
  if ('userId' in actor) return actor.userId;
  return actor.id;
}

// ---------- stations ----------

export interface TestStation {
  id: string;
  name: string;
  location: LatLng;
}

/** A refill station, written as `POST /filling-stations` writes it (raw INSERT: it has a geometry). Default "Lahore Filling Station". */
export async function createStation(
  opts: { name?: string; address?: string; location?: LatLng; isActive?: boolean } = {},
  db: Db = getTestPrisma(),
): Promise<TestStation> {
  const location = opts.location ?? { lat: 31.54, lng: 74.24 };
  const name = opts.name ?? 'Lahore Filling Station';
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO filling_stations (id, name, address, location, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), ${name}, ${opts.address ?? 'Test station address'},
            ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326), ${opts.isActive ?? true}, ${NOW_UTC}, ${NOW_UTC})
    RETURNING id`;
  return { id: rows[0].id, name, location };
}

// ---------- refill requests ----------

export interface TestRefill {
  id: string;
  /** `refill_no`. */
  refillNo: number;
  /** "AG-R001". */
  shortCode: string;
  distributorId: string;
  /** The home store: where pickups come from and receives go to. */
  homeStoreId: string;
  cylinderTypeId: string;
  requestedCount: number;
  /** The assigned van (pickups go onto it); null until assigned. */
  vehicleId: string | null;
  driverId: string | null;
}

type ShopRef = Pick<TestDistributor, 'id' | 'code' | 'homeStoreId'>;

/**
 * A refill request as `POST /filling-orders` makes it from Inc 3: numbered from the distributor's
 * `next_refill_no` (AG-R001…), the pickup at the home store, both prices 0, with `client_request_id` when
 * given. `assignTo` also assigns it like `PATCH /filling-orders/:id/assign` (ASSIGNED, the driver and the
 * driver's van). `status` sets any other status as it is (a fixture: no lines are made).
 */
export async function createRefill(
  opts: {
    distributor: ShopRef;
    cylinderTypeId: string;
    requestedCount: number;
    station?: Pick<TestStation, 'id'>;
    assignTo?: Pick<TestDriver, 'id' | 'vehicleId'>;
    status?: FillingOrderStatus;
    clientRequestId?: string;
    /** Inc 1 count steps, for a legacy-shaped refill. */
    legacyCounts?: { pickedUpEmptyCount?: number | null; filledCount?: number | null };
    createdAt?: Date;
  },
  db: Db = getTestPrisma(),
): Promise<TestRefill> {
  const station = opts.station ?? (await createStation({}, db));
  const [{ no }] = await db.$queryRaw<Array<{ no: number }>>`
    UPDATE distributors SET next_refill_no = next_refill_no + 1 WHERE id = ${opts.distributor.id}::uuid
    RETURNING next_refill_no - 1 AS no`;
  const assigned = opts.assignTo ?? null;
  if (assigned && !assigned.vehicleId) throw new Error('createRefill: the driver has no van');
  const status = opts.status ?? (assigned ? FillingOrderStatus.ASSIGNED : FillingOrderStatus.PENDING);
  const refill = await db.fillingOrder.create({
    data: {
      distributorId: opts.distributor.id,
      fillingStationId: station.id,
      cylinderTypeId: opts.cylinderTypeId,
      requestedCount: opts.requestedCount,
      pricePerCylinderPaisa: 0n,
      totalCostPaisa: 0n,
      pickupStoreId: opts.distributor.homeStoreId,
      refillNo: Number(no),
      clientRequestId: opts.clientRequestId ?? null,
      status,
      assignedDriverId: assigned?.id ?? null,
      assignedVehicleId: assigned?.vehicleId ?? null,
      pickedUpEmptyCount: opts.legacyCounts?.pickedUpEmptyCount ?? null,
      filledCount: opts.legacyCounts?.filledCount ?? null,
      cancelledAt: status === FillingOrderStatus.CANCELLED ? new Date() : null,
      completedAt: status === FillingOrderStatus.COMPLETED ? new Date() : null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
    select: { id: true },
  });
  return {
    id: refill.id,
    refillNo: Number(no),
    shortCode: formatNo(opts.distributor.code, 'REFILL', Number(no)),
    distributorId: opts.distributor.id,
    homeStoreId: opts.distributor.homeStoreId,
    cylinderTypeId: opts.cylinderTypeId,
    requestedCount: opts.requestedCount,
    vehicleId: assigned?.vehicleId ?? null,
    driverId: assigned?.id ?? null,
  };
}

/** Sets a refill's status as "Leave store" (EMPTIES_PICKED), the first fill (AT_STATION) or "Leave station" (FILLED) do. */
export async function advanceRefill(refill: Pick<TestRefill, 'id'>, to: FillingOrderStatus, db: Db = getTestPrisma()): Promise<void> {
  await db.fillingOrder.update({ where: { id: refill.id }, data: { status: to } });
}

async function cylinderNow(cylinderId: string, db: Db) {
  return db.cylinder.findUniqueOrThrow({ where: { id: cylinderId }, select: { custodyType: true, custodyId: true, state: true } });
}

// ---------- the scan steps ----------

/**
 * PICKUP scans: each cylinder (EMPTY or PART_FILLED, in the home store) goes onto the refill's van
 * (SCAN_OUT with `filling_order_id`, no trip), with a PICKED_UP line. The first pickup stamps
 * `picked_up_at`. Returns the event ids.
 */
export async function pickUpForRefill(
  opts: { refill: TestRefill; driver: Pick<TestDriver, 'userId'>; cylinders: Array<Pick<TestCylinder, 'id'>>; at?: Date },
  db: Db = getTestPrisma(),
): Promise<string[]> {
  if (!opts.refill.vehicleId) throw new Error('pickUpForRefill: assign the refill first (createRefill assignTo)');
  const events: string[] = [];
  for (const cylinder of opts.cylinders) {
    const now = await cylinderNow(cylinder.id, db);
    if (now.custodyType !== CustodyType.STORE || now.custodyId !== opts.refill.homeStoreId) {
      throw new Error(`pickUpForRefill: cylinder ${cylinder.id} is not in the home store`);
    }
    if (now.state !== CylinderState.EMPTY && now.state !== CylinderState.PART_FILLED) {
      throw new Error(`pickUpForRefill: cylinder ${cylinder.id} is ${now.state}, not EMPTY or PART_FILLED`);
    }
    const eventId = await recordMove(
      {
        cylinderId: cylinder.id,
        eventType: CylinderEventType.SCAN_OUT,
        actorUserId: opts.driver.userId,
        from: { type: CustodyType.STORE, id: opts.refill.homeStoreId },
        to: { type: CustodyType.VEHICLE, id: opts.refill.vehicleId },
        fromState: now.state,
        toState: now.state,
        clientScanId: randomUUID(),
        at: opts.at,
      },
      db,
    );
    await db.cylinderEvent.update({ where: { id: eventId }, data: { fillingOrderId: opts.refill.id } });
    await db.fillingOrderCylinder.create({
      data: {
        fillingOrderId: opts.refill.id,
        cylinderId: cylinder.id,
        status: FillingOrderCylinderStatus.PICKED_UP,
        stateAtPickup: now.state,
        ...(opts.at ? { pickedUpAt: opts.at } : {}),
      },
    });
    events.push(eventId);
  }
  if (opts.cylinders.length > 0) {
    await db.$executeRaw`
      UPDATE filling_orders SET picked_up_at = COALESCE(picked_up_at, ${opts.at ?? null}::timestamp, ${NOW_UTC})
      WHERE id = ${opts.refill.id}::uuid`;
  }
  return events;
}

/**
 * FILL scans at the station: each picked cylinder (still on the refill's van) gets a FILLED event (the
 * van keeps it, the state is unchanged) and its line `filled_at` (status FILLED). The first fill on an
 * EMPTIES_PICKED refill makes it AT_STATION. Returns the event ids.
 */
export async function fillForRefill(
  opts: { refill: TestRefill; driver: Pick<TestDriver, 'userId'>; cylinders: Array<Pick<TestCylinder, 'id'>>; at?: Date },
  db: Db = getTestPrisma(),
): Promise<string[]> {
  const events: string[] = [];
  for (const cylinder of opts.cylinders) {
    const line = await db.fillingOrderCylinder.findUnique({
      where: { fillingOrderId_cylinderId: { fillingOrderId: opts.refill.id, cylinderId: cylinder.id } },
    });
    if (!line || line.status !== FillingOrderCylinderStatus.PICKED_UP) {
      throw new Error(`fillForRefill: cylinder ${cylinder.id} has no PICKED_UP line on this refill`);
    }
    const now = await cylinderNow(cylinder.id, db);
    const eventId = await recordMove(
      {
        cylinderId: cylinder.id,
        eventType: CylinderEventType.FILLED,
        actorUserId: opts.driver.userId,
        from: { type: now.custodyType, id: now.custodyId },
        to: { type: now.custodyType, id: now.custodyId },
        fromState: now.state,
        toState: now.state,
        clientScanId: randomUUID(),
        at: opts.at,
      },
      db,
    );
    await db.cylinderEvent.update({ where: { id: eventId }, data: { fillingOrderId: opts.refill.id } });
    await db.fillingOrderCylinder.update({
      where: { id: line.id },
      data: { status: FillingOrderCylinderStatus.FILLED, filledAt: opts.at ?? new Date() },
    });
    events.push(eventId);
  }
  if (opts.cylinders.length > 0) {
    await db.fillingOrder.updateMany({
      where: { id: opts.refill.id, status: FillingOrderStatus.EMPTIES_PICKED },
      data: { status: FillingOrderStatus.AT_STATION },
    });
  }
  return events;
}

/**
 * The store's RECEIVE of refill cylinders (`POST /store/scans`): each cylinder on the refill's van goes
 * into the home store (SCAN_IN with `filling_order_id`), FULL when its line was filled, else as it was;
 * the line becomes RETURNED. When no picked line is left un-received, the refill becomes COMPLETED
 * (`completed_at`). Returns `{ events, completed }`.
 */
export async function receiveForRefill(
  opts: { refill: TestRefill; shop: Pick<TestDistributor, 'userId'>; cylinders: Array<Pick<TestCylinder, 'id'>>; at?: Date },
  db: Db = getTestPrisma(),
): Promise<{ events: string[]; completed: boolean }> {
  const events: string[] = [];
  for (const cylinder of opts.cylinders) {
    const line = await db.fillingOrderCylinder.findUnique({
      where: { fillingOrderId_cylinderId: { fillingOrderId: opts.refill.id, cylinderId: cylinder.id } },
    });
    if (!line || line.status === FillingOrderCylinderStatus.RETURNED) {
      throw new Error(`receiveForRefill: cylinder ${cylinder.id} has no open line on this refill`);
    }
    const now = await cylinderNow(cylinder.id, db);
    if (now.custodyType !== CustodyType.VEHICLE) throw new Error(`receiveForRefill: cylinder ${cylinder.id} is not on a van`);
    const filled = line.filledAt !== null;
    const eventId = await recordMove(
      {
        cylinderId: cylinder.id,
        eventType: CylinderEventType.SCAN_IN,
        actorUserId: opts.shop.userId,
        from: { type: CustodyType.VEHICLE, id: now.custodyId },
        to: { type: CustodyType.STORE, id: opts.refill.homeStoreId },
        fromState: now.state,
        toState: filled && now.state !== CylinderState.FAULTY && now.state !== CylinderState.LOST ? CylinderState.FULL : now.state,
        clientScanId: randomUUID(),
        at: opts.at,
      },
      db,
    );
    await db.cylinderEvent.update({ where: { id: eventId }, data: { fillingOrderId: opts.refill.id } });
    await db.fillingOrderCylinder.update({
      where: { id: line.id },
      data: { status: FillingOrderCylinderStatus.RETURNED, returnedAt: opts.at ?? new Date() },
    });
    events.push(eventId);
  }
  const open = await db.fillingOrderCylinder.count({
    where: { fillingOrderId: opts.refill.id, status: { not: FillingOrderCylinderStatus.RETURNED } },
  });
  const picked = await db.fillingOrderCylinder.count({ where: { fillingOrderId: opts.refill.id } });
  let completed = false;
  if (picked > 0 && open === 0) {
    const done = await db.fillingOrder.updateMany({
      where: { id: opts.refill.id, status: { notIn: [FillingOrderStatus.COMPLETED, FillingOrderStatus.CANCELLED] } },
      data: { status: FillingOrderStatus.COMPLETED, completedAt: opts.at ?? new Date() },
    });
    completed = done.count === 1;
  }
  return { events, completed };
}

/** Cancels a refill as its owner does before pickup (CANCELLED, `cancelled_at`, the reason). No money. */
export async function cancelRefill(
  refill: Pick<TestRefill, 'id'>,
  opts: { by: MoveActor; reason?: string },
  db: Db = getTestPrisma(),
): Promise<void> {
  await db.fillingOrder.update({
    where: { id: refill.id },
    data: {
      status: FillingOrderStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledByUserId: actorId(opts.by),
      cancellationReason: opts.reason ?? 'Test cancel',
    },
  });
}

// ---------- readers ----------

/** A refill's lines, oldest pickup first. */
export async function refillLines(refillId: string, db: Db = getTestPrisma()) {
  return db.fillingOrderCylinder.findMany({ where: { fillingOrderId: refillId }, orderBy: [{ pickedUpAt: 'asc' }, { id: 'asc' }] });
}

/** A refill's counts from its lines, as Inc 3 counts them: picked, filled, received. */
export async function refillCountsOf(refillId: string, db: Db = getTestPrisma()) {
  const [refill, lines] = await Promise.all([
    db.fillingOrder.findUniqueOrThrow({ where: { id: refillId }, select: { requestedCount: true, status: true } }),
    refillLines(refillId, db),
  ]);
  return {
    status: refill.status,
    requested: refill.requestedCount,
    picked: lines.length,
    filled: lines.filter((line) => line.filledAt !== null).length,
    received: lines.filter((line) => line.status === FillingOrderCylinderStatus.RETURNED).length,
  };
}

/** The cylinder events of a refill (pickups, fills, receives), oldest first. */
export async function refillEvents(refillId: string, db: Db = getTestPrisma()) {
  return db.cylinderEvent.findMany({ where: { fillingOrderId: refillId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** Whether a cylinder is on an open refill line (PICKED_UP or FILLED, refill not COMPLETED or CANCELLED). */
export async function onOpenRefillLine(cylinderId: string, db: Db = getTestPrisma()): Promise<boolean> {
  const line = await db.fillingOrderCylinder.findFirst({
    where: {
      cylinderId,
      status: { in: [FillingOrderCylinderStatus.PICKED_UP, FillingOrderCylinderStatus.FILLED] },
      fillingOrder: { status: { notIn: [FillingOrderStatus.COMPLETED, FillingOrderStatus.CANCELLED] } },
    },
    select: { id: true },
  });
  return line !== null;
}

