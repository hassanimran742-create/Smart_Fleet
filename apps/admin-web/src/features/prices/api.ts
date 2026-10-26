import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DistributorDto, PriceGridDto, PriceGridZone, UUID } from '@smartfleet/shared-types';
import type { PutPriceInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Queries and mutations of Delivery prices (API_CONTRACT §7.5). Keys are leaves of `qk.prices`; a save
 * also refreshes the distributors (their coverage) and the summary (Today's missing-price cards).
 */

/** `GET /distributors` (office): names, codes, status and price coverage, sorted by name. */
export function useDistributorDirectory() {
  return useQuery({
    queryKey: [...qk.prices.all, 'distributors'] as const,
    queryFn: async ({ signal }) => (await api.get<DistributorDto[]>('/distributors', { signal })).data,
    staleTime: 60_000,
  });
}

/** The `flashRow` scope of the grid: a saved or removed price's row is tinted for 2 seconds (ui/highlight.ts). */
export const PRICES_FLASH = 'prices';

/** An open record drawer re-polls every 10 seconds (UX_ADMIN §1.5). */
export const PRICE_DRAWER_POLL_MS = 10_000;

/**
 * `GET /pricing/prices/:distributorId`: one row per zone (archived ones too) and the coverage. The price
 * drawer passes `pollMs`, so a price another office user saves meanwhile shows up.
 */
export function usePriceGrid(distributorId: string, options: { pollMs?: number } = {}) {
  return useQuery({
    queryKey: qk.prices.grid(distributorId),
    queryFn: async ({ signal }) =>
      (await api.get<PriceGridDto>(`/pricing/prices/${encodeURIComponent(distributorId)}`, { signal })).data,
    refetchInterval: options.pollMs,
  });
}

function zonePath(distributorId: UUID, zoneId: UUID): string {
  return `/pricing/prices/${encodeURIComponent(distributorId)}/${encodeURIComponent(zoneId)}`;
}

/** `PUT /pricing/prices/:distributorId/:zoneId`: answers the zone's grid row. */
export function useSavePrice(distributorId: UUID, zoneId: UUID) {
  return useApiMutation({
    mutationFn: async (body: PutPriceInput) => (await api.put<PriceGridZone>(zonePath(distributorId, zoneId), body)).data,
  });
}

/**
 * `DELETE /pricing/prices/:distributorId/:zoneId { reason }`: the row with `price: null`. With no price
 * set it answers the same row with `X-Already-Applied`, which reads the same as a removal (G03-04).
 */
export async function removePrice(distributorId: UUID, zoneId: UUID, reason: string): Promise<PriceGridZone> {
  return (await api.delete<PriceGridZone>(zonePath(distributorId, zoneId), { data: { reason } })).data;
}

/**
 * Puts a saved row into the cached grid at once (G03-04), then refetches the grid for the coverage, the
 * distributors for the switcher and the summary for Today's cards.
 */
export function useApplyPriceRow(distributorId: UUID): (row: PriceGridZone) => Promise<void> {
  const queryClient = useQueryClient();
  return async (row) => {
    queryClient.setQueryData<PriceGridDto>(qk.prices.grid(distributorId), (grid) =>
      grid ? { ...grid, zones: grid.zones.map((current) => (current.zone.id === row.zone.id ? row : current)) } : grid,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.prices.all }),
      queryClient.invalidateQueries({ queryKey: qk.distributors.all }),
      queryClient.invalidateQueries({ queryKey: qk.activity.all }),
      queryClient.invalidateQueries({ queryKey: qk.summary() }),
    ]);
  };
}
