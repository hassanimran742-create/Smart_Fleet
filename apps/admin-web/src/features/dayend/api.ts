import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import type {
  AdminDayEndDetail,
  AdminDayEndListItem,
  DayCloseStatus,
  DayEndApproveResult,
  FileUrlResult,
  Page,
} from '@smartfleet/shared-types';
import type { DayEndApproveInput, DayEndReopenInput, DayEndSendBackInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Day-end for the office (API_CONTRACT §10.2): the list by status, one day's review, and approve, send
 * back and reopen. Every route answers 403 FEATURE_DISABLED while `dayEnd.enabled` is off. Day-end never
 * moves money (ADR-17).
 */

const PAGE_SIZE = 50;
/** The list refreshes quietly, so a newly sent day-end shows without a reload. */
export const DAY_END_POLL_MS = 60_000;

export const dayEndKeys = {
  all: ['day-end'] as const,
  list: (status: DayCloseStatus) => ['day-end', 'list', status] as const,
  detail: (id: string) => ['day-end', 'detail', id] as const,
};

/** `GET /admin/day-end?status&cursor&limit`: newest business date first, with "Load more". */
export function useDayEnds(status: DayCloseStatus) {
  return useInfiniteQuery({
    queryKey: dayEndKeys.list(status),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<Page<AdminDayEndListItem>>('/admin/day-end', {
          params: { status, limit: PAGE_SIZE, cursor: pageParam ?? undefined },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: DAY_END_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** `GET /admin/day-end/:id`: the day, its differences, the fixes approval would apply and both sheets. */
export function useDayEnd(dayEndId: string) {
  return useQuery({
    queryKey: dayEndKeys.detail(dayEndId),
    queryFn: async ({ signal }) => (await api.get<AdminDayEndDetail>(`/admin/day-end/${encodeURIComponent(dayEndId)}`, { signal })).data,
    refetchOnWindowFocus: true,
  });
}

/**
 * `POST /admin/day-end/:id/approve { version }`: applies the listed fixes and locks the day; it returns
 * the cylinders it registered, whose labels need printing. Another version uploaded since: 409
 * `DAY_VERSION_CHANGED`. A repeat answers 200 with `X-Already-Applied`.
 */
export function useApproveDayEnd(dayEndId: string) {
  return useApiMutation({
    mutationFn: (body: DayEndApproveInput) =>
      api.post<DayEndApproveResult>(`/admin/day-end/${encodeURIComponent(dayEndId)}/approve`, body).then((r) => r.data),
  });
}

/** `POST /admin/day-end/:id/send-back { reason }` (5–300): back to the shop to fix and send again. */
export function useSendBackDayEnd(dayEndId: string) {
  return useApiMutation({
    mutationFn: (body: DayEndSendBackInput) =>
      api.post<AdminDayEndDetail>(`/admin/day-end/${encodeURIComponent(dayEndId)}/send-back`, body).then((r) => r.data),
  });
}

/** `POST /admin/day-end/:id/reopen { reason }` (5–300, rare): the shop can upload again; fixes made stay. */
export function useReopenDayEnd(dayEndId: string) {
  return useApiMutation({
    mutationFn: (body: DayEndReopenInput) =>
      api.post<AdminDayEndDetail>(`/admin/day-end/${encodeURIComponent(dayEndId)}/reopen`, body).then((r) => r.data),
  });
}

/** A sheet's download address (`GET /files/:id/url`, signed for an hour): asked for at each click. */
export async function fileUrl(fileId: string): Promise<string> {
  return (await api.get<FileUrlResult>(`/files/${encodeURIComponent(fileId)}/url`)).data.url;
}

/** After a decision: every list, the review, the Today card and badge, and the day's activity. */
export async function invalidateDayEnd(queryClient: QueryClient, dayEndId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: dayEndKeys.all }),
    queryClient.invalidateQueries({ queryKey: qk.summary() }),
    queryClient.invalidateQueries({ queryKey: qk.activity.record('DayClose', dayEndId) }),
  ]);
}
