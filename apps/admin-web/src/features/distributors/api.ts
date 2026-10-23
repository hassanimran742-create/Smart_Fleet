import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DistributorDto, IdName, OrderBoardDto, ZoneListRow } from '@smartfleet/shared-types';
import type {
  ApproveDistributorInput,
  CreateDistributorInput,
  UpdateDistributorInput,
  UpdateDistributorStoreInput,
} from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Queries and mutations of Distributors (API_CONTRACT §7.3). Keys are leaves of `qk.distributors`, so
 * invalidating `qk.distributors.all` refreshes the list, every distributor page and the board's filter.
 */

const LISTS_STALE_MS = 60_000;

export interface GeoPin {
  lat: number;
  lng: number;
}

/** `GET /distributors` (office). */
export function useDistributors() {
  return useQuery({
    queryKey: qk.distributors.list(),
    queryFn: async ({ signal }) => (await api.get<DistributorDto[]>('/distributors', { signal })).data,
    staleTime: LISTS_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

/** `GET /distributors/:id` (office view: readiness and the masked CNIC). */
export function useDistributor(distributorId: string | null | undefined) {
  return useQuery({
    queryKey: qk.distributors.detail(distributorId ?? ''),
    queryFn: async ({ signal }) =>
      (await api.get<DistributorDto>(`/distributors/${encodeURIComponent(distributorId as string)}`, { signal })).data,
    enabled: Boolean(distributorId),
    refetchOnWindowFocus: true,
  });
}

/** The newest orders of one distributor, for its page (`GET /orders/board?tab=all&distributorId`). */
export function useRecentOrders(distributorId: string, limit = 5) {
  return useQuery({
    queryKey: [...qk.orders.all, 'recent', distributorId, limit] as const,
    queryFn: async ({ signal }) =>
      (await api.get<OrderBoardDto>('/orders/board', { params: { tab: 'all', distributorId, limit }, signal })).data.items,
  });
}

/** Rounds a pin to 6 decimals (about 10 cm), the precision the API compares pins at. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * `GET /zones/locate?lat&lng`: the active zone covering a pin, or null outside every active zone. The
 * API answers an empty body for "outside", so anything that isn't a zone counts as outside.
 */
export function useZoneAt(pin: GeoPin | null) {
  const lat = pin ? round6(pin.lat) : null;
  const lng = pin ? round6(pin.lng) : null;
  return useQuery({
    queryKey: [...qk.zones.all, 'locate', lat, lng] as const,
    queryFn: async ({ signal }): Promise<IdName | null> => {
      const { data } = await api.get<IdName | null | ''>('/zones/locate', { params: { lat, lng }, signal });
      return data && typeof data === 'object' && typeof data.id === 'string' ? { id: data.id, name: data.name } : null;
    },
    enabled: lat !== null && lng !== null,
    staleTime: 30_000,
  });
}

export interface CityOption {
  id: string;
  name: string;
}

export interface AreaOption {
  name: string;
  lat: number;
  lng: number;
}

/** Cities, zones and reference areas change rarely. */
const PLACES_STALE_MS = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /cities`: the saved cities, or the built-in list (with made-up ids) before any is saved. */
export function useCities() {
  return useQuery({
    queryKey: [...qk.zones.all, 'cities'] as const,
    queryFn: async ({ signal }) => (await api.get<CityOption[]>('/cities', { signal })).data,
    staleTime: PLACES_STALE_MS,
  });
}

/** One reference area of one city, for "Find area": "DHA Phase 1 · Lahore". */
export interface CityArea extends AreaOption {
  city: string;
}

/**
 * Every city's reference areas (`GET /cities/:city/areas`, by the city's name, which the API also
 * accepts, so the built-in city list works before any city is saved), for the one "Find area" box.
 */
export function useAllAreas(): { areas: CityArea[]; loading: boolean } {
  const cities = useCities();
  const names = (cities.data ?? []).map((city) => city.name);
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: [...qk.zones.all, 'areas', name] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (await api.get<AreaOption[]>(`/cities/${encodeURIComponent(name)}/areas`, { signal })).data,
      staleTime: PLACES_STALE_MS,
    })),
  });
  const areas = results.flatMap((result, index) => (result.data ?? []).map((area) => ({ ...area, city: names[index] ?? '' })));
  return { areas, loading: cities.isPending || results.some((result) => result.isPending) };
}

/**
 * The active zones of every saved city (`GET /zones/city/:cityId`), with their outlines (`polygon`,
 * GeoJSON `[lng, lat]`) and centres, so the store maps can fit themselves to the zones and shade them.
 */
export function useZoneOutlines() {
  const cities = useCities();
  const ids = (cities.data ?? []).map((city) => city.id).filter((id) => UUID.test(id));
  return useQuery({
    queryKey: [...qk.zones.all, 'outlines', ids] as const,
    queryFn: async ({ signal }) => {
      const lists = await Promise.all(
        ids.map(async (id) => (await api.get<ZoneListRow[]>(`/zones/city/${encodeURIComponent(id)}`, { signal })).data),
      );
      return lists.flat().filter((zone) => zone.is_active);
    },
    enabled: cities.isSuccess,
    staleTime: PLACES_STALE_MS,
  });
}

/** Refreshes everything a distributor change can touch: lists, the page, Today, prices, wallets, history. */
export async function invalidateAfterDistributorChange(queryClient: QueryClient, distributorId?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.distributors.all }),
    queryClient.invalidateQueries({ queryKey: qk.summary() }),
    queryClient.invalidateQueries({ queryKey: qk.prices.all }),
    queryClient.invalidateQueries({ queryKey: qk.wallets.all }),
    distributorId
      ? queryClient.invalidateQueries({ queryKey: qk.activity.record('distributor', distributorId) })
      : Promise.resolve(),
  ]);
}

export function useInvalidateDistributor(distributorId?: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => invalidateAfterDistributorChange(queryClient, distributorId);
}

/**
 * Reads the pins' zones again (`GET /zones/locate`). Used when the server says a store pin is outside
 * every active zone: the zone it was in may have been archived since the pin was dropped.
 */
export function useRecheckPinZones(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [...qk.zones.all, 'locate'] });
}

/** `POST /distributors` with an Idempotency-Key (one per open drawer; a retry reuses it). */
export function useCreateDistributor() {
  return useApiMutation({
    idempotent: true,
    mutationFn: (body: CreateDistributorInput, { headers }) =>
      api.post<DistributorDto>('/distributors', body, { headers }).then((r) => r.data),
  });
}

/** `PATCH /distributors/:id { businessName?, name?, email?, phone? }`. */
export function useUpdateDistributor(distributorId: string) {
  return useApiMutation({
    mutationFn: (body: UpdateDistributorInput) =>
      api.patch<DistributorDto>(`/distributors/${encodeURIComponent(distributorId)}`, body).then((r) => r.data),
  });
}

/** `PATCH /distributors/:id/store { name?, address?, lat?, lng? }`: the zone is recomputed from the pin. */
export function useUpdateStore(distributorId: string) {
  return useApiMutation({
    mutationFn: (body: UpdateDistributorStoreInput) =>
      api.patch<DistributorDto>(`/distributors/${encodeURIComponent(distributorId)}/store`, body).then((r) => r.data),
  });
}

/** `PATCH /distributors/:id/code { code }`, only before the first order. */
export function useChangeCode(distributorId: string) {
  return useApiMutation({
    mutationFn: (code: string) =>
      api.patch<DistributorDto>(`/distributors/${encodeURIComponent(distributorId)}/code`, { code }).then((r) => r.data),
  });
}

/** `PATCH /distributors/:id/approve`: activates (no body) or reactivates (`{ reason }`). */
export function approveDistributor(distributorId: string, body: ApproveDistributorInput): Promise<DistributorDto> {
  return api.patch<DistributorDto>(`/distributors/${encodeURIComponent(distributorId)}/approve`, body).then((r) => r.data);
}

/** `PATCH /distributors/:id/suspend { reason }`. */
export function suspendDistributor(distributorId: string, reason: string): Promise<DistributorDto> {
  return api.patch<DistributorDto>(`/distributors/${encodeURIComponent(distributorId)}/suspend`, { reason }).then((r) => r.data);
}
