import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminTopupsDto,
  AdminTopupTab,
  AnySettingRow,
  PaymentDto,
  SettingKey,
  SettingValue,
  TopupAccount,
  TopupAmountMismatchPolicy,
  TopupApproveResult,
  TopupRejectReason,
} from '@smartfleet/shared-types';
import type { ApproveTopupInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';
import { useSettingRows } from '../settings/api';

/**
 * Queries and mutations of Top-up requests (API_CONTRACT §7.9). Every key is a leaf of `qk.topups`, so
 * one invalidation of `qk.topups.all` refreshes the list, its counts and an open drawer.
 */

/** UX_ADMIN §1.7: the queue refreshes every 20 seconds, an open drawer every 10 (paused in a background tab). */
export const TOPUPS_POLL_MS = 20_000;
export const TOPUP_DRAWER_POLL_MS = 10_000;

const PAGE_SIZE = 30;

export interface TopupListFilters {
  tab: AdminTopupTab;
  q?: string;
}

/** `GET /admin/topups?tab&q&cursor`: the queue with its counts and today's approved total, cursor-paged. */
export function useTopupList(filters: TopupListFilters) {
  return useInfiniteQuery({
    queryKey: qk.topups.list({ tab: filters.tab, q: filters.q ?? null }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<AdminTopupsDto>('/admin/topups', {
          params: { tab: filters.tab, q: filters.q || undefined, limit: PAGE_SIZE, cursor: pageParam ?? undefined },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: TOPUPS_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** `GET /payments/:id` (office view): one request, re-polled while its drawer is open. */
export function useTopup(paymentId: string) {
  return useQuery({
    queryKey: qk.topups.detail(paymentId),
    queryFn: async ({ signal }) => (await api.get<PaymentDto>(`/payments/${encodeURIComponent(paymentId)}`, { signal })).data,
    refetchInterval: TOPUP_DRAWER_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** What the review drawer needs from `GET /settings`: the mismatch rule, the limits and the company account. */
export interface TopupRules {
  onAmountMismatch: TopupAmountMismatchPolicy;
  minPaisa: number;
  maxPaisa: number;
  account: TopupAccount | null;
}

function rowValue<K extends SettingKey>(rows: readonly AnySettingRow[], key: K): SettingValue<K> | undefined {
  const row = rows.find((candidate) => candidate.key === key);
  return row ? (row.value as SettingValue<K>) : undefined;
}

/** The top-up rules the drawer follows (the server applies the same ones again). */
export function useTopupRules(): {
  rules: TopupRules | null;
  isPending: boolean;
  error: unknown;
  retry: () => void;
  retrying: boolean;
} {
  const settings = useSettingRows();
  const rows = settings.data;
  const retry = () => void settings.refetch();
  if (!rows) return { rules: null, isPending: settings.isPending, error: settings.error, retry, retrying: settings.isFetching };
  return {
    rules: {
      onAmountMismatch: rowValue(rows, 'topup.onAmountMismatch') ?? 'CREDIT_BANK_AMOUNT',
      minPaisa: rowValue(rows, 'topup.minPaisa') ?? 0,
      maxPaisa: rowValue(rows, 'topup.maxPaisa') ?? Number.MAX_SAFE_INTEGER,
      account: rowValue(rows, 'topup.account') ?? null,
    },
    isPending: false,
    error: null,
    retry,
    retrying: settings.isFetching,
  };
}

/** A POST answer, with whether it was a repeat of a finished action (`X-Already-Applied`). */
export interface ActionAnswer<T> {
  data: T;
  alreadyApplied: boolean;
}

function wasAlreadyApplied(headers: unknown): boolean {
  const get = (headers as { get?: (name: string) => unknown } | undefined)?.get;
  const value =
    typeof get === 'function'
      ? get.call(headers, 'x-already-applied')
      : (headers as Record<string, unknown> | undefined)?.['x-already-applied'];
  return value === 'true' || value === true;
}

/**
 * `POST /payments/:id/approve` with the drawer's Idempotency-Key. The key is made when the drawer opens
 * and reused on every retry, so a retry after a network drop can never add the money twice; the server
 * also credits a top-up once by its own key (`topup:<id>`).
 */
export function useApproveTopup(paymentId: string) {
  return useApiMutation({
    idempotent: true,
    mutationFn: async (body: Pick<ApproveTopupInput, 'bankReference' | 'bankAmountPaisa' | 'bankTime'>, { headers }) => {
      const response = await api.post<TopupApproveResult>(`/payments/${encodeURIComponent(paymentId)}/approve`, body, { headers });
      return { data: response.data, alreadyApplied: wasAlreadyApplied(response.headers) } satisfies ActionAnswer<TopupApproveResult>;
    },
  });
}

export interface RejectTopupBody {
  reasonCode: TopupRejectReason;
  note?: string;
}

/** `POST /payments/:id/reject { reasonCode, note? }`: no money moves; a repeat answers `X-Already-Applied`. */
export function useRejectTopup(paymentId: string) {
  return useApiMutation({
    idempotent: true,
    mutationFn: async (body: RejectTopupBody, { headers }) => {
      const response = await api.post<{ payment: PaymentDto }>(`/payments/${encodeURIComponent(paymentId)}/reject`, body, { headers });
      return { data: response.data, alreadyApplied: wasAlreadyApplied(response.headers) } satisfies ActionAnswer<{ payment: PaymentDto }>;
    },
  });
}

/** Everything a top-up decision changes: the queue, the drawer, wallets, the activity log and the badges. */
export function useInvalidateAfterTopup(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.topups.all }),
      queryClient.invalidateQueries({ queryKey: qk.wallets.all }),
      queryClient.invalidateQueries({ queryKey: qk.activity.all }),
      queryClient.invalidateQueries({ queryKey: qk.summary() }),
    ]);
  };
}
