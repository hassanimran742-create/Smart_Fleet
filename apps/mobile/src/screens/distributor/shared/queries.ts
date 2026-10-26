import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type { ClientDto, OrderDto, OrderListTab, Page } from '@smartfleet/shared-types';
import type { ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { fetchClients, fetchCylinderTypes, fetchOrdersPage, type CylinderTypeRow } from './api';
import { CYLINDER_TYPES_STALE_MS, shopKeys } from './keys';

/**
 * The shop's shared queries. Every screen that reads a key reads it through here, with the same
 * options, so the cache holds one shape per key: My orders, Home's active rows and the customer
 * list's "Recent" all share `qk.orders.list(tab)` (UX_MOBILE Appendix C).
 */

export type OrderPages = InfiniteData<Page<OrderDto>>;

/**
 * `GET /orders?tab=active|done`, page by page (S10). Pass `refetchInterval` to poll while on screen,
 * and `enabled: false` to read only what is cached.
 */
export function useOrderPages(tab: OrderListTab, options: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useInfiniteQuery<Page<OrderDto>, ApiError, OrderPages, ReturnType<typeof qk.orders.list>, string | null>({
    queryKey: qk.orders.list(tab),
    queryFn: ({ pageParam }) => fetchOrdersPage(tab, pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: options.refetchInterval ?? false,
    enabled: options.enabled ?? true,
  });
}

/** The newest orders of a list: its first page, or undefined before it has loaded. */
export function firstPageOf(data: OrderPages | undefined): OrderDto[] | undefined {
  return data?.pages[0]?.items;
}

/** `GET /clients`: the shop's customers with each address's live price status. */
export function useClients(options: { enabled?: boolean } = {}) {
  return useQuery<ClientDto[], ApiError>({ queryKey: qk.clients, queryFn: fetchClients, enabled: options.enabled ?? true });
}

/** `GET /cylinder-types`: the sizes a shop can order or refill. Rarely changes. */
export function useCylinderTypes() {
  return useQuery<CylinderTypeRow[], ApiError>({
    queryKey: shopKeys.cylinderTypes,
    queryFn: fetchCylinderTypes,
    staleTime: CYLINDER_TYPES_STALE_MS,
  });
}
