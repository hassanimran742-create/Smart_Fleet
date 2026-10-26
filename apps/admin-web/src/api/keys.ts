/**
 * TanStack Query keys (UX_ADMIN §1.7). One tree per area, so a mutation invalidates exactly what it
 * changed, for example `queryClient.invalidateQueries({ queryKey: qk.topups.all })`, and the summary that
 * feeds Today and the navigation badges with `qk.summary()`.
 *
 * Lanes add leaves under their own area in their feature's `api.ts` (`[...qk.topups.all, 'proof', id]`)
 * rather than new roots. `.all` is for invalidating an area; query with `.list()`, `.detail()` or a leaf.
 * The legacy screens use older flat keys (['drivers'], ['orders-current'], ...): a new query never uses
 * one of those exactly, because the data shapes differ.
 */

type Params = Readonly<Record<string, unknown>>;

function area<const A extends string>(name: A) {
  return {
    all: [name] as const,
    list: (params: Params = {}) => [name, 'list', params] as const,
    detail: (id: string) => [name, 'detail', id] as const,
  };
}

export const qk = {
  /** `GET /app/config` (public): switched-off modules, environment, limits. */
  appConfig: () => ['app-config'] as const,
  /** `GET /users/me`: shared with the legacy profile screen, which uses the same key and route. */
  me: () => ['me'] as const,
  /** `GET /admin/summary`: Today, the navigation badges and the browser-tab count. */
  summary: () => ['admin-summary'] as const,
  /** `GET /alerts/unread-count`: the Alerts badge (the same key the old sidebar used). */
  alertsUnread: () => ['alerts-unread'] as const,

  topups: area('topups'),
  orders: { ...area('orders'), board: (params: Params = {}) => ['orders', 'board', params] as const },
  wallets: {
    ...area('wallets'),
    statement: (distributorId: string, params: Params = {}) => ['wallets', 'statement', distributorId, params] as const,
  },
  prices: { ...area('prices'), grid: (distributorId: string) => ['prices', 'grid', distributorId] as const },
  distributors: area('distributors'),
  expenses: {
    ...area('expenses'),
    summary: (params: Params = {}) => ['expenses', 'summary', params] as const,
    types: (params: Params = {}) => ['expenses', 'types', params] as const,
  },
  settings: area('settings'),
  activity: {
    ...area('activity'),
    /** One record's history, for `<ActivityList resourceType resourceId />`. */
    record: (resourceType: string, resourceId: string) => ['activity', 'record', resourceType, resourceId] as const,
  },
  drivers: area('drivers'),
  vehicles: area('vehicles'),
  zones: area('zones'),
  cylinderTypes: area('cylinder-types'),
  files: { url: (fileId: string) => ['files', 'url', fileId] as const },
} as const;
