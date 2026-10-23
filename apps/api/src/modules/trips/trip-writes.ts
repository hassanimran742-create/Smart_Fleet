import type { Tx } from '../orders/support/tx';

/**
 * Trip-row writes other steps cause, run inside their transaction. The trips module owns the table;
 * the order and scan steps call these instead of writing it themselves.
 */

/**
 * A PLANNED trip starts (IN_PROGRESS with `started_at`) on the first arrive, the first load scan or the
 * driver's Delivered tap. Only the trip changes: its orders move when the store stop departs (§8.1).
 */
export async function autoStartTrip(tx: Tx, tripId: string): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE trips SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, (now() AT TIME ZONE 'UTC'))
    WHERE id = ${tripId}::uuid AND status = 'PLANNED'`;
  return count > 0;
}

/**
 * Locks a trip row. A step on an order takes it after the order and before reading the trip's stops
 * and scans, so it sees every arrive, depart and scan that committed before it.
 */
export async function lockTripRow(tx: Tx, tripId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
}

/** True when anything was scanned on the trip: no office abort after that (§7.7). */
export async function tripHasScans(tx: Tx, tripId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ found: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM cylinder_events WHERE trip_id = ${tripId}::uuid) AS found`;
  return rows[0]?.found === true;
}

/**
 * True when a cylinder moved on the trip other than a hand-back at the store (SCAN_IN): a load, or a
 * cylinder given to or taken from a customer. After that an order can't change driver (§7.6 assign
 * rule 4, ADR-12) and the trip isn't aborted when its last open order goes (cancel step 6). A SCAN_IN of
 * empties left on the van from an earlier run loads nothing, so it blocks neither. A DELIVERED scan
 * needs no load on this trip in Inc 1 (a full left on the van), so it counts, as a SCAN_OUT does.
 */
export async function tripHasLoadOrHandover(tx: Tx, tripId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ found: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM cylinder_events WHERE trip_id = ${tripId}::uuid AND event_type <> 'SCAN_IN') AS found`;
  return rows[0]?.found === true;
}
