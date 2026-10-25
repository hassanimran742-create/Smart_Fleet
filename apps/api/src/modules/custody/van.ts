import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import type { CylinderStateValue, VanCounts, VanCylinderCame } from '@smartfleet/shared-types';
import { AppError } from '../../common/errors/app-error';
import { formatNo } from '@smartfleet/shared-utils';
import { orderShortCode } from '../orders/orders.mapper';
import type { Db } from '../orders/support/tx';
import { openRefillLineCylinderIds } from './custody-moves';
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
   * after loading, more than the run needs, or left on the van from an earlier run. REFILL [Inc 3]: on an
   * open refill line (picked up for a refill and not yet received).
   */
  came: VanCylinderCame;
  /** For a taken-back cylinder: the customer and the order it came back from. */
  from: { clientName: string; orderShortCode: string } | null;
  /** [Inc 3] For a refill cylinder: the refill's number (AG-R007). */
  refill: { shortCode: string } | null;
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
  /** The last move's from-holder and state after it: an approved "Missing" fix is ADJUSTED from this van to LOST. */
  event_from_type: CustodyType | null;
  event_from_id: string | null;
  event_to_state: CylinderState | null;
}

/**
 * [review23 holder-scans-05] A cylinder an approved day-end fix marked LOST while it was on this van, with
 * no move since: its last move is that fix (ADJUSTED from this van, to LOST). MARK_LOST keeps the holder
 * (§10.2), so it stays on the van's record (`VanCounts.total`, My van: "Lost"), but nobody can scan it in:
 * it is in no place of the day-end summary, and it doesn't keep the van "not empty" (`TRIP_VAN_NOT_EMPTY`,
 * the 03:00 check, `VEHICLE_HAS_CYLINDERS`, `GET /store/incoming`). Any later move (a take-back keeps LOST,
 * §9.2 step 9; a receive) is a real move, and the cylinder counts again.
 */
function lostThere(row: Pick<VanRow, 'state' | 'event_type' | 'event_from_type' | 'event_from_id' | 'event_to_state'>, vehicleId: string): boolean {
  return (
    row.state === CylinderState.LOST &&
    row.event_type === CylinderEventType.ADJUSTED &&
    row.event_to_state === CylinderState.LOST &&
    row.event_from_type === CustodyType.VEHICLE &&
    row.event_from_id === vehicleId
  );
}

/**
 * Every cylinder on a van, with its `came` (API_CONTRACT §9.3). `perspectiveTripId` is the run being
 * finished: a cylinder loaded on another run is a SPARE from its point of view, except one another open
 * run of this van is taking to its customers (out for delivery, as `GET /store/incoming` leaves it out,
 * §9.13), which isn't this run's at all; a cylinder on an open refill line isn't the run's either (Inc 3,
 * §10.1: it doesn't block "Finish trip"). Both are left out. Without it (the store's incoming list) a loaded
 * cylinder is judged against its own run, and a refill cylinder is listed as REFILL with its refill. A
 * cylinder marked lost on the van ({@link lostThere}) is left out either way. `distributorId` keeps one
 * owner's.
 */
export async function vanCylinders(
  db: Db,
  vehicleId: string,
  opts: { perspectiveTripId?: string; distributorId?: string } = {},
): Promise<VanCylinder[]> {
  const rows = await db.$queryRaw<VanRow[]>`
    SELECT c.id, c.qr_code, c.short_no, c.distributor_id, d.code AS distributor_code, c.cylinder_type_id, c.state,
           e.event_type, e.trip_id, e.order_id, e.created_at AS event_at,
           e.from_custody_type AS event_from_type, e.from_custody_id AS event_from_id, e.to_state AS event_to_state
    FROM cylinders c
    JOIN distributors d ON d.id = c.distributor_id
    LEFT JOIN cylinder_events e ON e.id = c.last_event_id
    WHERE c.custody_type = 'VEHICLE' AND c.custody_id = ${vehicleId}::uuid
    ORDER BY e.created_at ASC NULLS FIRST, c.id`;
  const owned = (opts.distributorId ? rows.filter((row) => row.distributor_id === opts.distributorId) : rows).filter(
    (row) => !lostThere(row, vehicleId),
  );
  const refills = await openRefillLineCylinderIds(db, { cylinderIds: owned.map((row) => row.id) });
  let mine = opts.perspectiveTripId ? owned.filter((row) => !refills.has(row.id)) : owned;
  if (opts.perspectiveTripId && mine.some((row) => isLoadOfAnotherRun(row, opts.perspectiveTripId as string))) {
    // [review23 holder-scans-02] Another open run's loads its customers still need are that run's, not
    // this run's: they are out for delivery, as the shop's incoming list says. Beyond what that run still
    // needs (its order cancelled or failed), they are spares from here too.
    const out = await outForDeliveryNeed(db, vehicleId);
    mine = mine.filter((row) => {
      if (!isLoadOfAnotherRun(row, opts.perspectiveTripId as string)) return true;
      const key = `${row.trip_id}:${row.cylinder_type_id}`;
      const owed = out.get(key) ?? 0;
      if (owed <= 0) return true;
      out.set(key, owed - 1);
      return false;
    });
  }
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
    let refill: VanCylinder['refill'] = null;
    const onRefill = refills.get(row.id);
    if (onRefill) {
      came = 'REFILL';
      if (onRefill.refillNo !== null) refill = { shortCode: formatNo(row.distributor_code, 'REFILL', onRefill.refillNo) };
    } else if (row.event_type === CylinderEventType.PICKED_UP_EMPTY) {
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
      refill,
      tripId: row.trip_id,
      since: row.event_at,
    };
  });
}

/** A trip LOAD (SCAN_OUT with a trip) of a run other than `tripId`; a refill pickup has no trip. */
function isLoadOfAnotherRun(row: Pick<VanRow, 'event_type' | 'trip_id'>, tripId: string): boolean {
  return row.event_type === CylinderEventType.SCAN_OUT && !!row.trip_id && row.trip_id !== tripId;
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

/**
 * Per run and size, the cylinders a van carries to customers (out for delivery, §9.13): Σ fullCount −
 * given over the orders of its open runs (PLANNED or IN_PROGRESS) still to be delivered (ASSIGNED or
 * IN_TRANSIT). Key `${tripId}:${cylinderTypeId}`. The shop's incoming list and a run's own view of its van
 * both leave these out.
 */
export async function outForDeliveryNeed(db: Db, vehicleId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ trip_id: string; type_id: string; owed: number }>>`
    SELECT o.trip_id, ol.cylinder_type_id AS type_id,
           SUM(GREATEST(ol.full_count - COALESCE((
             SELECT count(*) FROM stop_cylinders sc
             WHERE sc.order_id = o.id AND sc.cylinder_type_id = ol.cylinder_type_id AND sc.direction = 'GIVEN'), 0), 0))::int AS owed
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    JOIN trips t ON t.id = o.trip_id
    WHERE t.vehicle_id = ${vehicleId}::uuid AND t.status IN ('PLANNED', 'IN_PROGRESS')
      AND o.status IN ('ASSIGNED', 'IN_TRANSIT')
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
 * The cylinders that keep a van "not empty": every cylinder it holds, any owner and any state, except one
 * an approved day-end fix marked lost there with no move since ({@link lostThere}); with
 * `leaveOutRefillLines`, also except those on an open refill line (the 03:00 van check, §9.9). The
 * driver-change guard counts refill cylinders (§10.5).
 */
export async function cylindersKeepingVanLoaded(db: Db, vehicleId: string, opts: { leaveOutRefillLines: boolean }): Promise<number> {
  const rows = await db.$queryRaw<Array<Pick<VanRow, 'id' | 'state' | 'event_type' | 'event_from_type' | 'event_from_id' | 'event_to_state'>>>`
    SELECT c.id, c.state, e.event_type, e.from_custody_type AS event_from_type, e.from_custody_id AS event_from_id, e.to_state AS event_to_state
    FROM cylinders c
    LEFT JOIN cylinder_events e ON e.id = c.last_event_id
    WHERE c.custody_type = 'VEHICLE' AND c.custody_id = ${vehicleId}::uuid`;
  const counted = rows.filter((row) => !lostThere(row, vehicleId));
  if (!opts.leaveOutRefillLines || counted.length === 0) return counted.length;
  const refills = await openRefillLineCylinderIds(db, { cylinderIds: counted.map((row) => row.id) });
  return counted.filter((row) => !refills.has(row.id)).length;
}

/**
 * `PATCH /drivers/:id/vehicle` (API_CONTRACT §9.5): a van's driver can't change while the van holds any
 * cylinder (refill cylinders included; one marked lost there doesn't count, {@link lostThere}), so the store
 * scans everything in first. Pass every van whose driver the change would move (the driver's current van,
 * and the van taken from another driver); the first loaded one answers 409 VEHICLE_HAS_CYLINDERS `{count}`.
 * For the drivers module, inside its transaction after it locks the driver rows.
 */
export async function assertVansEmptyForDriverChange(db: Db, vehicleIds: readonly (string | null | undefined)[]): Promise<void> {
  for (const vehicleId of vehicleIds) {
    if (!vehicleId) continue;
    const count = await cylindersKeepingVanLoaded(db, vehicleId, { leaveOutRefillLines: false });
    if (count > 0) throw new AppError('VEHICLE_HAS_CYLINDERS', { count });
  }
}
