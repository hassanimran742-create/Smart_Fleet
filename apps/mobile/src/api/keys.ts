import type { QueryClient } from '@tanstack/react-query';

/**
 * Query keys (UX_MOBILE Appendix C). Every screen uses these, never ad-hoc arrays, so one
 * invalidation reaches every list. Prefix keys (`…All`) match every variant below them.
 */
export const qk = {
  /** `GET /app/config` (public), cached 5 minutes. */
  appConfig: ['appConfig'] as const,
  /** `GET /users/me`. */
  me: ['me'] as const,
  /** `GET /distributor/home`. */
  home: ['home'] as const,

  wallet: {
    all: ['wallet'] as const,
    statementAll: ['wallet', 'statement'] as const,
    /** `GET /wallet/statement?kind…`. */
    statement: (filter: string | Record<string, unknown> = 'all') => ['wallet', 'statement', filter] as const,
    /** `GET /ledger/balance` (compatibility route, used by the first side menu). */
    legacyBalance: ['wallet', 'legacyBalance'] as const,
  },

  topups: {
    all: ['topups'] as const,
    /** `GET /payments/topup-info`. */
    info: ['topups', 'info'] as const,
    /** `GET /payments/mine`. */
    mine: ['topups', 'mine'] as const,
    /** `GET /payments/:id`; polls 30 s while being checked. */
    byId: (id: string) => ['topups', 'byId', id] as const,
  },

  /** `GET /clients`. */
  clients: ['clients'] as const,

  pricing: {
    all: ['pricing'] as const,
    /** `GET /pricing/quote?lat&lng`; stale after 5 minutes. */
    quote: (lat: number, lng: number) => ['pricing', 'quote', lat, lng] as const,
  },

  orders: {
    all: ['orders'] as const,
    listAll: ['orders', 'list'] as const,
    /** `GET /orders?tab=`; polls 30 s. */
    list: (tab: string) => ['orders', 'list', tab] as const,
    /** `GET /orders/:id`; polls 20 s while on the way. */
    byId: (id: string) => ['orders', 'byId', id] as const,
  },

  refills: {
    /** `GET /filling-orders/mine`. */
    mine: ['refills', 'mine'] as const,
  },
  /** `GET /filling-stations`. */
  stations: ['stations'] as const,

  driver: {
    /** `GET /driver/home` (Inc 2). */
    home: ['driver', 'home'] as const,
  },
  /** `GET /trips/:id`; polls 15 s, 5 s on Unload (Inc 2). */
  trip: (id: string) => ['trip', id] as const,

  store: {
    /** `GET /store/incoming` (Inc 2); polls 15 s. */
    incoming: ['store', 'incoming'] as const,
  },
  cases: {
    /** `GET /alerts/mine` (Inc 2). */
    mine: ['cases', 'mine'] as const,
  },
  /** `/day-end/:date` (Inc 3). */
  dayEnd: (date: string) => ['dayEnd', date] as const,
  /** `GET /day-end` (Inc 3): the shop's days, read by Home's row and S19 to find a day that waits. */
  dayEndList: ['dayEnd', 'list'] as const,
} as const;

/** Freshness, in ms (Appendix C notes). Everything else uses the 30-second default. */
export const STALE_MS = {
  appConfig: 5 * 60_000,
  pricingQuote: 5 * 60_000,
} as const;

/** Polling intervals, in ms; pass them through `useFocusedInterval` so they run only on screen. */
export const POLL_MS = {
  ordersList: 30_000,
  orderOnTheWay: 20_000,
  topupBeingChecked: 30_000,
  trip: 15_000,
  /** The passive Unload screen (Inc 2): the store scans the van's cylinders in. */
  tripUnload: 5_000,
  storeIncoming: 15_000,
  driverHome: 30_000,
} as const;

/** Invalidation rules (Appendix C). */
export const invalidate = {
  /** An order was placed or cancelled. Also set `qk.orders.byId(id)` from the response. */
  orderPlacedOrCancelled(client: QueryClient): Promise<void> {
    return Promise.all([
      client.invalidateQueries({ queryKey: qk.home }),
      client.invalidateQueries({ queryKey: qk.wallet.statementAll }),
      client.invalidateQueries({ queryKey: qk.wallet.legacyBalance }),
      client.invalidateQueries({ queryKey: qk.orders.listAll }),
    ]).then(() => undefined);
  },
  /** A top-up request was sent. */
  topupSent(client: QueryClient): Promise<void> {
    return Promise.all([
      client.invalidateQueries({ queryKey: qk.home }),
      client.invalidateQueries({ queryKey: qk.topups.mine }),
      client.invalidateQueries({ queryKey: qk.topups.info }),
    ]).then(() => undefined);
  },
  /** A trip step finished (Inc 2). */
  tripStepComplete(client: QueryClient, tripId: string): Promise<void> {
    return Promise.all([
      client.invalidateQueries({ queryKey: qk.trip(tripId) }),
      client.invalidateQueries({ queryKey: qk.driver.home }),
    ]).then(() => undefined);
  },
};
