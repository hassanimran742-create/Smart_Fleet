import type { AxiosResponse } from 'axios';
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { DeliveryFailureReason } from '@smartfleet/shared-types';
import { api } from '../../api/client';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { VAN_LOAD_QUERY_KEY } from '../../components/VehicleLoad';
import type { TripOrder, TripStop, TripView } from './tripModel';

/** The legacy scan route's events the driver app sends (API_CONTRACT §7.7), one per step. */
export type LegacyScanEvent = 'SCAN_OUT' | 'DELIVERED' | 'PICKED_UP_EMPTY' | 'SCAN_IN';

/** A position fix older than this isn't sent. */
const FIX_MAX_AGE_MS = 5 * 60_000;

/** True when the server answered a repeated action without doing it again (`X-Already-Applied`). */
export function isAlreadyApplied(response: Pick<AxiosResponse, 'headers'>): boolean {
  const headers = response.headers as unknown as { get?: (name: string) => unknown } & Record<string, unknown>;
  const value = typeof headers?.get === 'function' ? headers.get('x-already-applied') : headers?.['x-already-applied'];
  return String(value ?? '').toLowerCase() === 'true';
}

/** What an action answered, and whether it had already been done. */
export interface ActionResult<T> {
  data: T;
  alreadyApplied: boolean;
}

async function action<T>(request: Promise<AxiosResponse<T>>): Promise<ActionResult<T>> {
  const response = await request;
  return { data: response.data, alreadyApplied: isAlreadyApplied(response) };
}

/** `GET /trips/mine` (a bare array, newest first). */
export async function fetchMyTrips(): Promise<TripView[]> {
  const { data } = await api.get<TripView[]>('/trips/mine');
  return Array.isArray(data) ? data : [];
}

/** `GET /trips/:id`; use with `qk.trip(id)`. */
export async function fetchTrip(tripId: string): Promise<TripView> {
  const { data } = await api.get<TripView>(`/trips/${tripId}`);
  return data;
}

/** `PATCH /trips/:id/status IN_PROGRESS`: "Start trip". A repeat answers `X-Already-Applied`. */
export function startTrip(tripId: string): Promise<ActionResult<Partial<TripView>>> {
  return action(api.patch<Partial<TripView>>(`/trips/${tripId}/status`, { status: 'IN_PROGRESS' }));
}

/**
 * `PATCH /trips/:id/status COMPLETED`: "Finish trip". `leftoverReason` is sent as `reason` only when
 * the driver picked one on the leftovers sheet: from Inc 2 this route maps to the finish, with
 * `reason` as the trip's `leftoverReason` (API_CONTRACT §9.3); the Inc 1 server ignores it.
 */
export function finishTrip(tripId: string, leftoverReason?: string): Promise<ActionResult<Partial<TripView>>> {
  const body = leftoverReason ? { status: 'COMPLETED', reason: leftoverReason } : { status: 'COMPLETED' };
  return action(api.patch<Partial<TripView>>(`/trips/${tripId}/status`, body));
}

/**
 * "Start trip" (Today and Trip): starts the trip, then loads it fresh, so the caller opens its first
 * step at once. A failure stays on the mutation for the footer's action line.
 */
export function useStartTrip(onStarted: (trip: TripView) => void): UseMutationResult<TripView, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<TripView, ApiError, string>({
    mutationFn: async (tripId) => {
      await startTrip(tripId);
      void queryClient.invalidateQueries({ queryKey: qk.driver.trips });
      return queryClient.fetchQuery({ queryKey: qk.trip(tripId), queryFn: () => fetchTrip(tripId), staleTime: 0 });
    },
    onSuccess: (trip) => onStarted(trip),
  });
}

/** `PATCH /trips/stops/:id/arrive`. */
export function arriveAtStop(stopId: string): Promise<ActionResult<Partial<TripStop>>> {
  return action(api.patch<Partial<TripStop>>(`/trips/stops/${stopId}/arrive`));
}

/** `PATCH /trips/stops/:id/depart`: "Done loading" at the store, "Finish visit" at a customer. */
export function departStop(stopId: string): Promise<ActionResult<Partial<TripStop>>> {
  return action(api.patch<Partial<TripStop>>(`/trips/stops/${stopId}/depart`));
}

/** `PATCH /orders/:id/status { status: DELIVERED }`: "All delivered" (the driver's tap; no money). */
export function markDelivered(orderId: string): Promise<ActionResult<Partial<TripOrder>>> {
  return action(api.patch<Partial<TripOrder>>(`/orders/${orderId}/status`, { status: 'DELIVERED' }));
}

export interface NotDeliveredBody {
  reasonCode: DeliveryFailureReason;
  /** Required for OTHER (3–300 characters). */
  note?: string;
  lat?: number;
  lng?: number;
}

/** `POST /orders/:id/fail`: "Could not deliver" (no money). */
export function markNotDelivered(orderId: string, body: NotDeliveredBody): Promise<ActionResult<Partial<TripOrder>>> {
  return action(api.post<Partial<TripOrder>>(`/orders/${orderId}/fail`, body));
}

export interface LegacyScanBody {
  qrCode: string;
  eventType: LegacyScanEvent;
  tripId: string;
  /** Required for DELIVERED and PICKED_UP_EMPTY. */
  orderId?: string;
  lat?: number;
  lng?: number;
}

interface LegacyScanReply {
  alreadyRecorded?: boolean;
}

/**
 * `POST /custody/scan` (DRIVER exact). A move recorded before answers 200 with `X-Already-Applied`
 * and `alreadyRecorded: true`, and changes nothing.
 */
export async function scanCylinder(body: LegacyScanBody): Promise<{ alreadyRecorded: boolean }> {
  const response = await api.post<LegacyScanReply>('/custody/scan', body);
  return { alreadyRecorded: response.data?.alreadyRecorded === true || isAlreadyApplied(response) };
}

/** The phone's last known position, if it has one and may share it; never waits for a new fix. */
export async function lastKnownPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const position = await Location.getLastKnownPositionAsync({ maxAge: FIX_MAX_AGE_MS });
    return position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
  } catch {
    return null;
  }
}

/** Lays a stop answer (`arrive`, `depart`) over the cached trip, keeping what the answer leaves out. */
export function withStop(trip: TripView | undefined, stop: Partial<TripStop> | null | undefined): TripView | undefined {
  if (!trip || !stop?.id) return trip;
  return {
    ...trip,
    stops: (trip.stops ?? []).map((current) =>
      current.id === stop.id
        ? {
            ...current,
            status: stop.status ?? current.status,
            arrivedAt: stop.arrivedAt ?? current.arrivedAt,
            departedAt: stop.departedAt ?? current.departedAt,
          }
        : current,
    ),
  };
}

/** Lays an order answer (delivered, could not deliver) over the cached trip. */
export function withOrder(
  trip: TripView | undefined,
  order: Partial<TripOrder> | null | undefined,
): TripView | undefined {
  if (!trip || !order?.id || typeof order.status !== 'string') return trip;
  const status = order.status;
  return {
    ...trip,
    orders: (trip.orders ?? []).map((current) => (current.id === order.id ? { ...current, status } : current)),
  };
}

/** After a step: refetch the trip and the trip list (and wait, so the next step shows at once). */
export async function refreshTrip(client: QueryClient, tripId: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.trip(tripId) }),
    client.invalidateQueries({ queryKey: qk.driver.trips }),
  ]);
}

/** After the trip finished: the trip, the list (Today's "Done today") and the van. */
export function refreshAfterFinish(client: QueryClient, tripId: string): void {
  void client.invalidateQueries({ queryKey: qk.trip(tripId) });
  void client.invalidateQueries({ queryKey: qk.driver.trips });
  void client.invalidateQueries({ queryKey: VAN_LOAD_QUERY_KEY });
}

/** After a scan: the trip (load stamps, order steps) and the van's load. */
export function refreshAfterScan(client: QueryClient, tripId: string): void {
  void client.invalidateQueries({ queryKey: qk.trip(tripId) });
  void client.invalidateQueries({ queryKey: VAN_LOAD_QUERY_KEY });
}
