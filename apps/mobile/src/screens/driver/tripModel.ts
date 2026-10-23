import type { TFunction } from 'i18next';
import type {
  TripOrderDto,
  TripOrderLineDto,
  TripStopDto,
  TripStopStatus,
  TripViewDto,
} from '@smartfleet/shared-types';
import { businessDate, localDate, type BusinessDayOptions } from '@smartfleet/shared-utils';
import type { DriverStepState, IconName } from '../../ui';

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

export function findStop(trip: TripView, stopId: string): TripStop | null {
  return (trip.stops ?? []).find((stop) => stop.id === stopId) ?? null;
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

/** The store stops (Load), in trip order. Inc 1 trips have one, first. */
export function loadStops(trip: TripView): TripStop[] {
  return stopsOf(trip).filter((stop) => stop.stopType === 'STORE_PICKUP');
}

/** The delivery stops (one per customer), in trip order. */
export function deliveryStops(trip: TripView): TripStop[] {
  return stopsOf(trip).filter((stop) => stop.stopType === 'DELIVERY');
}

/** True while a customer of the trip still waits for the driver. */
export function hasOpenDelivery(trip: TripView): boolean {
  return deliveryStops(trip).some((stop) => isStopOpen(trip, stop));
}

/**
 * The trip's steps, as the driver sees them (driver spec §1.9): Load at the store, Deliver to each
 * customer, then Unload at the store. Unload isn't a server stop in Inc 1 (the store's SCAN_IN).
 */
export type StepKind = 'LOAD' | 'DELIVER' | 'UNLOAD';

export interface TripStep {
  kind: StepKind;
  /** Null for Unload. */
  stop: TripStop | null;
}

export function tripSteps(trip: TripView): TripStep[] {
  return [
    ...loadStops(trip).map((stop): TripStep => ({ kind: 'LOAD', stop })),
    ...deliveryStops(trip).map((stop): TripStep => ({ kind: 'DELIVER', stop })),
    { kind: 'UNLOAD', stop: null },
  ];
}

/** "Step 2 of 3" for a stop, or for Unload (`stopId` null), the last step. */
export function stepPosition(trip: TripView, stopId: string | null): { step: number; total: number } {
  const steps = tripSteps(trip);
  const index = steps.findIndex((step) => (stopId === null ? step.kind === 'UNLOAD' : step.stop?.id === stopId));
  return { step: Math.max(0, index) + 1, total: steps.length };
}

/** The icon of each step (rulebook §9.1): Load the van, Deliver the customer, Unload the store. */
export const STEP_ICON: Record<StepKind, IconName> = { LOAD: 'van', DELIVER: 'customer', UNLOAD: 'store' };

/**
 * What the driver does next (driver spec D6's footer table), the one rule behind Today's "Continue
 * trip", the Trip screen's footer and the footer of a finished step:
 * - planned: start the trip;
 * - a customer still waits: load first if the store stop is open, else deliver to the first customer;
 * - no customer waits: unload while the van holds cylinders, else finish the trip;
 * - closed: nothing to do.
 */
export type NextStep =
  | { kind: 'START' }
  | { kind: 'LOAD'; stop: TripStop }
  | { kind: 'DELIVER'; stop: TripStop }
  | { kind: 'UNLOAD' }
  | { kind: 'FINISH' }
  | { kind: 'CLOSED' };

export function nextStep(trip: TripView, vanHasCylinders: boolean): NextStep {
  if (!isTripOpen(trip)) return { kind: 'CLOSED' };
  if (trip.status === 'PLANNED') return { kind: 'START' };
  const delivery = deliveryStops(trip).find((stop) => isStopOpen(trip, stop));
  if (delivery) {
    const load = loadStops(trip).find((stop) => isStopOpen(trip, stop));
    return load ? { kind: 'LOAD', stop: load } : { kind: 'DELIVER', stop: delivery };
  }
  return vanHasCylinders ? { kind: 'UNLOAD' } : { kind: 'FINISH' };
}

/** The stop the "Next" chip points at: the first step of a planned trip, else the next step's stop. */
function nextStopId(trip: TripView, vanHasCylinders: boolean): string | null {
  if (trip.status === 'PLANNED') return tripSteps(trip)[0]?.stop?.id ?? null;
  const next = nextStep(trip, vanHasCylinders);
  return next.kind === 'LOAD' || next.kind === 'DELIVER' ? next.stop.id : null;
}

/** True once loading has begun on the trip (the first load scan stamps `loadStartedAt`). */
function loadingStarted(trip: TripView): boolean {
  return (trip.orders ?? []).some((order) => Boolean(order.loadStartedAt));
}

/**
 * The step chip of a stop (driver spec §1.6; rulebook §4.2): Done; Not delivered (the order FAILED);
 * Cancelled (the order or stop CANCELLED, or the office stopped the trip); In progress (arrived, or
 * loading begun); Next (the step to do now); To do.
 */
export function stopStepState(trip: TripView, stop: TripStop, vanHasCylinders = true): DriverStepState {
  const order = orderOf(trip, stop);
  const status = stopStatusOf(stop, order);
  if (status === 'DONE') return 'DONE';
  if (order?.status === 'FAILED' || status === 'FAILED') return 'NOT_DELIVERED';
  if (order?.status === 'CANCELLED' || status === 'CANCELLED') return 'CANCELLED';
  // A finished trip left a stop unclosed only when its work was done (the server checks the orders).
  if (trip.status === 'COMPLETED') return 'DONE';
  if (!isTripOpen(trip)) return 'CANCELLED';
  if (status === 'ARRIVED' || order?.status === 'DELIVERED') return 'IN_PROGRESS';
  if (stop.stopType === 'STORE_PICKUP' && loadingStarted(trip)) return 'IN_PROGRESS';
  return nextStopId(trip, vanHasCylinders) === stop.id ? 'NEXT' : 'TO_DO';
}

/** The Unload step's chip: To do while a customer waits, Next while the van holds cylinders, then Done. */
export function unloadStepState(trip: TripView, vanHasCylinders: boolean): DriverStepState {
  if (trip.status === 'COMPLETED') return 'DONE';
  if (!isTripOpen(trip)) return 'CANCELLED';
  if (trip.status === 'PLANNED' || hasOpenDelivery(trip)) return 'TO_DO';
  return vanHasCylinders ? 'NEXT' : 'DONE';
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

/** A trip's chip on Today: In progress, Next (the trip to do now) or To do. */
export function tripStepState(trip: TripView, current: TripView | null): DriverStepState {
  if (trip.status === 'COMPLETED') return 'DONE';
  if (trip.status === 'ABORTED') return 'CANCELLED';
  if (trip.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return current?.id === trip.id ? 'NEXT' : 'TO_DO';
}

/** The store's name, or "the store" while it isn't known. */
export function storeNameOf(trip: TripView | null | undefined, t: TFunction): string {
  return trip?.originStore?.name ?? t('scan.theStore');
}

/** The customer's name, or "the customer" while it isn't known. */
export function customerNameOf(order: TripOrder | null | undefined, t: TFunction): string {
  return order?.client?.name ?? t('scan.theCustomer');
}

/** A step in words: "Load at Ahmed Gas Store", "Deliver to Sana" or "Unload at Ahmed Gas Store". */
export function stepTitle(trip: TripView, stop: TripStop | null, t: TFunction): string {
  const store = storeNameOf(trip, t);
  if (stop?.stopType === 'DELIVERY')
    return t('driver.trip.deliverTo', { name: customerNameOf(orderOf(trip, stop), t) });
  if (stop?.stopType === 'STORE_PICKUP') return t('driver.trip.loadAt', { store });
  return t('driver.trip.unloadAt', { store });
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

/** The orders still to load at the store (open orders: cancelled or failed ones never load). */
export function ordersToLoad(trip: TripView): TripOrder[] {
  return (trip.orders ?? []).filter((order) => isOrderOpen(order));
}

/**
 * The orders the store step loaded or loads: all but an order cancelled before its first load scan.
 * A failed order was loaded, so the Load row still says "3 cylinders" after "Not delivered".
 */
export function ordersOfTheLoad(trip: TripView): TripOrder[] {
  return (trip.orders ?? []).filter((order) => order.status !== 'CANCELLED' || Boolean(order.loadStartedAt));
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

/** "2 × 11.8 kg" for each size, added up over the given orders, as SizeLines takes them. */
export function sizeLinesOf(orders: readonly (TripOrder | null)[], t: TFunction): { key: string; text: string }[] {
  const bySize = new Map<string, { size: string; count: number }>();
  for (const order of orders) {
    for (const line of order?.lines ?? []) {
      if (!line.fullCount) continue;
      const size = sizeLabelOf(line, (kg) => t('driver.size', { kg }));
      const entry = bySize.get(line.cylinderTypeId) ?? { size, count: 0 };
      entry.count += line.fullCount;
      bySize.set(line.cylinderTypeId, entry);
    }
  }
  return [...bySize.entries()].map(([key, entry]) => ({
    key,
    text: t('driver.steps.line', { count: entry.count, size: entry.size }),
  }));
}

/** The business date (`YYYY-MM-DD`) of a moment, by the server's day settings; never throws. */
export function businessDayOf(at: string | number | Date, day: BusinessDayOptions): string {
  try {
    return businessDate(at, day);
  } catch {
    // A malformed cut-off setting: the calendar date is close enough for "today".
    return localDate(at);
  }
}
