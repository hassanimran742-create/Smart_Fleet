import { TripStopStatus, TripStopType } from '@prisma/client';
import type { ReturnState, StopProgress, StopProgressLine } from '@smartfleet/shared-types';
import type { Db } from '../orders/support/tx';
import { sizeLabels } from './holders';

/** The STORE_PICKUP half of {@link StopProgress}. */
export type PickupProgress = Extract<StopProgress, { type: 'STORE_PICKUP' }>;
/** The DELIVERY half of {@link StopProgress}. */
export type DeliveryProgress = Extract<StopProgress, { type: 'DELIVERY' }>;

const OPEN_STOP: readonly string[] = [TripStopStatus.PENDING, TripStopStatus.ARRIVED];
const OPEN_TRIP: readonly string[] = ['PLANNED', 'IN_PROGRESS'];

/** What progress needs of a trip. */
export interface ProgressTrip {
  id: string;
  vehicleId: string;
  status: string;
}

/** What progress needs of a stop. */
export interface ProgressStop {
  id: string;
  type: TripStopType;
  status: string;
  orderId: string | null;
}

function byWeight(a: { weightKg: number; code: string }, b: { weightKg: number; code: string }): number {
  return a.weightKg - b.weightKg || a.code.localeCompare(b.code);
}

/**
 * The loads the trip's orders still need, per size (API_CONTRACT §9.3): `needed` is Σ fullCount of the
 * trip's orders that aren't CANCELLED or FAILED; `done` counts the cylinders whose latest LOAD is on this
 * trip and that haven't gone back into a store since: on the trip's van with that LOAD as their last
 * move, or handed over on this trip. LOAD events themselves aren't counted, so a cylinder the store took
 * back off the van no longer counts, and spares never exceed what is needed in `doneCount`.
 *
 * "Handed over on this trip" is every GIVEN row of the trip's visits, whichever holder the cylinder left:
 * after a forgotten IN the office's manual delivery may hand a cylinder straight from the home store
 * (§9.5). That order's need is met on this trip, so "Done loading" (and with it "Finish trip") can still
 * close the run (API_CONTRACT §9.12).
 */
export async function pickupProgress(db: Db, trip: ProgressTrip): Promise<PickupProgress> {
  const [needed, onVan, handedOver] = await Promise.all([
    db.$queryRaw<Array<{ type_id: string; n: number }>>`
      SELECT ol.cylinder_type_id AS type_id, SUM(ol.full_count)::int AS n
      FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.trip_id = ${trip.id}::uuid AND o.status NOT IN ('CANCELLED', 'FAILED')
      GROUP BY ol.cylinder_type_id`,
    db.$queryRaw<Array<{ type_id: string; n: number }>>`
      SELECT c.cylinder_type_id AS type_id, count(*)::int AS n
      FROM cylinders c JOIN cylinder_events e ON e.id = c.last_event_id
      WHERE c.custody_type = 'VEHICLE' AND c.custody_id = ${trip.vehicleId}::uuid
        AND e.event_type = 'SCAN_OUT' AND e.trip_id = ${trip.id}::uuid
      GROUP BY c.cylinder_type_id`,
    db.$queryRaw<Array<{ type_id: string; n: number }>>`
      SELECT sc.cylinder_type_id AS type_id, count(*)::int AS n
      FROM stop_cylinders sc
      JOIN trip_stops ts ON ts.id = sc.trip_stop_id
      JOIN cylinder_events e ON e.id = sc.event_id
      WHERE ts.trip_id = ${trip.id}::uuid AND sc.direction = 'GIVEN'
        AND NOT EXISTS (
          SELECT 1 FROM cylinder_events s
          WHERE s.cylinder_id = sc.cylinder_id AND s.to_custody_type = 'STORE' AND s.created_at > e.created_at)
      GROUP BY sc.cylinder_type_id`,
  ]);
  const need = new Map(needed.map((row) => [row.type_id, Number(row.n)]));
  const done = new Map<string, number>();
  for (const row of [...onVan, ...handedOver]) done.set(row.type_id, (done.get(row.type_id) ?? 0) + Number(row.n));
  const typeIds = [...new Set([...need.keys(), ...done.keys()])];
  const sizes = await sizeLabels(db, typeIds);
  const lines: StopProgressLine[] = typeIds
    .filter((id) => (need.get(id) ?? 0) > 0 || (done.get(id) ?? 0) > 0)
    .sort((a, b) => byWeight(sizes.get(a) ?? { weightKg: 0, code: a }, sizes.get(b) ?? { weightKg: 0, code: b }))
    .map((id) => ({ cylinderTypeId: id, sizeLabel: sizes.get(id)?.label ?? '', needed: need.get(id) ?? 0, done: done.get(id) ?? 0 }));
  const neededCount = lines.reduce((sum, line) => sum + line.needed, 0);
  const doneCount = lines.reduce((sum, line) => sum + Math.min(line.done, line.needed), 0);
  return { type: 'STORE_PICKUP', lines, doneCount, neededCount, complete: lines.every((line) => line.done >= line.needed) };
}

/**
 * A visit's two lists (API_CONTRACT §9.3): what is given against the order's lines, and what was taken
 * back: labelled cylinders with the tapped state (`items[].state` is the tap, never the cylinder's own
 * state) plus the unlabelled counts. `canFinish` needs every size given and the visit still open; the
 * short take-back isn't a blocker, because "Finish visit" asks why instead.
 */
export async function deliveryProgress(db: Db, trip: ProgressTrip, stop: ProgressStop): Promise<DeliveryProgress> {
  const orderId = stop.orderId;
  const [lines, rows, unlabelled] = await Promise.all([
    orderId
      ? db.orderLine.findMany({ where: { orderId }, select: { cylinderTypeId: true, fullCount: true, expectedReturnCount: true } })
      : Promise.resolve([]),
    db.stopCylinder.findMany({
      where: { tripStopId: stop.id },
      select: { cylinderTypeId: true, direction: true, returnState: true, cylinder: { select: { qrCode: true, shortNo: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.stopUnlabelledReturn.findMany({ where: { tripStopId: stop.id }, select: { cylinderTypeId: true, state: true, count: true } }),
  ]);
  const sizes = await sizeLabels(db, [...lines.map((l) => l.cylinderTypeId), ...rows.map((r) => r.cylinderTypeId), ...unlabelled.map((u) => u.cylinderTypeId)]);
  const label = (id: string) => sizes.get(id)?.label ?? '';
  const given = new Map<string, number>();
  for (const row of rows) if (row.direction === 'GIVEN') given.set(row.cylinderTypeId, (given.get(row.cylinderTypeId) ?? 0) + 1);

  const giveLines: StopProgressLine[] = lines
    .map((line) => ({ cylinderTypeId: line.cylinderTypeId, sizeLabel: label(line.cylinderTypeId), needed: line.fullCount, done: given.get(line.cylinderTypeId) ?? 0 }))
    .sort((a, b) => byWeight(sizes.get(a.cylinderTypeId) ?? { weightKg: 0, code: '' }, sizes.get(b.cylinderTypeId) ?? { weightKg: 0, code: '' }));
  const neededCount = giveLines.reduce((sum, line) => sum + line.needed, 0);
  const doneCount = giveLines.reduce((sum, line) => sum + Math.min(line.done, line.needed), 0);
  const giveComplete = giveLines.every((line) => line.done >= line.needed);

  const items = rows
    .filter((row) => row.direction === 'TAKEN_BACK')
    .map((row) => ({
      code: row.cylinder.qrCode,
      shortNo: row.cylinder.shortNo,
      sizeLabel: label(row.cylinderTypeId),
      state: (row.returnState ?? 'EMPTY') as ReturnState,
    }));
  const unlabelledRows = unlabelled.map((row) => ({
    cylinderTypeId: row.cylinderTypeId,
    sizeLabel: label(row.cylinderTypeId),
    state: row.state as ReturnState,
    count: row.count,
  }));
  const byState: Record<ReturnState, number> = { EMPTY: 0, PART_FILLED: 0, FULL: 0 };
  for (const item of items) byState[item.state] += 1;
  for (const row of unlabelledRows) byState[row.state] += row.count;
  const count = items.length + unlabelledRows.reduce((sum, row) => sum + row.count, 0);
  const expected = lines.reduce((sum, line) => sum + line.expectedReturnCount, 0);

  const missing = giveLines.filter((line) => line.done < line.needed).map((line) => ({ sizeLabel: line.sizeLabel, needed: line.needed, given: line.done }));
  const open = OPEN_STOP.includes(stop.status) && OPEN_TRIP.includes(trip.status);
  return {
    type: 'DELIVERY',
    give: { lines: giveLines, doneCount, neededCount, complete: giveComplete },
    takeBack: { expected, count, byState, items, unlabelled: unlabelledRows },
    canFinish: open && giveComplete,
    blockers: missing.length ? [{ code: 'DELIVERY_SCANS_INCOMPLETE', details: { missing } }] : [],
  };
}

/**
 * [Inc 2] The load so far of several trips at once (`OrderDto.load`, the office board's "Loading · 3 of 5
 * loaded"): per trip, `done` and `total` are {@link pickupProgress}'s `doneCount` and `neededCount`, read
 * in three queries for every trip instead of three per trip.
 */
export async function pickupCounts(db: Db, tripIds: readonly string[]): Promise<Map<string, { done: number; total: number }>> {
  const ids = [...new Set(tripIds)];
  if (ids.length === 0) return new Map();
  const [needed, onVan, handedOver] = await Promise.all([
    db.$queryRaw<Array<{ trip_id: string; type_id: string; n: number }>>`
      SELECT o.trip_id, ol.cylinder_type_id AS type_id, SUM(ol.full_count)::int AS n
      FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.trip_id = ANY(${ids}::uuid[]) AND o.status NOT IN ('CANCELLED', 'FAILED')
      GROUP BY o.trip_id, ol.cylinder_type_id`,
    db.$queryRaw<Array<{ trip_id: string; type_id: string; n: number }>>`
      SELECT e.trip_id, c.cylinder_type_id AS type_id, count(*)::int AS n
      FROM cylinders c
      JOIN cylinder_events e ON e.id = c.last_event_id
      JOIN trips t ON t.id = e.trip_id
      WHERE e.trip_id = ANY(${ids}::uuid[]) AND e.event_type = 'SCAN_OUT'
        AND c.custody_type = 'VEHICLE' AND c.custody_id = t.vehicle_id
      GROUP BY e.trip_id, c.cylinder_type_id`,
    db.$queryRaw<Array<{ trip_id: string; type_id: string; n: number }>>`
      SELECT ts.trip_id, sc.cylinder_type_id AS type_id, count(*)::int AS n
      FROM stop_cylinders sc
      JOIN trip_stops ts ON ts.id = sc.trip_stop_id
      JOIN cylinder_events e ON e.id = sc.event_id
      WHERE ts.trip_id = ANY(${ids}::uuid[]) AND sc.direction = 'GIVEN'
        AND NOT EXISTS (
          SELECT 1 FROM cylinder_events s
          WHERE s.cylinder_id = sc.cylinder_id AND s.to_custody_type = 'STORE' AND s.created_at > e.created_at)
      GROUP BY ts.trip_id, sc.cylinder_type_id`,
  ]);
  const need = new Map<string, Map<string, number>>();
  for (const row of needed) {
    const byType = need.get(row.trip_id) ?? new Map<string, number>();
    byType.set(row.type_id, (byType.get(row.type_id) ?? 0) + Number(row.n));
    need.set(row.trip_id, byType);
  }
  const done = new Map<string, Map<string, number>>();
  for (const row of [...onVan, ...handedOver]) {
    const byType = done.get(row.trip_id) ?? new Map<string, number>();
    byType.set(row.type_id, (byType.get(row.type_id) ?? 0) + Number(row.n));
    done.set(row.trip_id, byType);
  }
  const out = new Map<string, { done: number; total: number }>();
  for (const tripId of ids) {
    const needs = need.get(tripId) ?? new Map<string, number>();
    const dones = done.get(tripId) ?? new Map<string, number>();
    let total = 0;
    let doneCount = 0;
    for (const [typeId, n] of needs) {
      total += n;
      doneCount += Math.min(dones.get(typeId) ?? 0, n);
    }
    out.set(tripId, { done: doneCount, total });
  }
  return out;
}

/** The progress of any stop; null for a RETURN_DROPOFF stop. */
export async function stopProgress(db: Db, trip: ProgressTrip, stop: ProgressStop): Promise<StopProgress | null> {
  if (stop.type === TripStopType.STORE_PICKUP) return pickupProgress(db, trip);
  if (stop.type === TripStopType.DELIVERY) return deliveryProgress(db, trip, stop);
  return null;
}
