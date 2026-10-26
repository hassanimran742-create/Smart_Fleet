import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type {
  DeliveryFailureReason,
  DriverHomeDto,
  ReturnState,
  ScanResult,
  StopFinishResult,
  StopProgress,
  TakeBackShortReason,
  UnlabelledReturnsResult,
} from '@smartfleet/shared-types';
import { api } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import type { ScanRead } from '../../ui/scan';
import type { TripDetail, TripOrder } from './tripModel';

/**
 * The driver's Inc 2 routes (API_CONTRACT §9.3; UX_MOBILE Appendix B, R2–R7). Every move is one scan per
 * cylinder; a stop finishes only when the server agrees its scans match, and the trip only with every
 * stop closed and the van empty. No route here moves money. The Inc 1 legacy scan route and its tally
 * are retired: the store scans the unload in (the legacy SCAN_IN answers 403).
 */

/** A position fix older than this isn't sent. */
const FIX_MAX_AGE_MS = 5 * 60_000;

/** `GET /driver/home`: Today in one request. */
export async function fetchDriverHome(): Promise<DriverHomeDto> {
  const { data } = await api.get<DriverHomeDto>('/driver/home');
  return data;
}

/** `GET /trips/:id`; use with `qk.trip(id)`. */
export async function fetchTrip(tripId: string): Promise<TripDetail> {
  const { data } = await api.get<TripDetail>(`/trips/${tripId}`);
  return data;
}

/** `PATCH /trips/:id/status IN_PROGRESS`: "Start trip". A repeat answers `X-Already-Applied`. */
export async function startTrip(tripId: string): Promise<void> {
  await api.patch(`/trips/${tripId}/status`, { status: 'IN_PROGRESS' });
}

/**
 * "Start trip" (Today and Trip): starts the trip, then loads it fresh, so the caller opens its first
 * step at once. A failure stays on the mutation for the footer's action line.
 */
export function useStartTrip(onStarted: (trip: TripDetail) => void): UseMutationResult<TripDetail, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<TripDetail, ApiError, string>({
    mutationFn: async (tripId) => {
      await startTrip(tripId);
      void queryClient.invalidateQueries({ queryKey: qk.driver.home });
      return queryClient.fetchQuery({ queryKey: qk.trip(tripId), queryFn: () => fetchTrip(tripId), staleTime: 0 });
    },
    onSuccess: (trip) => onStarted(trip),
  });
}

/** `PATCH /trips/stops/:id/arrive`: "I've arrived" (the camera starts only after it). */
export async function arriveAtStop(stopId: string): Promise<void> {
  await api.patch(`/trips/stops/${stopId}/arrive`);
}

/** The driver's scan actions on a trip (API_CONTRACT §9.3). */
export type TripScanAction = 'LOAD' | 'HANDOVER' | 'TAKE_BACK';

/**
 * `POST /trips/:tripId/scans`: 201 RECORDED for a new move; 200 ALREADY_RECORDED for a resend (same
 * scan id, `Idempotent-Replay`) or the same move again (`X-Already-Applied`). A refusal carries
 * `details.progress`, so the count stays right after it.
 */
export async function postTripScan(tripId: string, stopId: string, action: TripScanAction, read: ScanRead): Promise<ScanResult> {
  const body: Record<string, unknown> = {
    scanId: read.scanId,
    stopId,
    action,
    code: read.code,
    entryMethod: read.entryMethod,
  };
  if (action === 'TAKE_BACK') body.returnState = read.returnState ?? 'EMPTY';
  if (read.lat !== undefined && read.lng !== undefined) {
    body.lat = read.lat;
    body.lng = read.lng;
  }
  const { data } = await api.post<ScanResult>(`/trips/${tripId}/scans`, body);
  return data;
}

/** One unlabelled or other-brand return on a visit: a size, a state and how many. */
export interface UnlabelledItem {
  cylinderTypeId: string;
  state: ReturnState;
  count: number;
}

/** `PUT /trips/:tripId/stops/:stopId/unlabelled-returns`: replaces the visit's whole list (0 removes a row). */
export async function putUnlabelledReturns(tripId: string, stopId: string, items: readonly UnlabelledItem[]): Promise<StopProgress> {
  const { data } = await api.put<UnlabelledReturnsResult>(`/trips/${tripId}/stops/${stopId}/unlabelled-returns`, {
    items: items.filter((item) => item.count > 0),
  });
  return data.progress;
}

export interface TakeBackShort {
  reasonCode: TakeBackShortReason;
  /** Required for OTHER (3–300 characters). */
  note?: string;
}

/**
 * `POST /trips/:tripId/stops/:stopId/finish`: "Done loading" at the store, "Finish visit" at a customer.
 * 409 LOAD_INCOMPLETE, DELIVERY_SCANS_INCOMPLETE or TAKE_BACK_SHORT (unless `takeBackShort` says why).
 */
export async function finishStop(tripId: string, stopId: string, takeBackShort?: TakeBackShort): Promise<StopFinishResult> {
  const { data } = await api.post<StopFinishResult>(
    `/trips/${tripId}/stops/${stopId}/finish`,
    takeBackShort ? { takeBackShort } : {},
  );
  return data;
}

/**
 * `POST /trips/:tripId/finish`: "Finish trip". 409 TRIP_STOPS_OPEN, or TRIP_VAN_NOT_EMPTY `{count,
 * cylinders, leftoversAllowed}`; `leftoverReason` (5–300) finishes with cylinders left while the office
 * allows it. A repeat on a finished trip answers `X-Already-Applied`.
 */
export async function finishTrip(tripId: string, leftoverReason?: string): Promise<TripDetail> {
  const { data } = await api.post<TripDetail>(`/trips/${tripId}/finish`, leftoverReason ? { leftoverReason } : {});
  return data;
}

export interface NotDeliveredBody {
  reasonCode: DeliveryFailureReason;
  /** Required for OTHER (3–300 characters). */
  note?: string;
  lat?: number;
  lng?: number;
}

/** `POST /orders/:id/fail`: "Could not deliver" (no money). The loaded cylinders stay on the van. */
export async function markNotDelivered(orderId: string, body: NotDeliveredBody): Promise<Partial<TripOrder>> {
  const { data } = await api.post<Partial<TripOrder>>(`/orders/${orderId}/fail`, body);
  return data;
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

/** The progress a scan refusal carries (`details.progress`), or null. */
export function refusalProgress(error: unknown): StopProgress | null {
  const progress = toApiError(error).details.progress as StopProgress | undefined;
  return progress && (progress.type === 'STORE_PICKUP' || progress.type === 'DELIVERY') ? progress : null;
}

/**
 * Lays a scan's progress over the cached trip at once, so "2 of 3" moves with the strip: the stop's
 * progress, the first scan's ARRIVED, and the first load's start. The next refetch brings the rest.
 */
export function withStopProgress(
  trip: TripDetail | undefined,
  stopId: string,
  progress: StopProgress,
  recorded: boolean,
): TripDetail | undefined {
  if (!trip) return trip;
  return {
    ...trip,
    status: recorded && trip.status === 'PLANNED' ? 'IN_PROGRESS' : trip.status,
    stops: (trip.stops ?? []).map((stop) =>
      stop.id === stopId
        ? { ...stop, progress, status: recorded && stop.status === 'PENDING' ? 'ARRIVED' : stop.status }
        : stop,
    ),
  };
}

/**
 * Puts a scan's answer (or a refusal's progress) into the trip's cache: an in-flight poll is cancelled
 * first, so an answer from before the scan can't put the count back.
 */
export function applyStopProgress(
  client: QueryClient,
  tripId: string,
  stopId: string,
  progress: StopProgress | null,
  recorded: boolean,
): void {
  if (!progress) return;
  void client.cancelQueries({ queryKey: qk.trip(tripId) });
  client.setQueryData<TripDetail>(qk.trip(tripId), (old) => withStopProgress(old, stopId, progress, recorded));
}

/** After a step: refetch the trip and Today (and wait, so the next step shows at once). */
export async function refreshTrip(client: QueryClient, tripId: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.trip(tripId) }),
    client.invalidateQueries({ queryKey: qk.driver.home }),
  ]);
}

/** After the trip finished: the trip, Today ("Done today") and the van. */
export function refreshAfterFinish(client: QueryClient, tripId: string): void {
  void client.invalidateQueries({ queryKey: qk.trip(tripId) });
  void client.invalidateQueries({ queryKey: qk.driver.home });
  void client.invalidateQueries({ queryKey: VAN_QUERY_KEY });
}

/** My van (`GET /inventory/my-vehicle`): refreshed after a trip finishes. */
export const VAN_QUERY_KEY = ['driver', 'van'] as const;
