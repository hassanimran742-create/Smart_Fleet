import type { TFunction } from 'i18next';
import type {
  ReturnState,
  StopProgress,
  StopProgressLine,
  TripDetailDto,
  TripOrderDto,
  TripStopViewDto,
  TripSummary,
  VanCounts,
  VanLeftoverCylinder,
} from '@smartfleet/shared-types';
import { businessDate, formatNo, localDate, type BusinessDayOptions } from '@smartfleet/shared-utils';
import type { DriverStepState, IconName } from '../../ui';
import type { SizeLine } from '../../ui/scan';

/** The store stop's progress (API_CONTRACT §9.3): per size, what the trip needs and what is loaded. */
export type PickupProgress = Extract<StopProgress, { type: 'STORE_PICKUP' }>;
/** A visit's progress: what is given against the order, and what was taken back. */
export type DeliveryProgress = Extract<StopProgress, { type: 'DELIVERY' }>;

/**
 * The van as `GET /trips/:id` sends it (shared-types `TripVanDto`): the counts, plus the cylinders on it
 * from the trip's point of view, in the shape TRIP_VAN_NOT_EMPTY lists them, for the Unload rows with
 * ticks (driver spec R7). `cylinders` stays optional so an older server's answer still shows the Unload
 * groups as counts.
 */
export type VanOnTrip = VanCounts & { cylinders?: VanLeftoverCylinder[] };

/**
 * `GET /trips/:id` from Inc 2 (shared-types `TripDetailDto`: each stop with its words and progress, the
 * van and the trip's buttons). The shapes are shared-types' DTOs (README rule 2); these names keep the
 * driver screens' imports short.
 */
export type TripDetail = Omit<TripDetailDto, 'van'> & { van: VanOnTrip | null };
export type TripStop = TripStopViewDto;
export type TripOrder = TripOrderDto;

/** A trip the driver can still work on. Scans and steps are refused once it is closed. */
export function isTripOpen(trip: Pick<TripDetail, 'status'>): boolean {
  return trip.status === 'PLANNED' || trip.status === 'IN_PROGRESS';
}

export function stopsOf(trip: TripDetail): TripStop[] {
  return [...(trip.stops ?? [])].sort((a, b) => a.seq - b.seq);
}

export function findStop(trip: TripDetail, stopId: string): TripStop | null {
  return (trip.stops ?? []).find((stop) => stop.id === stopId) ?? null;
}

export function orderOf(trip: TripDetail, stop: Pick<TripStop, 'orderId'> | null): TripOrder | null {
  if (!stop?.orderId) return null;
  return (trip.orders ?? []).find((order) => order.id === stop.orderId) ?? null;
}

/** The store stop (Load): one per trip. */
export function loadStopOf(trip: TripDetail): TripStop | null {
  return stopsOf(trip).find((stop) => stop.type === 'STORE_PICKUP') ?? null;
}

/** The delivery stops (one per customer), in trip order. */
export function deliveryStops(trip: TripDetail): TripStop[] {
  return stopsOf(trip).filter((stop) => stop.type === 'DELIVERY');
}

/** True while a stop still has something to do. */
export function isStopOpen(stop: Pick<TripStop, 'status'>): boolean {
  return stop.status === 'PENDING' || stop.status === 'ARRIVED';
}

export function pickupOf(stop: TripStop | null): PickupProgress | null {
  return stop?.progress?.type === 'STORE_PICKUP' ? stop.progress : null;
}

export function deliveryOf(stop: TripStop | null): DeliveryProgress | null {
  return stop?.progress?.type === 'DELIVERY' ? stop.progress : null;
}

/**
 * What this trip still has to unload: the van's cylinders from the trip's point of view (`van.cylinders`,
 * the list "Finish trip" refuses on, API_CONTRACT §9.13). A refill's cylinder, another open run's delivery
 * on the same van, or a cylinder marked lost on the van isn't the trip's, so it never keeps the trip on
 * Unload (review23 holder-scans-02, holder-scans-04). An older server without the list: the van's total.
 * Today's van row and My van keep showing everything on the van (`van.total`, `GET /inventory/my-vehicle`).
 */
export function tripVanLeftOf(trip: Pick<TripDetail, 'van'>): number {
  if (!trip.van) return 0;
  return Array.isArray(trip.van.cylinders) ? trip.van.cylinders.length : trip.van.total;
}

/** True while a stop of the trip (the load or a visit) is still open. */
export function hasOpenStop(trip: TripDetail): boolean {
  return stopsOf(trip).some((stop) => stop.type !== 'RETURN_DROPOFF' && isStopOpen(stop));
}

/**
 * The trip's steps, as the driver sees them (driver spec §1.9): Load at the store, Deliver to each
 * customer, then Unload at the store. Unload isn't a server stop: the shop scans the cylinders in.
 */
export type StepKind = 'LOAD' | 'DELIVER' | 'UNLOAD';

export interface TripStep {
  kind: StepKind;
  /** Null for Unload. */
  stop: TripStop | null;
}

export function tripSteps(trip: TripDetail): TripStep[] {
  const stops = stopsOf(trip);
  return [
    ...stops.filter((stop) => stop.type === 'STORE_PICKUP').map((stop): TripStep => ({ kind: 'LOAD', stop })),
    ...stops.filter((stop) => stop.type === 'DELIVERY').map((stop): TripStep => ({ kind: 'DELIVER', stop })),
    { kind: 'UNLOAD', stop: null },
  ];
}

/** "Step 2 of 3" for a stop, or for Unload (`stopId` null), the last step. */
export function stepPosition(trip: TripDetail, stopId: string | null): { step: number; total: number } {
  const steps = tripSteps(trip);
  const index = steps.findIndex((step) => (stopId === null ? step.kind === 'UNLOAD' : step.stop?.id === stopId));
  return { step: Math.max(0, index) + 1, total: steps.length };
}

/** The icon of each step (rulebook §9.1): Load the van, Deliver the customer, Unload the store. */
export const STEP_ICON: Record<StepKind, IconName> = { LOAD: 'van', DELIVER: 'customer', UNLOAD: 'store' };

/**
 * What the driver does next (driver spec D6 and R3's footer table), the one rule behind Today's
 * "Continue trip", the Trip screen's footer and the footer of a finished step:
 * - planned: start the trip;
 * - the load is open: load (a trip is finished only once every stop is closed);
 * - a customer still waits: deliver to the first one, in trip order;
 * - nothing left to visit: unload while the trip's van list holds cylinders, else finish the trip;
 * - closed: nothing to do.
 */
export type NextStep =
  | { kind: 'START' }
  | { kind: 'LOAD'; stop: TripStop }
  | { kind: 'DELIVER'; stop: TripStop }
  | { kind: 'UNLOAD' }
  | { kind: 'FINISH' }
  | { kind: 'CLOSED' };

export function nextStep(trip: TripDetail): NextStep {
  if (!isTripOpen(trip)) return { kind: 'CLOSED' };
  if (trip.status === 'PLANNED') return { kind: 'START' };
  const load = loadStopOf(trip);
  if (load && isStopOpen(load)) return { kind: 'LOAD', stop: load };
  const delivery = deliveryStops(trip).find((stop) => isStopOpen(stop));
  if (delivery) return { kind: 'DELIVER', stop: delivery };
  return tripVanLeftOf(trip) > 0 ? { kind: 'UNLOAD' } : { kind: 'FINISH' };
}

/** The stop the "Next" chip points at: the first step of a planned trip, else the next step's stop. */
function nextStopId(trip: TripDetail): string | null {
  if (trip.status === 'PLANNED') return tripSteps(trip)[0]?.stop?.id ?? null;
  const next = nextStep(trip);
  return next.kind === 'LOAD' || next.kind === 'DELIVER' ? next.stop.id : null;
}

/**
 * The step chip of a stop (driver spec §1.6; rulebook §4.2): Done; Not delivered (the order FAILED);
 * Cancelled (the order or stop CANCELLED, or the office stopped the trip); In progress (arrived, or
 * loading begun); Next (the step to do now); To do.
 */
export function stopStepState(trip: TripDetail, stop: TripStop): DriverStepState {
  const order = orderOf(trip, stop);
  if (stop.status === 'DONE') return 'DONE';
  if (stop.status === 'FAILED' || order?.status === 'FAILED') return 'NOT_DELIVERED';
  if (stop.status === 'CANCELLED' || order?.status === 'CANCELLED') return 'CANCELLED';
  if (trip.status === 'COMPLETED') return 'DONE';
  if (!isTripOpen(trip)) return 'CANCELLED';
  if (stop.status === 'ARRIVED') return 'IN_PROGRESS';
  if (stop.type === 'STORE_PICKUP' && (pickupOf(stop)?.doneCount ?? 0) > 0) return 'IN_PROGRESS';
  return nextStopId(trip) === stop.id ? 'NEXT' : 'TO_DO';
}

/** The Unload step's chip: To do while a stop is open, Next while the trip's van list has cylinders, then Done. */
export function unloadStepState(trip: TripDetail): DriverStepState {
  if (trip.status === 'COMPLETED') return 'DONE';
  if (!isTripOpen(trip)) return 'CANCELLED';
  if (trip.status === 'PLANNED' || hasOpenStop(trip)) return 'TO_DO';
  return tripVanLeftOf(trip) > 0 ? 'NEXT' : 'DONE';
}

/** A trip's chip on Today: In progress, Next (the trip to do now) or To do. */
export function tripChip(trip: Pick<TripSummary, 'id' | 'status'>, currentId: string | null): DriverStepState {
  if (trip.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return trip.id === currentId ? 'NEXT' : 'TO_DO';
}

/** The store's name, or "the store" while it isn't known. */
export function storeNameOf(trip: TripDetail | null | undefined, t: TFunction): string {
  if (!trip) return t('scan.theStore');
  return trip.originStore?.name || loadStopOf(trip)?.title || t('scan.theStore');
}

/** The customer's name (the visit's title from the server), or "the customer" while it isn't known. */
export function customerNameOf(stop: TripStop | null, order: TripOrder | null, t: TFunction): string {
  return stop?.title || order?.client?.name || t('scan.theCustomer');
}

/** The customers of a trip, in visit order: the visits that weren't cancelled. */
export function customerNames(trip: TripDetail, t: TFunction): string[] {
  return deliveryStops(trip)
    .filter((stop) => stop.status !== 'CANCELLED')
    .map((stop) => customerNameOf(stop, orderOf(trip, stop), t));
}

/** Full cylinders the order gives the customer. */
export function cylindersToGive(order: TripOrder | null | undefined): number {
  return (order?.lines ?? []).reduce((sum, line) => sum + (line.fullCount ?? 0), 0);
}

/** Cylinders the customer is expected to give back. */
export function cylindersToTakeBack(order: TripOrder | null | undefined): number {
  return (order?.lines ?? []).reduce((sum, line) => sum + (line.expectedReturnCount ?? 0), 0);
}

/** Full cylinders the trip's open and delivered orders carry (cancelled and failed ones left out). */
export function tripCylinderCount(trip: TripDetail): number {
  return (trip.orders ?? [])
    .filter((order) => order.status !== 'CANCELLED' && order.status !== 'FAILED')
    .reduce((sum, order) => sum + cylindersToGive(order), 0);
}

/** "2 × 11.8 kg" per size: what to load or give, from a progress's lines. */
export function needLines(lines: readonly StopProgressLine[], t: TFunction): SizeLine[] {
  return lines
    .filter((line) => line.needed > 0)
    .map((line) => ({
      key: line.cylinderTypeId,
      text: t('driver.steps.line', { count: line.needed, size: line.sizeLabel }),
    }));
}

/** "11.8 kg · 0 of 2" per size, with a tick once that size is complete (R4, R5; SizeLines). */
export function progressLines(lines: readonly StopProgressLine[], t: TFunction): SizeLine[] {
  return lines
    .filter((line) => line.needed > 0)
    .map((line) => ({
      key: line.cylinderTypeId,
      text: t('scan.sizeProgress', { size: line.sizeLabel, done: Math.min(line.done, line.needed), total: line.needed }),
      complete: line.done >= line.needed,
    }));
}

/** A cylinder's number as people read it ("AG-C0042"), or its QR value without a number. */
export function shortCodeOf(code: string, shortNo: number | null, distributorCode: string | null | undefined): string {
  if (shortNo === null || shortNo === undefined) return code;
  try {
    return formatNo(distributorCode ?? null, 'CYLINDER', shortNo);
  } catch {
    return code;
  }
}

/** The Unload step's groups (R7), in this order. */
export const UNLOAD_GROUPS = ['NOT_DELIVERED', 'EMPTY', 'PART_FILLED', 'FULL'] as const;
export type UnloadGroup = (typeof UNLOAD_GROUPS)[number];

/**
 * What is still on the van by Unload group, from the counts alone (when the trip doesn't list the
 * cylinders): the loaded cylinders still on the van are the store stop's loaded count less what the
 * visits gave, per size (API_CONTRACT §9.3: a cylinder the store took back no longer counts as loaded);
 * the rest of the van is what was taken back, by state.
 */
export function unloadGroupCounts(trip: TripDetail): Record<UnloadGroup, number> | null {
  const van = trip.van;
  if (!van) return null;
  const given = new Map<string, number>();
  for (const stop of deliveryStops(trip)) {
    for (const line of deliveryOf(stop)?.give.lines ?? []) given.set(line.cylinderTypeId, (given.get(line.cylinderTypeId) ?? 0) + line.done);
  }
  let loadedLeft = 0;
  for (const line of pickupOf(loadStopOf(trip))?.lines ?? []) loadedLeft += Math.max(0, line.done - (given.get(line.cylinderTypeId) ?? 0));
  const notDelivered = Math.min(loadedLeft, van.full);
  return { NOT_DELIVERED: notDelivered, EMPTY: van.empty, PART_FILLED: van.partFilled, FULL: Math.max(0, van.full - notDelivered) };
}

/** The return states in the order every list shows them (rulebook §5.2: Empty · Part-filled · Full). */
export const RETURN_STATES: readonly ReturnState[] = ['EMPTY', 'PART_FILLED', 'FULL'];

/**
 * The van's counts with the zeros hidden: "3 full · 1 empty · 1 part-filled"; "" when it is empty. Each
 * part is a whole phrase, so " · " is the one join the copy rules allow (driver spec §6).
 */
export function vanCountsLine(van: Pick<VanCounts, 'full' | 'empty' | 'partFilled'> | null | undefined, t: TFunction): string {
  if (!van) return '';
  const parts: string[] = [];
  if (van.full > 0) parts.push(t('driver.van.fullCount', { count: van.full }));
  if (van.empty > 0) parts.push(t('driver.van.emptyCount', { count: van.empty }));
  if (van.partFilled > 0) parts.push(t('driver.van.partCount', { count: van.partFilled }));
  return parts.join(' · ');
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
