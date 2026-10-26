import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { CylinderHistoryDto } from '@smartfleet/shared-types';
import { api } from '../../api/client';

/**
 * A cylinder's holder and moves (`GET /cylinders/:code/history`, API_CONTRACT §9.4): Find cylinder, and
 * the check of each number named in the office's manual delivery. The office passes the QR value or the
 * full number (AG-C0042); no match is 404 NOT_FOUND.
 */

export const cylinderKeys = {
  all: ['cylinders'] as const,
  history: (code: string) => ['cylinders', 'history', code] as const,
};

async function getHistory(code: string, signal?: AbortSignal): Promise<CylinderHistoryDto> {
  return (await api.get<CylinderHistoryDto>(`/cylinders/${encodeURIComponent(code)}/history`, { signal })).data;
}

/** The Find cylinder page. */
export function useCylinderHistory(code: string) {
  return useQuery({
    queryKey: cylinderKeys.history(code),
    queryFn: ({ signal }) => getHistory(code, signal),
    enabled: code.length > 0,
    refetchOnWindowFocus: true,
  });
}

/** One lookup outside a component's render (each chip of the manual delivery dialog). */
export function fetchCylinderHistory(queryClient: QueryClient, code: string): Promise<CylinderHistoryDto> {
  return queryClient.fetchQuery({
    queryKey: cylinderKeys.history(code),
    queryFn: ({ signal }) => getHistory(code, signal),
    // A cylinder moves often: an answer older than a few seconds is checked again.
    staleTime: 5_000,
  });
}
