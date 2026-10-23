import { Injectable } from '@nestjs/common';
import { Prisma, TripStatus, TripStopStatus, TripStopType, UserRole } from '@prisma/client';
import { ORDER_LIST_TAB_STATUSES, type TripStatusValue } from '@smartfleet/shared-types';
import type { UpdateTripStatusInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { canActOnTrip, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { lockTripOrders, markTripOrdersOnTheWay, releaseTripOrders } from '../orders/order-writes';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { autoStartTrip, tripHasLoadOrHandover, tripHasScans } from './trip-writes';

/** Buttons a trip offers its caller (API_CONTRACT §1.6). */
export type TripAction = 'START' | 'COMPLETE' | 'ABORT';
/** Buttons a stop offers the trip's driver. */
export type StopAction = 'ARRIVE' | 'DEPART';

const OPEN_TRIP: TripStatusValue[] = ['PLANNED', 'IN_PROGRESS'];
const OPEN_STOP: TripStopStatus[] = [TripStopStatus.PENDING, TripStopStatus.ARRIVED];

/** The trip shape the installed driver app reads (`GET /trips/mine`, `/trips/:id`), with safe selects. */
const TRIP_INCLUDE = {
  orders: {
    include: {
      client: { select: { id: true, name: true, phone: true, address: true, area: true } },
      distributor: { select: { id: true, businessName: true, code: true } },
      lines: { include: { cylinderType: true } },
    },
  },
  stops: { orderBy: { seq: 'asc' } },
  originStore: true,
  vehicle: true,
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof TRIP_INCLUDE }>;
type StopRow = TripRow['stops'][number];

/** A stop as the API sends it: the row with its pin decoded (Prisma can't read geometry) and its buttons. */
export type StopView = StopRow & {
  location: { coordinates: [number, number]; lat: number; lng: number } | null;
  allowedActions: StopAction[];
};

/** A trip as the API sends it. `allowedActions` is filled on `GET /trips/:id` and on step answers. */
export type TripView = Omit<TripRow, 'stops'> & {
  stops: StopView[];
  driver?: { id: string; name: string; phone: string };
  allowedActions?: TripAction[];
};

interface LockedTrip {
  id: string;
  status: TripStatus;
  driver_id: string;
  vehicle_id: string;
  origin_store_id: string;
}

interface LockedStop {
  id: string;
  trip_id: string;
  stop_type: TripStopType;
  status: TripStopStatus;
  arrived_at: Date | null;
  departed_at: Date | null;
}

/**
 * Trips and their stops (API_CONTRACT §7.7, §8.3). Only the trip's driver moves a trip and its stops;
 * the office may abort a trip only before anything happened on it. Starting a trip never moves its
 * orders: they go on the way when the store stop departs. Nothing here moves money.
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------- reads ----------

  /** `GET /trips/mine` (DRIVER exact): a bare array, newest first, as the installed app reads it. */
  async forDriver(driverId: string): Promise<TripView[]> {
    const trips = await this.prisma.trip.findMany({
      where: { driverId },
      include: TRIP_INCLUDE,
      orderBy: [{ plannedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return this.withStops(trips, null);
  }

  /** `GET /trips/:id`: the trip's driver or the office (404 for anyone else), with its buttons. */
  async byId(caller: PolicyCaller, id: string): Promise<TripView> {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: { ...TRIP_INCLUDE, driver: { select: { id: true, user: { select: { name: true, phone: true } } } } },
    });
    if (!trip || (caller.role !== UserRole.SUPER_ADMIN && !(caller.role === UserRole.DRIVER && caller.driverId === trip.driverId))) {
      throw new AppError('NOT_FOUND');
    }
    const { driver, ...rest } = trip;
    const [view] = await this.withStops([rest], caller);
    view.driver = { id: driver.id, name: driver.user.name, phone: driver.user.phone };
    view.allowedActions = await this.tripActions(caller, rest);
    return view;
  }

  // ---------- trip and stop steps ----------

  /**
   * `PATCH /trips/:id/status`. The driver: PLANNED → IN_PROGRESS, and IN_PROGRESS → COMPLETED once every
   * order is finished (409 TRIP_ORDERS_OPEN). The office: → ABORTED with a reason, only while nothing
   * happened on the trip; its orders go back to needing a driver (audited `trip.abort`, no money).
   * A repeat of the trip's status by a caller who may make it answers 200 `X-Already-Applied`.
   */
  async setStatus(actor: UserActor, id: string, body: UpdateTripStatusInput): Promise<TripView | IdempotentResponse<TripView>> {
    const office = actor.role === UserRole.SUPER_ADMIN;
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (office && body.status === 'ABORTED') await lockTripOrders(tx, id);
      const trip = await this.lockTrip(tx, id);
      if (!office) canActOnTrip(actor, { driverId: trip.driver_id });
      const mayMake = office ? body.status === 'ABORTED' : body.status === 'IN_PROGRESS' || body.status === 'COMPLETED';
      if (trip.status === body.status) {
        if (mayMake) return 'already' as const;
        throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
      }
      if (!office && body.status === 'IN_PROGRESS' && trip.status === TripStatus.PLANNED) {
        await autoStartTrip(tx, id);
        return 'changed' as const;
      }
      if (!office && body.status === 'COMPLETED' && trip.status === TripStatus.IN_PROGRESS) {
        const open = await tx.order.count({ where: { tripId: id, status: { in: [...ORDER_LIST_TAB_STATUSES.active] } } });
        if (open > 0) throw new AppError('TRIP_ORDERS_OPEN');
        await tx.$executeRaw`UPDATE trips SET status = 'COMPLETED', completed_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
        return 'changed' as const;
      }
      if (office && body.status === 'ABORTED' && OPEN_TRIP.includes(trip.status)) {
        if (!(await this.untouched(tx, id))) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
        await this.officeAbort(tx, actor, trip, body.reason as string);
        return 'changed' as const;
      }
      throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
    }, LOCKING_TX);
    const view = await this.byId(actor, id);
    return outcome === 'already' ? alreadyApplied(view) : view;
  }

  /**
   * `PATCH /trips/stops/:stopId/arrive` (the trip's driver). Sets `arrivedAt` once and the stop
   * ARRIVED; the first arrive starts a PLANNED trip (the trip only). A repeat: 200 `X-Already-Applied`.
   */
  async arrive(actor: UserActor, stopId: string): Promise<StopView | IdempotentResponse<StopView>> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { trip, stop } = await this.lockStop(tx, actor, stopId, false);
      if (stop.arrived_at) return 'already' as const;
      if (stop.status !== TripStopStatus.PENDING) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: stop.status });
      await tx.$executeRaw`
        UPDATE trip_stops SET arrived_at = (now() AT TIME ZONE 'UTC'), status = 'ARRIVED' WHERE id = ${stopId}::uuid`;
      await autoStartTrip(tx, trip.id);
      return 'changed' as const;
    }, LOCKING_TX);
    const view = await this.stopView(actor, stopId);
    return outcome === 'already' ? alreadyApplied(view) : view;
  }

  /**
   * `PATCH /trips/stops/:stopId/depart` (the trip's driver). Sets `departedAt` once and the stop DONE.
   * Departing the STORE_PICKUP stop puts the trip's ASSIGNED orders on the way (IN_TRANSIT with
   * `onTheWayAt`). A repeat: 200 `X-Already-Applied`, nothing changes.
   */
  async depart(actor: UserActor, stopId: string): Promise<StopView | IdempotentResponse<StopView>> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { trip, stop } = await this.lockStop(tx, actor, stopId, true);
      if (stop.departed_at) return 'already' as const;
      if (!OPEN_STOP.includes(stop.status)) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: stop.status });
      await tx.$executeRaw`
        UPDATE trip_stops
        SET departed_at = (now() AT TIME ZONE 'UTC'), arrived_at = COALESCE(arrived_at, (now() AT TIME ZONE 'UTC')),
            status = 'DONE', completed_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${stopId}::uuid`;
      await autoStartTrip(tx, trip.id);
      if (stop.stop_type === TripStopType.STORE_PICKUP) await markTripOrdersOnTheWay(tx, trip.id);
      return 'changed' as const;
    }, LOCKING_TX);
    const view = await this.stopView(actor, stopId);
    return outcome === 'already' ? alreadyApplied(view) : view;
  }

  // ---------- used by orders, inside the order's transaction ----------

  /**
   * A new trip for one order (ADR-12): PLANNED, a STORE_PICKUP stop at the distributor's store
   * (seq 0, `store_id` set), then the order's DELIVERY stop (seq 1).
   */
  async createForOrder(
    tx: Tx,
    p: { driverId: string; vehicleId: string; store: { id: string; lat: number; lng: number }; orderId: string; destination: { lat: number; lng: number } },
  ): Promise<string> {
    const trip = await tx.trip.create({
      data: { driverId: p.driverId, vehicleId: p.vehicleId, originStoreId: p.store.id, status: TripStatus.PLANNED },
      select: { id: true },
    });
    await tx.$executeRaw`
      INSERT INTO trip_stops (id, trip_id, seq, stop_type, store_id, status, location)
      VALUES (gen_random_uuid(), ${trip.id}::uuid, 0, 'STORE_PICKUP', ${p.store.id}::uuid, 'PENDING',
              ST_SetSRID(ST_MakePoint(${p.store.lng}, ${p.store.lat}), 4326))`;
    await tx.$executeRaw`
      INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, status, location)
      VALUES (gen_random_uuid(), ${trip.id}::uuid, ${p.orderId}::uuid, 1, 'DELIVERY', 'PENDING',
              ST_SetSRID(ST_MakePoint(${p.destination.lng}, ${p.destination.lat}), 4326))`;
    return trip.id;
  }

  /** Closes an order's open DELIVERY stop on a trip: CANCELLED (cancel, reassign), FAILED, or DONE (office delivery). */
  async closeOrderStop(tx: Tx, tripId: string, orderId: string, status: 'CANCELLED' | 'FAILED' | 'DONE'): Promise<void> {
    // The caller holds the order; the trip comes before its stops, as in arrive and depart, so a cancel
    // racing the driver's arrive at this stop waits instead of deadlocking.
    await this.lockTrip(tx, tripId);
    if (status === 'CANCELLED') {
      await tx.$executeRaw`
        UPDATE trip_stops SET status = 'CANCELLED', cancelled_at = (now() AT TIME ZONE 'UTC')
        WHERE trip_id = ${tripId}::uuid AND order_id = ${orderId}::uuid AND stop_type = 'DELIVERY' AND status IN ('PENDING','ARRIVED')`;
    } else if (status === 'FAILED') {
      await tx.$executeRaw`
        UPDATE trip_stops SET status = 'FAILED', completed_at = (now() AT TIME ZONE 'UTC')
        WHERE trip_id = ${tripId}::uuid AND order_id = ${orderId}::uuid AND stop_type = 'DELIVERY' AND status IN ('PENDING','ARRIVED')`;
    } else {
      await tx.$executeRaw`
        UPDATE trip_stops SET status = 'DONE', completed_at = (now() AT TIME ZONE 'UTC')
        WHERE trip_id = ${tripId}::uuid AND order_id = ${orderId}::uuid AND stop_type = 'DELIVERY' AND status IN ('PENDING','ARRIVED')`;
    }
  }

  /**
   * Aborts an open trip left with no other open order and no load scan (§7.6 cancel step 6, §8.3: the
   * system abort when its last open order is cancelled or reassigned; the `order.*` audit row covers
   * it). A hand-back (SCAN_IN) of empties from an earlier run doesn't keep it open. Its open stops are
   * cancelled. True when it aborted the trip.
   */
  async abortIfIdle(tx: Tx, tripId: string, exceptOrderId?: string): Promise<boolean> {
    const trip = await this.lockTrip(tx, tripId);
    if (!OPEN_TRIP.includes(trip.status)) return false;
    const others = await tx.order.count({
      where: {
        tripId,
        status: { in: [...ORDER_LIST_TAB_STATUSES.active] },
        ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
      },
    });
    if (others > 0 || (await tripHasLoadOrHandover(tx, tripId))) return false;
    await this.closeTrip(tx, tripId);
    return true;
  }

  // ---------- internals ----------

  private async lockTrip(tx: Tx, id: string): Promise<LockedTrip> {
    const rows = await tx.$queryRaw<LockedTrip[]>`
      SELECT id, status, driver_id, vehicle_id, origin_store_id FROM trips WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return rows[0];
  }

  /** Locks a stop's trip (and, for a store-stop depart, the trip's orders first), then the stop. */
  private async lockStop(tx: Tx, actor: UserActor, stopId: string, departing: boolean): Promise<{ trip: LockedTrip; stop: LockedStop }> {
    const found = await tx.tripStop.findUnique({ where: { id: stopId }, select: { tripId: true, stopType: true } });
    if (!found) throw new AppError('NOT_FOUND');
    if (departing && found.stopType === TripStopType.STORE_PICKUP) await lockTripOrders(tx, found.tripId);
    const trip = await this.lockTrip(tx, found.tripId);
    canActOnTrip(actor, { driverId: trip.driver_id });
    const stops = await tx.$queryRaw<LockedStop[]>`
      SELECT id, trip_id, stop_type, status, arrived_at, departed_at FROM trip_stops WHERE id = ${stopId}::uuid FOR UPDATE`;
    const stop = stops[0];
    if (!stop) throw new AppError('NOT_FOUND');
    if (!OPEN_TRIP.includes(trip.status)) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
    return { trip, stop };
  }

  /** Nothing happened on the trip: no scan, no stop arrived or departed, and every order still waiting to load. */
  private async untouched(tx: Tx, tripId: string): Promise<boolean> {
    if (await tripHasScans(tx, tripId)) return false;
    const touchedStops = await tx.tripStop.count({ where: { tripId, OR: [{ arrivedAt: { not: null } }, { departedAt: { not: null } }] } });
    if (touchedStops > 0) return false;
    const busy = await tx.order.count({
      where: { tripId, OR: [{ status: { notIn: ['ASSIGNED', 'CANCELLED'] } }, { status: 'ASSIGNED', loadStartedAt: { not: null } }] },
    });
    return busy === 0;
  }

  private async officeAbort(tx: Tx, actor: UserActor, trip: LockedTrip, reason: string): Promise<void> {
    const orderIds = await releaseTripOrders(tx, trip.id);
    await this.closeTrip(tx, trip.id);
    const [driver, owner] = await Promise.all([
      tx.driver.findUnique({ where: { id: trip.driver_id }, select: { user: { select: { name: true } } } }),
      tx.distributor.findUnique({ where: { homeStoreId: trip.origin_store_id }, select: { id: true } }),
    ]);
    await this.audit.record(
      {
        action: 'trip.abort',
        actor,
        resourceType: 'trip',
        resourceId: trip.id,
        distributorId: owner?.id ?? null,
        reason,
        diff: { orderIds, count: orderIds.length, driver: driver?.user.name ?? '' },
      },
      tx,
    );
  }

  private async closeTrip(tx: Tx, tripId: string): Promise<void> {
    await tx.$executeRaw`UPDATE trips SET status = 'ABORTED' WHERE id = ${tripId}::uuid`;
    await tx.$executeRaw`
      UPDATE trip_stops SET status = 'CANCELLED', cancelled_at = (now() AT TIME ZONE 'UTC')
      WHERE trip_id = ${tripId}::uuid AND status IN ('PENDING','ARRIVED')`;
  }

  private async tripActions(caller: PolicyCaller, trip: TripRow): Promise<TripAction[]> {
    if (caller.role === UserRole.SUPER_ADMIN) {
      if (!OPEN_TRIP.includes(trip.status)) return [];
      return (await this.untouchedReadOnly(trip)) ? ['ABORT'] : [];
    }
    if (trip.status === TripStatus.PLANNED) return ['START'];
    if (trip.status === TripStatus.IN_PROGRESS) {
      const open = trip.orders.some((order) => (ORDER_LIST_TAB_STATUSES.active as readonly string[]).includes(order.status));
      return open ? [] : ['COMPLETE'];
    }
    return [];
  }

  private async untouchedReadOnly(trip: TripRow): Promise<boolean> {
    const scans = await this.prisma.cylinderEvent.count({ where: { tripId: trip.id } });
    if (scans > 0) return false;
    if (trip.stops.some((stop) => stop.arrivedAt || stop.departedAt)) return false;
    return trip.orders.every((order) => order.status === 'CANCELLED' || (order.status === 'ASSIGNED' && !order.loadStartedAt));
  }

  private stopActions(caller: PolicyCaller | null, tripStatus: TripStatus, stop: { status: TripStopStatus }): StopAction[] {
    if (!caller || caller.role !== UserRole.DRIVER || !OPEN_TRIP.includes(tripStatus)) return [];
    if (stop.status === TripStopStatus.PENDING) return ['ARRIVE'];
    if (stop.status === TripStopStatus.ARRIVED) return ['DEPART'];
    return [];
  }

  private async stopView(actor: UserActor, stopId: string): Promise<StopView> {
    const stop = await this.prisma.tripStop.findUniqueOrThrow({ where: { id: stopId }, include: { trip: { select: { status: true } } } });
    const { trip, ...row } = stop;
    const [view] = await this.decorateStops([row], (s) => this.stopActions(actor, trip.status, s));
    return view;
  }

  /** Replaces each stop's raw geometry with a readable pin and adds its buttons. */
  private async withStops(trips: TripRow[], caller: PolicyCaller | null): Promise<TripView[]> {
    const statusByTrip = new Map(trips.map((trip) => [trip.id, trip.status]));
    const views = await this.decorateStops(
      trips.flatMap((trip) => trip.stops),
      (stop) => this.stopActions(caller, statusByTrip.get(stop.tripId) ?? TripStatus.ABORTED, stop),
    );
    const byId = new Map(views.map((view) => [view.id, view]));
    return trips.map((trip) => ({
      ...trip,
      stops: trip.stops.map((stop) => byId.get(stop.id)).filter((view): view is StopView => view !== undefined),
    }));
  }

  private async decorateStops(stops: StopRow[], actions: (stop: StopRow) => StopAction[]): Promise<StopView[]> {
    if (stops.length === 0) return [];
    const coords = await this.prisma.$queryRaw<Array<{ id: string; lat: number | null; lng: number | null }>>`
      SELECT id, ST_Y(location) AS lat, ST_X(location) AS lng FROM trip_stops WHERE id = ANY(${stops.map((stop) => stop.id)}::uuid[])`;
    const byId = new Map(coords.map((row) => [row.id, row]));
    return stops.map((stop) => {
      const pin = byId.get(stop.id);
      const location =
        pin && pin.lat !== null && pin.lng !== null
          ? { coordinates: [pin.lng, pin.lat] as [number, number], lat: pin.lat, lng: pin.lng }
          : null;
      return { ...stop, location, allowedActions: actions(stop) };
    });
  }
}
