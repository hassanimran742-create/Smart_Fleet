import { qk } from '../../../api/keys';

/**
 * Query keys the shop screens need beyond the foundation's `qk` (api/keys.ts). Each one sits under a
 * `qk` prefix, so the Appendix C invalidations reach it: `qk.clients` covers a customer's addresses,
 * `qk.orders.all` covers tracking and quotes.
 */
export const shopKeys = {
  /** `GET /distributors/me` (Profile). */
  distributorMe: ['distributor', 'me'] as const,
  /** `GET /cylinder-types`: rarely changes. */
  cylinderTypes: ['cylinderTypes'] as const,
  /** `POST /orders/quote` for one order body (S9 step 3). */
  orderQuote: (signature: string) => [...qk.orders.all, 'quote', signature] as const,
  /** `GET /orders/:id/tracking` while the order is on the way. */
  tracking: (orderId: string) => [...qk.orders.all, 'tracking', orderId] as const,
  /** [Inc 2] `GET /orders/:id/confirmation`: under `qk.orders.all`, so an order refresh reaches it. */
  confirmation: (orderId: string) => [...qk.orders.all, 'confirmation', orderId] as const,
  /** [Inc 3] `GET /filling-orders/:id`: under `['refills']`, beside `qk.refills.mine`. */
  refill: (id: string) => ['refills', 'byId', id] as const,
  /**
   * [Inc 3] The last day-end upload's answer (its differences, or its row errors). The server can't
   * list the differences again, so Check and send reads them from here (set by the upload, no fetch).
   */
  dayEndUpload: (date: string) => ['dayEndUpload', date] as const,
} as const;

/** Cylinder sizes change only when the office adds one. */
export const CYLINDER_TYPES_STALE_MS = 10 * 60_000;
