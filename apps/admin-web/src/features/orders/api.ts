import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AssignDriverResult,
  AuditLogDto,
  ConfirmationShareResult,
  ConfirmationView,
  DriverOfficeDto,
  OrderBoardDto,
  OrderBoardTab,
  OrderCancelResult,
  OrderDto,
  Page,
  TripDetailDto,
} from '@smartfleet/shared-types';
import type { ManualDeliveryV2Input, OfficeCancelOrderInput, OfficeFailOrderInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Queries and mutations of the Orders board and the order drawer (API_CONTRACT §7.6). Keys are leaves
 * of `qk.orders`, so one invalidation of `qk.orders.all` refreshes the board and every open drawer.
 */

/** UX_ADMIN §1.7: the board polls every 15 seconds, an open drawer every 10 (paused in a background tab). */
export const BOARD_POLL_MS = 15_000;
export const DRAWER_POLL_MS = 10_000;
const BOARD_PAGE_SIZE = 30;
/** Drivers, vans and distributors change rarely; the dialogs refetch them when they open. */
const LISTS_STALE_MS = 60_000;

export interface BoardFilters {
  tab: OrderBoardTab;
  q?: string;
  distributorId?: string;
}

/** `GET /orders/board?tab&q&distributorId&cursor`, with "Load more". `counts` come with every page. */
export function useOrderBoard(filters: BoardFilters) {
  return useInfiniteQuery({
    queryKey: qk.orders.board({ ...filters }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<OrderBoardDto>('/orders/board', {
          params: {
            tab: filters.tab,
            q: filters.q || undefined,
            distributorId: filters.distributorId,
            limit: BOARD_PAGE_SIZE,
            cursor: pageParam ?? undefined,
          },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: BOARD_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** `GET /orders/:id` (office view: with `distributor`), polled while the drawer is open. */
export function useOrder(orderId: string) {
  return useQuery({
    queryKey: qk.orders.detail(orderId),
    queryFn: async ({ signal }) => (await api.get<OrderDto>(`/orders/${encodeURIComponent(orderId)}`, { signal })).data,
    refetchInterval: DRAWER_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The order's audit rows (`GET /audit-logs?resourceType=order&resourceId`), for who assigned or moved
 * the driver in the timeline. `version` (the order's `assignedAt`) refetches it when that changes.
 */
export function useOrderHistory(orderId: string, version: string | null) {
  return useQuery({
    queryKey: [...qk.orders.detail(orderId), 'history', version] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Page<AuditLogDto> | AuditLogDto[]>('/audit-logs', {
        params: { resourceType: 'order', resourceId: orderId, limit: 50 },
        signal,
      });
      return Array.isArray(data) ? data : data.items;
    },
    staleTime: LISTS_STALE_MS,
  });
}

/** The distributor list (the board's filter) and one distributor (an order's start store). */
export { useDistributor, useDistributors } from '../distributors/api';

/** `GET /drivers` (office view: name, van, availability, online, account status). */
export function useDriverChoices() {
  return useQuery({
    queryKey: qk.drivers.list(),
    queryFn: async ({ signal }) => (await api.get<DriverOfficeDto[]>('/drivers', { signal })).data,
    staleTime: 0,
  });
}

/**
 * Drivers with an order in progress, for "On another run" in the assign dialog. Information only:
 * a driver on another run can still be picked (ADR-12). Read from the board's In progress tab.
 */
export function useBusyDrivers() {
  return useQuery({
    queryKey: [...qk.orders.all, 'busy-drivers'] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<OrderBoardDto>('/orders/board', { params: { tab: 'in-progress', limit: 100 }, signal });
      const byDriver = new Map<string, Set<string>>();
      for (const order of data.items) {
        const driverId = order.trip?.driver.id;
        if (!driverId) continue;
        const set = byDriver.get(driverId) ?? new Set<string>();
        set.add(order.id);
        byDriver.set(driverId, set);
      }
      return byDriver;
    },
    staleTime: 0,
  });
}

/** Refreshes everything an order action can change: the board, the drawer, badges, balances, history. */
export async function invalidateAfterOrderChange(queryClient: QueryClient, orderId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.orders.all }),
    queryClient.invalidateQueries({ queryKey: qk.summary() }),
    queryClient.invalidateQueries({ queryKey: qk.activity.record('order', orderId) }),
    queryClient.invalidateQueries({ queryKey: qk.distributors.all }),
    queryClient.invalidateQueries({ queryKey: qk.wallets.all }),
  ]);
}

export function useInvalidateOrder(orderId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => invalidateAfterOrderChange(queryClient, orderId);
}

/** `POST /orders/:id/assign-driver { driverId }`. The start store is always the distributor's own. */
export function useAssignDriver(orderId: string) {
  return useApiMutation({
    mutationFn: (driverId: string) =>
      api.post<AssignDriverResult>(`/orders/${encodeURIComponent(orderId)}/assign-driver`, { driverId }).then((r) => r.data),
  });
}

/** `POST /orders/:id/cancel { reasonCode, note, confirmRefundPaisa }` with an Idempotency-Key. */
export function useCancelOrder(orderId: string) {
  return useApiMutation({
    idempotent: true,
    mutationFn: (body: OfficeCancelOrderInput, { headers }) =>
      api.post<OrderCancelResult>(`/orders/${encodeURIComponent(orderId)}/cancel`, body, { headers }).then((r) => r.data),
  });
}

/** `POST /orders/:id/fail { reasonCode, note }` (only once delivery has started). */
export function useFailOrder(orderId: string) {
  return useApiMutation({
    mutationFn: (body: OfficeFailOrderInput) =>
      api.post<OrderDto>(`/orders/${encodeURIComponent(orderId)}/fail`, body).then((r) => r.data),
  });
}

/**
 * `POST /orders/:id/manual-delivery` v2 `{ reason (10–300), cylinders: [{ code }], takenBack?: [{ code,
 * returnState }] }` (API_CONTRACT §9.5): the office records a delivery the driver couldn't scan, naming
 * each cylinder. No money moves. A repeat answers 200 with `X-Already-Applied`.
 */
export function useManualDelivery(orderId: string) {
  return useApiMutation({
    mutationFn: (body: ManualDeliveryV2Input) =>
      api.post<OrderDto>(`/orders/${encodeURIComponent(orderId)}/manual-delivery`, body).then((r) => r.data),
  });
}

/**
 * `GET /orders/:id/confirmation` (Inc 2, CUSTOMER_PAGE §10): the customer's answer and how far the link
 * got. Only for a delivered order with a confirmation, while `features.confirmations` is on; it polls
 * with the drawer. A leaf of the order, so an order change refreshes it too.
 */
export function useOrderConfirmation(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.orders.detail(orderId), 'confirmation'] as const,
    queryFn: async ({ signal }) =>
      (await api.get<ConfirmationView>(`/orders/${encodeURIComponent(orderId)}/confirmation`, { signal })).data,
    enabled,
    refetchInterval: DRAWER_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * `GET /trips/:tripId` (the office may read every trip): each stop's scan progress, for the drawer's load,
 * delivered and taken-back lines (Inc 2, UX_ADMIN §3.2). It polls with the drawer until the order is done.
 */
export function useOrderTrip(orderId: string, tripId: string | null, poll: boolean) {
  return useQuery({
    queryKey: [...qk.orders.detail(orderId), 'trip', tripId] as const,
    queryFn: async ({ signal }) => (await api.get<TripDetailDto>(`/trips/${encodeURIComponent(tripId as string)}`, { signal })).data,
    enabled: Boolean(tripId),
    refetchInterval: poll ? DRAWER_POLL_MS : false,
  });
}

/**
 * `POST /orders/:id/confirmation/share { via: 'COPY' }` with an Idempotency-Key: the link to give the
 * customer (it records "Shared … by <name> (copied)"; no money). Answered, expired or cancelled links are
 * 409 `CONFIRM_CLOSED`; 20 shares an hour per order, then 429 `RATE_LIMITED`.
 */
export function useCopyCustomerLink(orderId: string) {
  return useApiMutation({
    idempotent: true,
    mutationFn: (_: void, { headers }) =>
      api
        .post<ConfirmationShareResult>(`/orders/${encodeURIComponent(orderId)}/confirmation/share`, { via: 'COPY' }, { headers })
        .then((r) => r.data),
  });
}
