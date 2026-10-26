import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnySettingRow, SettingKey } from '@smartfleet/shared-types';
import { api } from '../../api/client';
import { toApiError } from '../../api/errors';
import { qk } from '../../api/keys';

/**
 * `GET /settings` and `PATCH /settings/:key` (API_CONTRACT §7.13). The rows are read by the Settings page
 * and by the top-up drawer (the mismatch rule, the limits and the company account).
 */

/** `GET /settings` (office): every key with its value, default, form hints and who changed it last. */
export function useSettingRows() {
  return useQuery({
    queryKey: qk.settings.list(),
    queryFn: async ({ signal }) => (await api.get<AnySettingRow[]>('/settings', { signal })).data,
  });
}

/** `PATCH /settings/:key { value, reason }`: the updated row. Errors are normalised to ApiError. */
export async function patchSetting(key: SettingKey, value: unknown, reason: string): Promise<AnySettingRow> {
  try {
    return (await api.patch<AnySettingRow>(`/settings/${encodeURIComponent(key)}`, { value, reason })).data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** After a save: the settings, the public config (module switches, limits), the activity log and the badges. */
export function useInvalidateAfterSettings(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.settings.all }),
      queryClient.invalidateQueries({ queryKey: qk.appConfig() }),
      queryClient.invalidateQueries({ queryKey: qk.activity.all }),
      queryClient.invalidateQueries({ queryKey: qk.summary() }),
    ]);
  };
}

/** Replaces one row in the cached list (the PATCH answer), so the page shows "Changed … by …" at once. */
export function useReplaceSettingRow(): (row: AnySettingRow) => void {
  const queryClient = useQueryClient();
  return (row) => {
    queryClient.setQueryData<AnySettingRow[]>(qk.settings.list(), (rows) =>
      rows ? rows.map((current) => (current.key === row.key ? row : current)) : rows,
    );
  };
}
