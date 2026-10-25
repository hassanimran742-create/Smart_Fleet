import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { AuditLogDto, FillingOrderDto, Page } from '@smartfleet/shared-types';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Refills for the office (API_CONTRACT §7.11, §10.1): the list, one refill with its picked cylinders, and
 * assigning a driver. Refills carry no money (ADR-16); the office has no cancel and no "Mark complete"
 * (the shop's last receive scan completes a refill, `PATCH …/complete` is 410 from Inc 3).
 */

/** A refill as the office reads it: the DTO plus the names the list shows. */
export type RefillRow = FillingOrderDto & {
  distributor: { id: string; businessName: string; code: string };
  pickupStore: { id: string; name: string } | null;
};

/** A queue page refreshes itself, as Orders does (UX_ADMIN §1.7); an open drawer every 10 seconds. */
export const REFILLS_POLL_MS = 15_000;
export const REFILL_POLL_MS = 10_000;

export const refillKeys = {
  all: ['refills'] as const,
  list: () => ['refills', 'list'] as const,
  detail: (id: string) => ['refills', 'detail', id] as const,
};

/** `GET /filling-orders` (office): every refill; the page sorts them into its tabs. */
export function useRefills() {
  return useQuery({
    queryKey: refillKeys.list(),
    queryFn: async ({ signal }) => (await api.get<RefillRow[]>('/filling-orders', { signal })).data,
    refetchInterval: REFILLS_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** `GET /filling-orders/:id`: one refill with its picked cylinders (`cylinders`, Inc 3). */
export function useRefill(refillId: string) {
  return useQuery({
    queryKey: refillKeys.detail(refillId),
    queryFn: async ({ signal }) => (await api.get<RefillRow>(`/filling-orders/${encodeURIComponent(refillId)}`, { signal })).data,
    refetchInterval: REFILL_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** The refill's audit rows, for who assigned the driver and when (`refill.assign`). */
export function useRefillHistory(refillId: string, version: string | null) {
  return useQuery({
    queryKey: [...refillKeys.detail(refillId), 'history', version] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Page<AuditLogDto> | AuditLogDto[]>('/audit-logs', {
        params: { resourceType: 'refill', resourceId: refillId, limit: 50 },
        signal,
      });
      return Array.isArray(data) ? data : data.items;
    },
    staleTime: 60_000,
  });
}

/**
 * `PATCH /filling-orders/:id/assign { driverId }` (office): only while it needs a driver (else 409
 * `REFILL_WRONG_STEP`); the driver must be available and have a van. A repeat for the same driver
 * answers 200 with `X-Already-Applied`.
 */
export function useAssignRefill(refillId: string) {
  return useApiMutation({
    mutationFn: (driverId: string) =>
      api.patch<RefillRow>(`/filling-orders/${encodeURIComponent(refillId)}/assign`, { driverId }).then((r) => r.data),
  });
}

/** After an assign: the list, the drawer, the Today card and the refill's activity. */
export async function invalidateRefills(queryClient: QueryClient, refillId?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: refillKeys.all }),
    queryClient.invalidateQueries({ queryKey: qk.summary() }),
    refillId ? queryClient.invalidateQueries({ queryKey: qk.activity.record('refill', refillId) }) : Promise.resolve(),
  ]);
}
