export type UUID = string;
export type ISODateString = string;

/** An ISO-8601 UTC instant on the wire, e.g. "2026-10-21T11:12:00.000Z" (API_CONTRACT §1.1). */
export type IsoDateTime = ISODateString;

/** A plain calendar date, `YYYY-MM-DD`: business dates and expense dates (API_CONTRACT §1.1). */
export type IsoDate = string;

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Address {
  label: string;
  location: GeoPoint;
}

/** Offset pages used by older endpoints. New list endpoints return {@link Page}. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Money on the wire: integer paisa as a JSON **string of digits** (API_CONTRACT §1.1).
 * "345000" is Rs 3,450. Signed amounts (statement rows) carry a leading "-".
 * The API holds it as `BigInt`; apps convert with `toPaisa` and print it with `formatRs`
 * (both in @smartfleet/shared-utils). 1 rupee = 100 paisa.
 */
export type Paisa = string;

/** What a request body accepts for a `*Paisa` field: an integer or a digit string. */
export type PaisaInput = number | string;

/**
 * A cursor page (API_CONTRACT §1.3). Lists take `?limit` (at most 100, default 30) and `&cursor`;
 * the cursor is opaque. `nextCursor` is null on the last page.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Query parameters shared by every cursor-paged list. */
export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface IdName {
  id: UUID;
  name: string;
}
