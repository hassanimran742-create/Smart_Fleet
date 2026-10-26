import { TripStatus, TripStopStatus, TripStopType } from '@prisma/client';
import type { TripSummary } from '@smartfleet/shared-types';
import type { Db } from '../orders/support/tx';

/** A stop is closed once it is DONE, FAILED or CANCELLED ("Skipped" in the apps). */
export const CLOSED_STOP: TripStopStatus[] = [TripStopStatus.DONE, TripStopStatus.FAILED, TripStopStatus.CANCELLED];
export const OPEN_STOP_STATUSES: TripStopStatus[] = [TripStopStatus.PENDING, TripStopStatus.ARRIVED];

/** The words of each stop (API_CONTRACT §9.3 `stops[].title` and `address`): the store, or the customer. */
export async function stopWords(db: Db, stopIds: readonly string[]): Promise<Map<string, { title: string; address: string | null }>> {
  if (stopIds.length === 0) return new Map();
  const stops = await db.tripStop.findMany({
    where: { id: { in: [...stopIds] } },
    select: {
      id: true,
      stopType: true,
      store: { select: { name: true, address: true } },
      order: { select: { deliveryAddressLabel: true, client: { select: { name: true } } } },
      trip: { select: { originStore: { select: { name: true, address: true } } } },
    },
  });
  return new Map(
    stops.map((stop) => {
      if (stop.stopType === TripStopType.DELIVERY) {
        return [stop.id, { title: stop.order?.client.name ?? '', address: stop.order?.deliveryAddressLabel ?? null }];
      }
      const store = stop.store ?? stop.trip.originStore;
      return [stop.id, { title: store?.name ?? '', address: store?.address ?? null }];
    }),
  );
}

/** Trip rows of `GET /driver/home` (UX_MOBILE §7.2 R2). */
export async function tripSummaries(db: Db, tripIds: readonly string[]): Promise<Map<string, TripSummary>> {
  if (tripIds.length === 0) return new Map();
  const trips = await db.trip.findMany({
    where: { id: { in: [...tripIds] } },
    select: {
      id: true,
      status: true,
      plannedAt: true,
      startedAt: true,
      originStore: { select: { id: true, name: true } },
      stops: { select: { stopType: true, status: true, seq: true, orderId: true }, orderBy: { seq: 'asc' } },
      orders: { select: { id: true, status: true, client: { select: { name: true } }, lines: { select: { fullCount: true } } } },
    },
  });
  return new Map(
    trips.map((trip) => {
      const visits = trip.stops.filter((stop) => stop.stopType === TripStopType.DELIVERY && stop.status !== TripStopStatus.CANCELLED);
      const orderById = new Map(trip.orders.map((order) => [order.id, order]));
      const summary: TripSummary = {
        id: trip.id,
        status: trip.status,
        plannedAt: trip.plannedAt.toISOString(),
        startedAt: trip.startedAt ? trip.startedAt.toISOString() : null,
        store: { id: trip.originStore.id, name: trip.originStore.name },
        customers: visits.length,
        customerNames: visits.map((stop) => (stop.orderId ? orderById.get(stop.orderId)?.client.name : undefined) ?? '').filter((name) => name !== ''),
        cylinders: trip.orders
          .filter((order) => order.status !== 'CANCELLED' && order.status !== 'FAILED')
          .reduce((sum, order) => sum + order.lines.reduce((n, line) => n + line.fullCount, 0), 0),
        stops: { done: trip.stops.filter((stop) => CLOSED_STOP.includes(stop.status)).length, total: trip.stops.length },
      };
      return [trip.id, summary];
    }),
  );
}

/** The next stop still to do after `stopId` (by seq), else the first one left; null when none is. */
export async function nextOpenStopId(db: Db, tripId: string, stopId: string): Promise<string | null> {
  const stops = await db.tripStop.findMany({
    where: { tripId, status: { in: OPEN_STOP_STATUSES }, id: { not: stopId } },
    orderBy: { seq: 'asc' },
    select: { id: true, seq: true },
  });
  if (stops.length === 0) return null;
  const current = await db.tripStop.findUnique({ where: { id: stopId }, select: { seq: true } });
  const after = current ? stops.find((stop) => stop.seq > current.seq) : undefined;
  return (after ?? stops[0]).id;
}

/** True for a trip a driver may still scan on, finish stops of, or finish. */
export function isOpenTrip(status: TripStatus | string): boolean {
  return status === TripStatus.PLANNED || status === TripStatus.IN_PROGRESS;
}
