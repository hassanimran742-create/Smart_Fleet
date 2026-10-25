import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type { AuditLogDto, FillingOrderDto, Page } from '@smartfleet/shared-types';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';
import { boardFromList, refillBoardParams, type RefillBoardFilters, type RefillBoardPage, type RefillTabPage } from './board';

/**
 * Refills for the office (API_CONTRACT §7.11, §10.1): one tab's list, one refill with its picked
 * cylinders, and assigning a driver. Refills carry no money (ADR-16); the office has no cancel and no
 * "Mark complete" (the shop's last receive scan completes a refill, `PATCH …/complete` is 410 from Inc 3).
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
  /** Every tab's list, for invalidating them and for finding a listed refill. */
  lists: () => ['refills', 'list'] as const,
  list: (filters: RefillBoardFilters) => ['refills', 'list', filters] as const,
  detail: (id: string) => ['refills', 'detail', id] as const,
};

/**
 * `GET /filling-orders?tab&q&limit&cursor` (office): one tab, filtered, sorted and paged by the server,
 * with "Load more"; `counts` (every tab's size) come with every page. It refreshes every 15 seconds. The
 * last answer stays while a new one loads (a new search keeps its rows); each page carries the tab it was
 * asked for, so the page shows a tab opened for the first time as a skeleton, never another tab's rows.
 */
export function useRefillBoard(filters: RefillBoardFilters) {
  return useInfiniteQuery({
    queryKey: refillKeys.list(filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<RefillTabPage> => {
      const { data } = await api.get<RefillBoardPage | RefillRow[]>('/filling-orders', {
        params: refillBoardParams(filters, pageParam),
        signal,
      });
      return { ...(Array.isArray(data) ? boardFromList(data, filters) : data), tab: filters.tab };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: REFILLS_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** A refill already on screen in one of the tab lists (the drawer's title while it loads), else undefined. */
export function listedRefill(queryClient: QueryClient, refillId: string): RefillRow | undefined {
  for (const [, data] of queryClient.getQueriesData<InfiniteData<RefillTabPage>>({ queryKey: refillKeys.lists() })) {
    for (const page of data?.pages ?? []) {
      const refill = page.items.find((row) => row.id === refillId);
      if (refill) return refill;
    }
  }
  return undefined;
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
