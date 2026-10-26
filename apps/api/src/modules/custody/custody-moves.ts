/**
 * [Inc 3] The custody module's extension points for the Increment 3 lanes (API_CONTRACT §5.1: holder and
 * state change only through the custody module; DATA_MODEL §4.5 steps 4–6). The refill scans (pickup,
 * fill, and the store's receive of a refill cylinder) and the day-end approval (ADJUSTED fixes) write their
 * moves with these, in their own transaction, after their own rule checks:
 *
 *   const cylinder = await lockCylinderForMove(tx, cylinderId);            // SELECT … FOR UPDATE
 *   const event = await recordCustodyMove(tx, {
 *     cylinder,
 *     eventType: CylinderEventType.SCAN_OUT,                               // a refill PICKUP: no trip
 *     to: { type: CustodyType.VEHICLE, id: refill.assignedVehicleId },
 *     toState: cylinder.state,
 *     source: CylinderEventSource.SCAN,
 *     actorUserId: actor.userId,
 *     clientScanId: cmd.scanId,
 *     fillingOrderId: refill.id,
 *   });
 *
 * `recordCustodyMove` is the same write as ScanService's (one `cylinder_events` row with holders, states,
 * source, reason and links; the cylinder's new holder, state and `last_event_id`; the legacy inventory
 * lots kept in step), plus `filling_order_id`. Lock rows in the scans' order (orders, trip, stop, then the
 * cylinder). A DAY_END_FIX or MANUAL move needs its reason (cylinder_events_reason_chk). No money, ever.
 *
 * `openRefillLineCylinderIds` is the one rule for "on an open refill line" (§9.3, §9.9, §10.1): such a
 * cylinder can't be picked up for another refill, isn't a leftover on a delivery van (`TRIP_VAN_NOT_EMPTY`,
 * the 03:00 van check) and shows as `came: REFILL` in `GET /store/incoming`.
 */
import {
  CustodyType,
  CylinderEventSource,
  CylinderState,
  FillingOrderCylinderStatus,
  FillingOrderStatus,
  Prisma,
  type CylinderEvent,
  type CylinderEventType,
} from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import type { Db, Tx } from '../orders/support/tx';
import { adjustInventoryLots } from './inventory-lots';

/** A cylinder row locked for a move (the columns every move rule reads). */
export interface LockedCylinderRow {
  id: string;
  distributor_id: string;
  cylinder_type_id: string;
  state: CylinderState;
  custody_type: CustodyType;
  custody_id: string;
  last_event_id: string | null;
  qr_code: string;
  short_no: number | null;
}

/** Locks one cylinder `FOR UPDATE` and reads it; an unknown id is SCAN_CYLINDER_UNKNOWN (as a scan answers). */
export async function lockCylinderForMove(tx: Tx, cylinderId: string): Promise<LockedCylinderRow> {
  const rows = await tx.$queryRaw<LockedCylinderRow[]>`
    SELECT id, distributor_id, cylinder_type_id, state, custody_type, custody_id, last_event_id, qr_code, short_no
    FROM cylinders WHERE id = ${cylinderId}::uuid FOR UPDATE`;
  if (!rows[0]) throw new AppError('SCAN_CYLINDER_UNKNOWN');
  return rows[0];
}

/** One move of a locked cylinder: where it goes, the state it gets, and how it was recorded. */
export interface CustodyMove {
  cylinder: LockedCylinderRow;
  eventType: CylinderEventType;
  /** The new holder; the same as now for a move that only changes the state (FILLED, SET_STATE, MARK_LOST). */
  to: { type: CustodyType; id: string };
  /** The state after the move. */
  toState: CylinderState;
  source: CylinderEventSource;
  actorUserId: string;
  /** Required unless the source is SCAN, TYPED or REGISTRATION (cylinder_events_reason_chk). */
  reason?: string | null;
  /** The app's scan id: a resend with the same (actor, scan id) is the same scan. */
  clientScanId?: string | null;
  tripId?: string | null;
  tripStopId?: string | null;
  orderId?: string | null;
  /** [Inc 3] The refill of a refill move. */
  fillingOrderId?: string | null;
  lat?: number;
  lng?: number;
}

/**
 * Writes one move (DATA_MODEL §4.5 steps 4–5): the event, the cylinder's holder, state and
 * `last_event_id`, and the legacy inventory lots. It checks no rule: the caller has. Returns the event.
 */
export async function recordCustodyMove(tx: Tx, move: CustodyMove): Promise<CylinderEvent> {
  const { cylinder } = move;
  if (!NO_REASON_NEEDED.includes(move.source) && !move.reason?.trim()) {
    throw new Error(`recordCustodyMove: a ${move.source} move needs its reason`);
  }
  const event = await tx.cylinderEvent.create({
    data: {
      cylinderId: cylinder.id,
      eventType: move.eventType,
      source: move.source,
      fromCustodyType: cylinder.custody_type,
      fromCustodyId: cylinder.custody_id,
      toCustodyType: move.to.type,
      toCustodyId: move.to.id,
      fromState: cylinder.state,
      toState: move.toState,
      reason: move.reason ?? null,
      actorUserId: move.actorUserId,
      clientScanId: move.clientScanId ?? null,
      tripId: move.tripId ?? null,
      tripStopId: move.tripStopId ?? null,
      orderId: move.orderId ?? null,
      fillingOrderId: move.fillingOrderId ?? null,
    },
  });
  if (move.lat !== undefined && move.lng !== undefined) {
    await tx.$executeRaw`
      UPDATE cylinder_events SET location = ST_SetSRID(ST_MakePoint(${move.lng}, ${move.lat}), 4326) WHERE id = ${event.id}::uuid`;
  }
  await tx.cylinder.update({
    where: { id: cylinder.id },
    data: { custodyType: move.to.type, custodyId: move.to.id, state: move.toState, lastEventId: event.id },
  });
  await adjustInventoryLots(tx, {
    distributorId: cylinder.distributor_id,
    cylinderTypeId: cylinder.cylinder_type_id,
    from: { holderType: cylinder.custody_type, holderId: cylinder.custody_id, state: cylinder.state },
    to: { holderType: move.to.type, holderId: move.to.id, state: move.toState },
  });
  return event;
}

const NO_REASON_NEEDED: CylinderEventSource[] = [CylinderEventSource.SCAN, CylinderEventSource.TYPED, CylinderEventSource.REGISTRATION];

/** The statuses of a refill line that still holds its cylinder (shared-types `OPEN_REFILL_LINE_STATUSES`). */
export const OPEN_REFILL_LINE: FillingOrderCylinderStatus[] = [FillingOrderCylinderStatus.PICKED_UP, FillingOrderCylinderStatus.FILLED];
/** Refill statuses after which no line is open any more. */
export const CLOSED_REFILL: FillingOrderStatus[] = [FillingOrderStatus.COMPLETED, FillingOrderStatus.CANCELLED];

/**
 * The cylinders on an open refill line (PICKED_UP or FILLED, of a refill that isn't COMPLETED or
 * CANCELLED), with their refill, among `cylinderIds` and/or on van `vehicleId`. A RETURNED line never
 * counts. Pass neither to get every open line.
 */
export async function openRefillLineCylinderIds(
  db: Db,
  p: { cylinderIds?: readonly string[]; vehicleId?: string } = {},
): Promise<Map<string, { fillingOrderId: string; refillNo: number | null }>> {
  if (p.cylinderIds && p.cylinderIds.length === 0) return new Map();
  const byCylinder = p.cylinderIds ? Prisma.sql`AND l.cylinder_id = ANY(${[...p.cylinderIds]}::uuid[])` : Prisma.empty;
  const onVan = p.vehicleId
    ? Prisma.sql`AND c.custody_type = 'VEHICLE' AND c.custody_id = ${p.vehicleId}::uuid`
    : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ cylinder_id: string; filling_order_id: string; refill_no: number | null }>>`
    SELECT l.cylinder_id, l.filling_order_id, f.refill_no
    FROM filling_order_cylinders l
    JOIN filling_orders f ON f.id = l.filling_order_id
    JOIN cylinders c ON c.id = l.cylinder_id
    WHERE l.status IN ('PICKED_UP', 'FILLED') AND f.status NOT IN ('COMPLETED', 'CANCELLED') ${byCylinder} ${onVan}`;
  return new Map(rows.map((row) => [row.cylinder_id, { fillingOrderId: row.filling_order_id, refillNo: row.refill_no === null ? null : Number(row.refill_no) }]));
}
