import { useQuery } from '@tanstack/react-query';
import type { MeDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { qk } from '../api/keys';
import { useAuthStore } from '../store/auth';

/** The signed-in person (`GET /users/me`), for the name in the shell. Shares its cache with My profile. */
export function useMe() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: qk.me(),
    queryFn: async ({ signal }) => (await api.get<MeDto>('/users/me', { signal })).data,
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
  });
}
