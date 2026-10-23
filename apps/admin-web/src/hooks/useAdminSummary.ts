import { useQuery } from '@tanstack/react-query';
import type { AdminSummaryDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { qk } from '../api/keys';
import { isOfficeRole, useAuthStore } from '../store/auth';

/** UX_ADMIN §1.7: the summary is polled every 20 seconds (paused while the tab is in the background). */
export const SUMMARY_POLL_MS = 20_000;

/**
 * `GET /admin/summary` (office): the Today page, the navigation badges and the browser-tab count share
 * this one query. Runs only for a signed-in super admin.
 */
export function useAdminSummary(options: { enabled?: boolean } = {}) {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  return useQuery({
    queryKey: qk.summary(),
    queryFn: async ({ signal }) => (await api.get<AdminSummaryDto>('/admin/summary', { signal })).data,
    enabled: Boolean(token) && isOfficeRole(role) && (options.enabled ?? true),
    refetchInterval: SUMMARY_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export { navBadgeCounts, type NavBadgeCounts } from './navBadgeCounts';
