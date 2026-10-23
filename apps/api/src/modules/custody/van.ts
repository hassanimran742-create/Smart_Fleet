import { CylinderEventType, CylinderState } from '@prisma/client';
import type { CylinderStateValue, VanCounts, VanCylinderCame } from '@smartfleet/shared-types';
import { AppError } from '../../common/errors/app-error';
import { orderShortCode } from '../orders/orders.mapper';
import type { Db } from '../orders/support/tx';
import { cylinderShortCode } from './cylinder-codes';
import { sizeLabels } from './holders';

/** A cylinder on a van, and why it is there (API_CONTRACT §9.3 `TRIP_VAN_NOT_EMPTY`, §9.4 incoming). */
export interface VanCylinder {
  id: string;
  qrCode: string;
  shortNo: number | null;
  /** "AG-C0042"; the QR value for a cylinder without a short number. */
  shortCode: string;
  distributorId: string;
  cylinderTypeId: string;
  sizeLabel: string;
  state: CylinderStateValue;
  /**
   * TAKEN_BACK: its last move onto the van was a take-back. NOT_DELIVERED: loaded for an order of its
   * run that wasn't delivered (still open, or could not deliver). SPARE: loaded for an order cancelled
   * after loading, more than the run needs, or left on the van from an earlier run. REFILL is Inc 3.
   */
  came: VanCylinderCame;
  /** For a taken-back cylinder: the customer and the order it came back from. */
  from: { clientName: string; orderShortCode: string } | null;
  /** The run of its last move onto the van (a LOAD or a take-back), if any. */
  tripId: string | null;
  /** When it went onto the van. */
  since: Date | null;
}

interface VanRow {
  id: string;
  qr_code: string;
  short_no: number | null;
  distributor_id: string;
  distributor_code: string;
  cylinder_type_id: string;
  state: CylinderState;
  event_type: CylinderEventType | null;
  trip_id: string | null;
  order_id: string | null;
  event_at: Date | null;
}

/**
 * Every cylinder on a van, with its `came` (API_CONTRACT §9.3). `perspectiveTripId` is the run being
 * finished: a cylinder loaded on another run is a SPARE from its point of view. Without it (the store's
 * incoming list) a loaded cylinder is judged against its own run. `distributorId` keeps one owner's.
 */
export async function vanCylinders(
  db: Db,
  vehicleId: string,
  opts: { perspectiveTripId?: string; distributorId?: string } = {},
): Promise<VanCylinder[]> {
  const rows = await db.$queryRaw<VanRow[]>`
    SELECT c.id, c.qr_code, c.short_no, c.distributor_id, d.code AS distributor_code, c.cylinder_type_id, c.state,
           e.event_type, e.trip_id, e.order_id, e.created_at AS event_at
    FROM cylinders c
    JOIN distributors d ON d.id = c.distributor_id
    LEFT JOIN cylinder_events e ON e.id = c.last_event_id
    WHERE c.custody_type = 'VEHICLE' AND c.custody_id = ${vehicleId}::uuid
    ORDER BY e.created_at ASC NULLS FIRST, c.id`;
  const mine = opts.distributorId ? rows.filter((row) => row.distributor_id === opts.distributorId) : rows;
  if (mine.length === 0) return [];
  const sizes = await sizeLabels(db, mine.map((row) => row.cylinder_type_id));

  // What each run still owes its customers, per size: the not-delivered need (open or failed orders).
  const loadTrips = [
    ...new Set(
      mine
        .filter((row) => row.event_type === CylinderEventType.SCAN_OUT && row.trip_id)
        .map((row) => row.trip_id as string)
        .filter((tripId) => !opts.perspectiveTripId || tripId === opts.perspectiveTripId),
    ),
  ];
  const owed = await undeliveredNeed(db, loadTrips);

  // Where the taken-back ones came from.
  const backOrders = [...new Set(mine.filter((row) => row.event_type === CylinderEventType.PICKED_UP_EMPTY && row.order_id).map((row) => row.order_id as string))];
  const orders = backOrders.length
    ? await db.order.findMany({
        where: { id: { in: backOrders } },
        select: { id: true, orderNo: true, client: { select: { name: true } }, distributor: { select: { code: true } } },
      })
    : [];
  const orderById = new Map(orders.map((order) => [order.id, order]));

  return mine.map((row) => {
    let came: VanCylinderCame = 'SPARE';
    let from: VanCylinder['from'] = null;
    if (row.event_type === CylinderEventType.PICKED_UP_EMPTY) {
      came = 'TAKEN_BACK';
      const order = row.order_id ? orderById.get(row.order_id) : undefined;
      if (order) from = { clientName: order.client.name, orderShortCode: orderShortCode(order.distributor.code, order.orderNo) };
    } else if (row.event_type === CylinderEventType.SCAN_OUT && row.trip_id) {
      const key = `${row.trip_id}:${row.cylinder_type_id}`;
      const left = owed.get(key) ?? 0;
      if (left > 0 && (!opts.perspectiveTripId || row.trip_id === opts.perspectiveTripId)) {
        came = 'NOT_DELIVERED';
        owed.set(key, left - 1);
      }
    }
    return {
      id: row.id,
      qrCode: row.qr_code,
      shortNo: row.short_no,
      shortCode: cylinderShortCode(row.distributor_code, row.short_no) ?? row.qr_code,
      distributorId: row.distributor_id,
      cylinderTypeId: row.cylinder_type_id,
      sizeLabel: sizes.get(row.cylinder_type_id)?.label ?? '',
      state: row.state as CylinderStateValue,
      came,
      from,
      tripId: row.trip_id,
      since: row.event_at,
    };
  });
}

/**
 * Per run and size, how many loaded cylinders its orders still owe: Σ fullCount − given over the
 * orders that aren't DELIVERED or CANCELLED (an order that failed or is still open).
 */
async function undeliveredNeed(db: Db, tripIds: readonly string[]): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ trip_id: string; type_id: string; owed: number }>>`
    SELECT o.trip_id, ol.cylinder_type_id AS type_id,
           SUM(GREATEST(ol.full_count - COALESCE((
             SELECT count(*) FROM stop_cylinders sc
             WHERE sc.order_id = o.id AND sc.cylinder_type_id = ol.cylinder_type_id AND sc.direction = 'GIVEN'), 0), 0))::int AS owed
    FROM orders o JOIN order_lines ol ON ol.order_id = o.id
    WHERE o.trip_id = ANY(${[...tripIds]}::uuid[]) AND o.status IN ('ASSIGNED', 'IN_TRANSIT', 'FAILED')
    GROUP BY o.trip_id, ol.cylinder_type_id`;
  return new Map(rows.map((row) => [`${row.trip_id}:${row.type_id}`, Number(row.owed)]));
}

/** The cylinders on a van by state (UX_MOBILE §7.2); `total` counts every one, damaged or lost included. */
export async function vanCounts(db: Db, vehicleId: string | null | undefined): Promise<VanCounts> {
  const counts: VanCounts = { full: 0, empty: 0, partFilled: 0, total: 0 };
  if (!vehicleId) return counts;
  const rows = await db.cylinder.groupBy({
    by: ['state'],
    where: { custodyType: 'VEHICLE', custodyId: vehicleId },
    _count: { _all: true },
  });
  for (const row of rows) {
    const n = row._count._all;
    counts.total += n;
    if (row.state === CylinderState.FULL) counts.full += n;
    else if (row.state === CylinderState.EMPTY) counts.empty += n;
    else if (row.state === CylinderState.PART_FILLED) counts.partFilled += n;
  }
  return counts;
}

/** How many cylinders a van holds now, any owner and any state (Inc 3: refill cylinders included). */
export async function countCylindersOnVehicle(db: Db, vehicleId: string): Promise<number> {
  return db.cylinder.count({ where: { custodyType: 'VEHICLE', custodyId: vehicleId } });
}

/**
 * `PATCH /drivers/:id/vehicle` (API_CONTRACT §9.5): a van's driver can't change while the van holds any
 * cylinder (refill cylinders included), so the store scans everything in first. Pass every van whose
 * driver the change would move (the driver's current van, and the van taken from another driver); the
 * first loaded one answers 409 VEHICLE_HAS_CYLINDERS `{count}`. For the drivers module, inside its
 * transaction after it locks the driver row.
 */
export async function assertVansEmptyForDriverChange(db: Db, vehicleIds: readonly (string | null | undefined)[]): Promise<void> {
  for (const vehicleId of vehicleIds) {
    if (!vehicleId) continue;
    const count = await countCylindersOnVehicle(db, vehicleId);
    if (count > 0) throw new AppError('VEHICLE_HAS_CYLINDERS', { count });
  }
}
