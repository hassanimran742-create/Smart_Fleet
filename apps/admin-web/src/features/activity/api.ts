import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AuditLogDto, IsoDate, Page, UserRoleValue, UUID } from '@smartfleet/shared-types';
import { api } from '../../api/client';
import { qk } from '../../api/keys';

/**
 * `GET /audit-logs` (API_CONTRACT §7.13): office only, newest first, cursor-paged. The server filters by
 * who and by date (business dates, 03:00 cut-off); the "What" filter groups actions, which the route
 * can't do yet, so the page filters the loaded rows and reads further pages as needed.
 */

/** The page reads big pages, so a "What" filter fills the screen in few requests. */
export const ACTIVITY_PAGE_SIZE = 100;
const RECORD_PAGE_SIZE = 10;

export interface ActivityQuery {
  actorUserId?: UUID;
  from?: IsoDate;
  to?: IsoDate;
}

function asPage(data: Page<AuditLogDto> | AuditLogDto[]): Page<AuditLogDto> {
  // Older APIs answered with a plain array.
  return Array.isArray(data) ? { items: data, nextCursor: null } : data;
}

/** The Activity page: every row matching who and when, page by page. */
export function useActivityLog(query: ActivityQuery) {
  return useInfiniteQuery({
    queryKey: qk.activity.list({ ...query }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      asPage(
        (
          await api.get<Page<AuditLogDto> | AuditLogDto[]>('/audit-logs', {
            params: {
              actorUserId: query.actorUserId,
              from: query.from,
              to: query.to,
              limit: ACTIVITY_PAGE_SIZE,
              cursor: pageParam ?? undefined,
            },
            signal,
          })
        ).data,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** One record's history (a top-up request), newest first. */
export function useRecordActivity(resourceType: string, resourceId: string) {
  return useInfiniteQuery({
    queryKey: [...qk.activity.all, 'record-lines', resourceType, resourceId] as const,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      asPage(
        (
          await api.get<Page<AuditLogDto> | AuditLogDto[]>('/audit-logs', {
            params: { resourceType, resourceId, limit: RECORD_PAGE_SIZE, cursor: pageParam ?? undefined },
            signal,
          })
        ).data,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** A person the "Who" filter offers (`GET /users`, safe fields). */
export interface ActivityPerson {
  id: UUID;
  name: string;
  role: UserRoleValue;
  shopName: string | null;
}

interface UserRow {
  id: UUID;
  name: string | null;
  role: UserRoleValue;
  distributorProfile?: { businessName?: string | null } | null;
}

/** The roles whose people act in the pilot: the office, the shops and the drivers. */
const PEOPLE_ROLES: readonly UserRoleValue[] = ['SUPER_ADMIN', 'DISTRIBUTOR', 'DRIVER'];

/** `GET /users` (office): the people who can appear under "Who", sorted by name. */
export function useActivityPeople() {
  return useQuery({
    queryKey: [...qk.activity.all, 'people'] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<UserRow[]>('/users', { signal });
      return data
        .filter((user) => PEOPLE_ROLES.includes(user.role) && user.name)
        .map(
          (user): ActivityPerson => ({
            id: user.id,
            name: user.name ?? '',
            role: user.role,
            shopName: user.distributorProfile?.businessName ?? null,
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 5 * 60_000,
  });
}
