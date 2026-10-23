import type { TFunction } from 'i18next';
import type {
  TripOrderDto,
  TripOrderLineDto,
  TripStopDto,
  TripStopStatus,
  TripViewDto,
} from '@smartfleet/shared-types';
import type { DriverStepState } from '../../ui';

/**
 * `GET /trips/mine` and `GET /trips/:id` (API_CONTRACT §7.7: the existing shape, plus `stops[].status`
 * and `allowedActions`). The shapes are shared-types' DTOs (README rule 2: apps never redefine them);
 * these names keep the driver screens' imports short.
 */
export type TripView = TripViewDto;
export type TripStop = TripStopDto;
export type TripOrder = TripOrderDto;
export type TripOrderLine = TripOrderLineDto;

/** A trip the driver can still work on. Scans and steps are refused once it is closed. */
export function isTripOpen(trip: Pick<TripView, 'status'>): boolean {
  return trip.status === 'PLANNED' || trip.status === 'IN_PROGRESS';
}

/** An order that still needs the driver: assigned to the trip and not finished. */
export function isOrderOpen(order: Pick<TripOrder, 'status'> | null | undefined): boolean {
  return order?.status === 'ASSIGNED' || order?.status === 'IN_TRANSIT';
}

export function stopsOf(trip: TripView): TripStop[] {
  return [...(trip.stops ?? [])].sort((a, b) => a.seq - b.seq);
}

export function orderOf(trip: TripView, stop: Pick<TripStop, 'orderId'>): TripOrder | null {
  if (!stop.orderId) return null;
  return (trip.orders ?? []).find((order) => order.id === stop.orderId) ?? null;
}

/** The stop's status: the server's when it sends one, else read from the timestamps and the order. */
export function stopStatusOf(stop: TripStop, order: TripOrder | null): TripStopStatus {
  if (stop.status) return stop.status;
  if (stop.cancelledAt || order?.status === 'CANCELLED') return 'CANCELLED';
  if (order?.status === 'FAILED') return 'FAILED';
  if (stop.departedAt) return 'DONE';
  if (stop.arrivedAt) return 'ARRIVED';
  return 'PENDING';
}

/** True while a stop still has something to do. */
export function isStopOpen(trip: TripView, stop: TripStop): boolean {
  const status = stopStatusOf(stop, orderOf(trip, stop));
  return status === 'PENDING' || status === 'ARRIVED';
}

/** The first stop, in trip order, that still has something to do. */
export function nextOpenStop(trip: TripView): TripStop | null {
  return stopsOf(trip).find((stop) => isStopOpen(trip, stop)) ?? null;
}

/** The delivery stops (one per customer), in trip order. */
export function deliveryStops(trip: TripView): TripStop[] {
  return stopsOf(trip).filter((stop) => stop.stopType === 'DELIVERY');
}

/** True once loading has begun on the trip (the first load scan stamps `loadStartedAt`). */
function loadingStarted(trip: TripView): boolean {
  return (trip.orders ?? []).some((order) => Boolean(order.loadStartedAt));
}

/**
 * The step chip of a stop (UX_MOBILE §3.4 `stages.step`): Done, Skipped (failed or cancelled), In
 * progress (arrived, or loading begun at the store), Next (the first open stop) or To do.
 */
export function stopStepState(trip: TripView, stop: TripStop): DriverStepState {
  const status = stopStatusOf(stop, orderOf(trip, stop));
  if (status === 'DONE') return 'DONE';
  if (status === 'FAILED' || status === 'CANCELLED') return 'SKIPPED';
  if (!isTripOpen(trip)) return 'SKIPPED';
  if (status === 'ARRIVED') return 'IN_PROGRESS';
  if (stop.stopType === 'STORE_PICKUP' && loadingStarted(trip)) return 'IN_PROGRESS';
  return nextOpenStop(trip)?.id === stop.id ? 'NEXT' : 'TO_DO';
}

/** The trip a driver should do now: the one in progress, else the oldest one still planned. */
export function currentTrip(trips: readonly TripView[]): TripView | null {
  const running = trips.find((trip) => trip.status === 'IN_PROGRESS');
  if (running) return running;
  const planned = trips
    .filter((trip) => trip.status === 'PLANNED')
    .sort((a, b) => (a.plannedAt ?? '').localeCompare(b.plannedAt ?? ''));
  return planned[0] ?? null;
}

/**
 * A step in words: "Load at Ahmed Gas Store", "Deliver to Sana" or "Hand back at Ahmed Gas Store".
 */
export function stepTitle(trip: TripView, stop: TripStop, t: TFunction): string {
  const store = trip.originStore?.name ?? t('scan.theStore');
  if (stop.stopType === 'DELIVERY') {
    return t('driver.trip.deliverTo', { name: orderOf(trip, stop)?.client?.name ?? t('scan.theCustomer') });
  }
  if (stop.stopType === 'RETURN_DROPOFF') return t('driver.trip.handBackAt', { store });
  return t('driver.trip.loadAt', { store });
}

/** The step chip of a trip on Home: In progress, Next (the trip to do now), To do, Done or Skipped. */
export function tripStepState(trip: TripView, current: TripView | null): DriverStepState {
  if (trip.status === 'COMPLETED') return 'DONE';
  if (trip.status === 'ABORTED') return 'SKIPPED';
  if (trip.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return current?.id === trip.id ? 'NEXT' : 'TO_DO';
}

/** Full cylinders the order gives the customer. */
export function cylindersToGive(order: TripOrder | null | undefined): number {
  return (order?.lines ?? []).reduce((sum, line) => sum + (line.fullCount ?? 0), 0);
}

/** Empty cylinders the customer is expected to give back. */
export function cylindersToTakeBack(order: TripOrder | null | undefined): number {
  return (order?.lines ?? []).reduce((sum, line) => sum + (line.expectedReturnCount ?? 0), 0);
}

/** Full cylinders the trip's open and delivered orders carry (cancelled and failed ones left out). */
export function tripCylinderCount(trip: TripView): number {
  return (trip.orders ?? [])
    .filter((order) => order.status !== 'CANCELLED' && order.status !== 'FAILED')
    .reduce((sum, order) => sum + cylindersToGive(order), 0);
}

/**
 * A cylinder size for people, "11.8 kg", from the type's weight, else its name, else its code (the trip
 * routes send the raw order line, which has no size label). `kgLabel` turns a weight into words
 * (`driver.size`).
 */
export function sizeLabelOf(line: TripOrderLine, kgLabel: (kg: string) => string): string {
  const weight = Number(line.cylinderType?.weightKg);
  if (Number.isFinite(weight) && weight > 0) return kgLabel(String(Math.round(weight * 100) / 100));
  return line.cylinderType?.name ?? line.cylinderType?.code ?? '';
}

/** When a finished trip ended, for sorting the newest first (ISO strings sort by time). */
export function finishedAt(trip: TripView): string {
  return trip.completedAt ?? trip.startedAt ?? trip.plannedAt ?? '';
}
