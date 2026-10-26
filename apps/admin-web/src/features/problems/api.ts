import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import type { CaseDto, Page } from '@smartfleet/shared-types';
import type { ResolveCaseInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Customer problems (API_CONTRACT §9.6): the office's open cases, oldest first, and closing one with a
 * note. A case is a record only: no route here moves money.
 */

/** A queue page refreshes itself (UX_ADMIN §1.7), as Top-ups and Orders do. */
export const PROBLEMS_POLL_MS = 20_000;
const PAGE_SIZE = 50;
/** The alert type of a customer problem (`GET /alerts?type=…`); any other type is the legacy list. */
const CASE_TYPE = 'CUSTOMER_PROBLEM';

export const problemKeys = {
  all: ['problems'] as const,
  open: () => ['problems', 'open'] as const,
};

/** `GET /alerts?type=CUSTOMER_PROBLEM&status=OPEN&cursor`: the open problems, oldest first, with "Load more". */
export function useOpenProblems() {
  return useInfiniteQuery({
    queryKey: problemKeys.open(),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<Page<CaseDto>>('/alerts', {
          params: { type: CASE_TYPE, status: 'OPEN', limit: PAGE_SIZE, cursor: pageParam ?? undefined },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: PROBLEMS_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * `POST /alerts/:id/resolve { note }` (5–300 characters). A repeat of your own close answers 200 with
 * `X-Already-Applied` (success); someone else's close is 409 `CASE_ALREADY_RESOLVED { by }`.
 */
export function useResolveProblem(caseId: string) {
  return useApiMutation({
    mutationFn: (body: ResolveCaseInput) =>
      api.post<CaseDto>(`/alerts/${encodeURIComponent(caseId)}/resolve`, body).then((r) => r.data),
  });
}

/** After a close: the list, the Today card and badge, and the order (its `caseOpen`). */
export async function invalidateProblems(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: problemKeys.all }),
    queryClient.invalidateQueries({ queryKey: qk.summary() }),
    queryClient.invalidateQueries({ queryKey: qk.orders.all }),
  ]);
}
