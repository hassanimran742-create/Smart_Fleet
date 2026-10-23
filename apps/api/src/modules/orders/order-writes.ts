import type { Tx } from './support/tx';

/**
 * The order-row writes that trip and scan steps cause (API_CONTRACT §7.7, DATA_MODEL §3.6). They live
 * with the orders module, which owns the table, and run inside the caller's transaction. Lock order is
 * always orders first, then the trip, then the cylinder, so a cancel, a reassignment, a stop step and a
 * scan racing on one order never deadlock and one of them wins.
 */

/** Locks every order on a trip, in id order (`SELECT … FOR UPDATE`). Returns their ids. */
export async function lockTripOrders(tx: Tx, tripId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM orders WHERE trip_id = ${tripId}::uuid ORDER BY id FOR UPDATE`;
  return rows.map((row) => row.id);
}

/** Locks one order row. False when there is no such order. */
export async function lockOrder(tx: Tx, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

/**
 * The first load scan on a trip stamps `load_started_at` on every open order of the trip, the refund
 * cut-off under the default rule (DATA_MODEL §3.6). Cancelled orders aren't counted, and the stamp is
 * never cleared. Call it under {@link lockTripOrders}.
 */
export async function stampLoadStarted(tx: Tx, tripId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE orders SET load_started_at = (now() AT TIME ZONE 'UTC'), updated_at = (now() AT TIME ZONE 'UTC')
    WHERE trip_id = ${tripId}::uuid AND load_started_at IS NULL
      AND status IN ('PENDING','CONFIRMED','ASSIGNED','IN_TRANSIT')`;
}

/**
 * Departing a trip's STORE_PICKUP stop puts its ASSIGNED orders on the way (IN_TRANSIT with
 * `on_the_way_at`). Starting a trip never does (§8.1).
 */
export async function markTripOrdersOnTheWay(tx: Tx, tripId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE orders SET status = 'IN_TRANSIT', on_the_way_at = COALESCE(on_the_way_at, (now() AT TIME ZONE 'UTC')), updated_at = (now() AT TIME ZONE 'UTC')
    WHERE trip_id = ${tripId}::uuid AND status = 'ASSIGNED'`;
}

/**
 * The office aborts a trip before anything happened on it: its ASSIGNED orders need a driver again,
 * PENDING with `trip_id` and `assigned_at` cleared (§7.7). Returns their ids.
 */
export async function releaseTripOrders(tx: Tx, tripId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE orders SET status = 'PENDING', trip_id = NULL, assigned_at = NULL, updated_at = (now() AT TIME ZONE 'UTC')
    WHERE trip_id = ${tripId}::uuid AND status = 'ASSIGNED'
    RETURNING id`;
  return rows.map((row) => row.id).sort();
}
