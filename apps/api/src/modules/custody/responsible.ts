import { CustodyType } from '@prisma/client';
import type { Db } from '../orders/support/tx';

/** The driver responsible for a cylinder now (API_CONTRACT §9.2, G06-02). */
export interface ResponsibleDriver {
  userId: string;
  driverId: string | null;
  name: string;
  role: 'DRIVER';
}

/** One move, as the responsible-driver rule reads it. */
interface MoveRow {
  id: string;
  trip_id: string | null;
  actor_user_id: string;
  from_custody_type: CustodyType | null;
  from_custody_id: string | null;
  to_custody_type: CustodyType | null;
  to_custody_id: string | null;
  created_at: Date;
}

/**
 * True when the move changed the holder: its from-holder isn't its to-holder. A refill FILL (VEHICLE →
 * VEHICLE, no filling-station holder, ADR-13) and an approved day-end SET_STATE or MARK_LOST fix (ADJUSTED,
 * the holder unchanged) move nothing; a REGISTERED move has no from-holder, so it is one.
 */
export function changedHolder(move: {
  fromType: CustodyType | null;
  fromId: string | null;
  toType: CustodyType | null;
  toId: string | null;
}): boolean {
  return move.fromType !== move.toType || move.fromId !== move.toId;
}

/**
 * The driver of the trip of the newest move **onto** a van (a LOAD, a TAKE_BACK, an office manual
 * take-back onto the trip's van; Inc 3 adds the refill pickup) since the cylinder last entered a store.
 * None while the cylinder is in a store (the store's scan IN ends it), and none when no such move
 * exists (registered and never loaded, or handed straight from the store by an office manual delivery).
 * A move that kept the holder (a refill FILL, a day-end SET_STATE or MARK_LOST fix on the van) put nothing
 * onto the van, so it is passed over, whoever made it (review23 holder-scans-03). A move onto a van with
 * no trip (an old record) names its actor when that actor is a driver.
 */
export async function responsibleDriver(db: Db, cylinderId: string): Promise<ResponsibleDriver | null> {
  const cylinder = await db.cylinder.findUnique({ where: { id: cylinderId }, select: { custodyType: true, lastEventId: true } });
  if (!cylinder || cylinder.custodyType === CustodyType.STORE || cylinder.custodyType === CustodyType.DISTRIBUTOR) return null;
  const moves = await db.$queryRaw<MoveRow[]>`
    SELECT id, trip_id, actor_user_id, from_custody_type, from_custody_id, to_custody_type, to_custody_id, created_at
    FROM cylinder_events WHERE cylinder_id = ${cylinderId}::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT 500`;
  // The cylinder's own last move is the newest, whatever the clock says.
  const ordered = cylinder.lastEventId
    ? [...moves.filter((move) => move.id === cylinder.lastEventId), ...moves.filter((move) => move.id !== cylinder.lastEventId)]
    : moves;
  for (const move of ordered) {
    if (move.to_custody_type === CustodyType.STORE) return null;
    if (move.to_custody_type !== CustodyType.VEHICLE) continue;
    if (!changedHolder({ fromType: move.from_custody_type, fromId: move.from_custody_id, toType: move.to_custody_type, toId: move.to_custody_id })) {
      continue;
    }
    return driverOfMove(db, move);
  }
  return null;
}

async function driverOfMove(db: Db, move: MoveRow): Promise<ResponsibleDriver | null> {
  if (move.trip_id) {
    const trip = await db.trip.findUnique({
      where: { id: move.trip_id },
      select: { driver: { select: { id: true, user: { select: { id: true, name: true } } } } },
    });
    if (trip) return { userId: trip.driver.user.id, driverId: trip.driver.id, name: trip.driver.user.name, role: 'DRIVER' };
  }
  const actor = await db.user.findUnique({
    where: { id: move.actor_user_id },
    select: { id: true, name: true, role: true, driverProfile: { select: { id: true } } },
  });
  if (actor?.role === 'DRIVER') return { userId: actor.id, driverId: actor.driverProfile?.id ?? null, name: actor.name, role: 'DRIVER' };
  return null;
}
