import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminTopupsDto,
  AdminWalletDetail,
  AdminWalletRow,
  OrderBoardDto,
  OrderDto,
  Page,
  PaymentDto,
  StatementItem,
  StatementKind,
  UUID,
  WalletCorrectionResult,
} from '@smartfleet/shared-types';
import type { WalletCorrectionInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Queries and mutations of Wallets (API_CONTRACT §7.8). Keys are leaves of `qk.wallets`, so a correction
 * or an approved top-up refreshes the list, the wallet and its history with one invalidation.
 */

const HISTORY_PAGE_SIZE = 50;
/** The statement download reads big pages (the most a list gives, API_CONTRACT §1.3). */
const STATEMENT_PAGE_SIZE = 100;

/** `GET /admin/wallets` (office): every distributor's balance, money being checked and last approved top-up. */
export function useWalletList() {
  return useQuery({
    queryKey: qk.wallets.list(),
    queryFn: async ({ signal }) => (await api.get<AdminWalletRow[]>('/admin/wallets', { signal })).data,
    refetchOnWindowFocus: true,
  });
}

/** `GET /admin/distributors/:id/wallet`: the summary plus the live integrity check (it only reads). */
export function useWalletDetail(distributorId: UUID) {
  return useQuery({
    queryKey: qk.wallets.detail(distributorId),
    queryFn: async ({ signal }) =>
      (await api.get<AdminWalletDetail>(`/admin/distributors/${encodeURIComponent(distributorId)}/wallet`, { signal })).data,
    refetchOnWindowFocus: true,
  });
}

/** The history filters as the statement route takes them: business dates and a list of kinds. */
export interface StatementFilters {
  from: string;
  to: string;
  /** Empty for every kind. */
  kinds: readonly StatementKind[];
}

function statementParams(filters: StatementFilters, limit: number, cursor: string | null) {
  return {
    from: filters.from,
    to: filters.to,
    kind: filters.kinds.length > 0 ? filters.kinds.join(',') : undefined,
    limit,
    cursor: cursor ?? undefined,
  };
}

function statementPath(distributorId: UUID): string {
  return `/admin/distributors/${encodeURIComponent(distributorId)}/wallet/statement`;
}

/** `GET /admin/distributors/:id/wallet/statement` (office view, with notes and authors), "Load more" pages. */
export function useWalletHistory(distributorId: UUID, filters: StatementFilters) {
  return useInfiniteQuery({
    queryKey: qk.wallets.statement(distributorId, { from: filters.from, to: filters.to, kinds: [...filters.kinds] }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<Page<StatementItem>>(statementPath(distributorId), {
          params: statementParams(filters, HISTORY_PAGE_SIZE, pageParam),
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/**
 * Whether the wallet has any history at all (`statement?limit=1`, no dates), asked only when the default
 * filters show nothing: a new wallet says "No money in or out yet.", an older one "Nothing in these dates."
 */
export function useWalletHasHistory(distributorId: UUID, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.wallets.statement(distributorId, { any: true })] as const,
    queryFn: async ({ signal }) =>
      (await api.get<Page<StatementItem>>(statementPath(distributorId), { params: { limit: 1 }, signal })).data.items.length > 0,
    enabled,
    staleTime: 60_000,
  });
}

/** Every history row of the filters, up to `max` (more is `{ tooMany: true }`), for the CSV download. */
export async function fetchStatementRows(
  distributorId: UUID,
  filters: StatementFilters,
  max: number,
): Promise<{ rows: StatementItem[]; tooMany: boolean }> {
  const rows: StatementItem[] = [];
  let cursor: string | null = null;
  do {
    const { data }: { data: Page<StatementItem> } = await api.get<Page<StatementItem>>(statementPath(distributorId), {
      params: statementParams(filters, STATEMENT_PAGE_SIZE, cursor),
    });
    rows.push(...data.items);
    if (rows.length > max) return { rows: [], tooMany: true };
    cursor = data.nextCursor;
  } while (cursor);
  return { rows, tooMany: false };
}

/** `POST /admin/distributors/:id/wallet/corrections`, which requires an Idempotency-Key (one per dialog). */
export function useRecordCorrection(distributorId: UUID) {
  return useApiMutation({
    idempotent: true,
    mutationFn: async (body: WalletCorrectionInput, { headers }) =>
      (
        await api.post<WalletCorrectionResult>(
          `/admin/distributors/${encodeURIComponent(distributorId)}/wallet/corrections`,
          body,
          { headers },
        )
      ).data,
  });
}

/** After a correction: the wallets, the activity log and the summary. */
export function useInvalidateAfterCorrection(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.wallets.all }),
      queryClient.invalidateQueries({ queryKey: qk.activity.all }),
      queryClient.invalidateQueries({ queryKey: qk.summary() }),
      queryClient.invalidateQueries({ queryKey: qk.distributors.all }),
    ]);
  };
}

/** How many of the distributor's latest top-ups and orders the correction's picker lists, each. */
const RELATED_LATEST = 10;
/** The top-up search matches names by part, so read a few more rows and keep this distributor's. */
const RELATED_TOPUP_READ = 30;

/**
 * The correction's "Top-up or order" picker (website spec W14): this distributor's 10 latest top-ups
 * (`GET /admin/topups?tab=all&q=<name>`, kept to their own) and 10 latest orders
 * (`GET /orders/board?tab=all&distributorId=`). It reads the existing routes: no API change.
 */
export function useRelatedChoices(distributorId: UUID, distributorName: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.wallets.all, 'related-latest', distributorId] as const,
    queryFn: async ({ signal }) => {
      const [topups, orders] = await Promise.all([
        api.get<AdminTopupsDto>('/admin/topups', {
          params: { tab: 'all', q: distributorName || undefined, limit: RELATED_TOPUP_READ },
          signal,
        }),
        api.get<OrderBoardDto>('/orders/board', { params: { tab: 'all', distributorId, limit: RELATED_LATEST }, signal }),
      ]);
      return {
        topups: topups.data.items.filter((item) => item.distributor?.id === distributorId).slice(0, RELATED_LATEST),
        orders: orders.data.items.filter((item) => !item.distributor || item.distributor.id === distributorId).slice(0, RELATED_LATEST),
      };
    },
    enabled,
    staleTime: 60_000,
  });
}

/** A related top-up or order the correction can point at (G01-02). */
export type RelatedRecord =
  | { kind: 'TOPUP'; id: UUID; shortCode: string; payment: PaymentDto }
  | { kind: 'ORDER'; id: UUID; shortCode: string; order: OrderDto };

/**
 * Finds a top-up (`GET /admin/topups?tab=all&q=AG-T031`) or an order
 * (`GET /orders/board?tab=all&q=AG-0142&distributorId=`) among this distributor's own, by its exact
 * number; null when it isn't theirs.
 */
export async function findRelatedRecord(
  distributorId: UUID,
  target: { kind: 'TOPUP' | 'ORDER'; shortCode: string },
  signal?: AbortSignal,
): Promise<RelatedRecord | null> {
  const wanted = target.shortCode.toUpperCase();
  if (target.kind === 'TOPUP') {
    const { data } = await api.get<AdminTopupsDto>('/admin/topups', { params: { tab: 'all', q: wanted, limit: 10 }, signal });
    const payment = data.items.find((item) => item.shortCode.toUpperCase() === wanted && item.distributor?.id === distributorId);
    return payment ? { kind: 'TOPUP', id: payment.id, shortCode: payment.shortCode, payment } : null;
  }
  const { data } = await api.get<OrderBoardDto>('/orders/board', {
    params: { tab: 'all', q: wanted, distributorId, limit: 10 },
    signal,
  });
  const order = data.items.find(
    (item) => item.shortCode.toUpperCase() === wanted && (!item.distributor || item.distributor.id === distributorId),
  );
  return order ? { kind: 'ORDER', id: order.id, shortCode: order.shortCode, order } : null;
}
