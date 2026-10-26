import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import type { Db } from '../orders/support/tx';

/** A run that can still put cylinders onto the van it was made with. */
export interface OpenRun {
  run: 'TRIP' | 'REFILL';
  id: string;
  vehicleId: string;
  plateNo: string;
  driverId: string;
  /** The run's driver's name, for the office's words. */
  driverName: string;
}

interface OpenRunRow {
  id: string;
  vehicle_id: string;
  plate_no: string;
  driver_id: string;
  driver_name: string;
}

/**
 * [review23 holder-scans-01, security-01] The first run a van change would leave on a van its driver no
 * longer drives, or on another driver's van. A run keeps the van it was made with: a trip's later scans go
 * onto `trips.vehicle_id` (§7.7), a refill's pickups onto `filling_orders.assigned_vehicle_id` (§10.1). So
 * these block the change (API_CONTRACT §9.5):
 * - a trip PLANNED or IN_PROGRESS with a stop still open (PENDING or ARRIVED): its loads and take-backs
 *   would land on that van. A trip whose stops are all closed can't move a cylinder any more;
 * - a refill ASSIGNED: its pickups would land on that van. Past "Leave store" a refill only fills (the
 *   holder stays) and comes back through the store.
 * Either on one of `vehicleIds` (the driver's current van and the new one), whoever drives it, or the
 * driver's own on any van (a run left on an old van, for example after an archive and a reactivation).
 * Null when there is none. Read inside the van change's transaction, after it locks the driver rows; the
 * assignments lock the driver row too (`FOR KEY SHARE`), so no new run can appear meanwhile.
 */
export async function openRunBlockingVanChange(
  db: Db,
  p: { driverId: string; vehicleIds: readonly (string | null | undefined)[] },
): Promise<OpenRun | null> {
  const vans = [...new Set(p.vehicleIds.filter((id): id is string => !!id))];
  const tripOnVan = vans.length ? Prisma.sql`t.vehicle_id = ANY(${vans}::uuid[]) OR` : Prisma.empty;
  const trips = await db.$queryRaw<OpenRunRow[]>`
    SELECT t.id, t.vehicle_id, v.plate_no, t.driver_id, u.name AS driver_name
    FROM trips t
    JOIN vehicles v ON v.id = t.vehicle_id
    JOIN drivers d ON d.id = t.driver_id
    JOIN users u ON u.id = d.user_id
    WHERE t.status IN ('PLANNED', 'IN_PROGRESS')
      AND (${tripOnVan} t.driver_id = ${p.driverId}::uuid)
      AND EXISTS (SELECT 1 FROM trip_stops s WHERE s.trip_id = t.id AND s.status IN ('PENDING', 'ARRIVED'))
    ORDER BY t.planned_at ASC, t.id ASC
    LIMIT 1`;
  if (trips[0]) return runOf('TRIP', trips[0]);
  const refillOnVan = vans.length ? Prisma.sql`f.assigned_vehicle_id = ANY(${vans}::uuid[]) OR` : Prisma.empty;
  const refills = await db.$queryRaw<OpenRunRow[]>`
    SELECT f.id, f.assigned_vehicle_id AS vehicle_id, v.plate_no, f.assigned_driver_id AS driver_id, u.name AS driver_name
    FROM filling_orders f
    JOIN vehicles v ON v.id = f.assigned_vehicle_id
    JOIN drivers d ON d.id = f.assigned_driver_id
    JOIN users u ON u.id = d.user_id
    WHERE f.status = 'ASSIGNED'
      AND (${refillOnVan} f.assigned_driver_id = ${p.driverId}::uuid)
    ORDER BY f.created_at ASC, f.id ASC
    LIMIT 1`;
  return refills[0] ? runOf('REFILL', refills[0]) : null;
}

function runOf(run: OpenRun['run'], row: OpenRunRow): OpenRun {
  return { run, id: row.id, vehicleId: row.vehicle_id, plateNo: row.plate_no, driverId: row.driver_id, driverName: row.driver_name };
}

/**
 * 409 DRIVER_HAS_OPEN_RUN `{ driver, plateNo, run }` (API_CONTRACT §2.3, §9.5): "Finish or reassign Kashif's
 * trip on LEA-101 first." `driver` and `plateNo` are the run's driver and van, `run` TRIP or REFILL.
 */
export function openRunRefusal(run: OpenRun): AppError<'DRIVER_HAS_OPEN_RUN'> {
  return new AppError('DRIVER_HAS_OPEN_RUN', { driver: run.driverName, plateNo: run.plateNo, run: run.run });
}
