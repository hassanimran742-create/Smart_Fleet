/** A refill status, as Prisma, the API and `FillingOrderStatus` of shared-types spell it. */
export type RefillStatusLike =
  | 'PENDING'
  | 'ASSIGNED'
  | 'EMPTIES_PICKED'
  | 'AT_STATION'
  | 'FILLED'
  | 'RETURNED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/** What {@link deriveRefillStage} returns: the same values as `RefillStage` in @smartfleet/shared-types. */
export type DerivedRefillStage =
  | 'NEEDS_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'PICKING_UP'
  | 'PICKED_UP'
  | 'AT_STATION'
  | 'COMING_BACK'
  | 'BACK_AT_STORE'
  | 'DONE'
  | 'CANCELLED';

/** How many cylinders a refill has at each step: the same shape as `RefillCounts` in shared-types. */
export interface RefillCountsLike {
  requested: number;
  picked: number;
  filled: number;
  received: number;
}

export interface RefillStageInput {
  status: RefillStatusLike;
  /** Missing counts are 0. */
  counts?: Partial<RefillCountsLike> | null;
  /**
   * The release whose rules apply: 1 (default) reads BACK_AT_STORE from the RETURNED status; from 3
   * the store's receive scans count, so one received cylinder is enough.
   */
  increment?: 1 | 2 | 3;
}

/**
 * The stage people see for a refill (API_CONTRACT §1.4), sent as `stage` on every refill DTO. Status
 * comes first; the counts matter only for PICKING_UP and (from Inc 3) BACK_AT_STORE. First match wins:
 *
 * | Stage | When |
 * |---|---|
 * | CANCELLED | status CANCELLED, or legacy FAILED |
 * | DONE | status COMPLETED |
 * | BACK_AT_STORE | Inc 1: status RETURNED; Inc 3: received ≥ 1 |
 * | COMING_BACK | status FILLED |
 * | AT_STATION | status AT_STATION |
 * | PICKED_UP | status EMPTIES_PICKED |
 * | PICKING_UP | status ASSIGNED and picked ≥ 1 |
 * | DRIVER_ASSIGNED | status ASSIGNED |
 * | NEEDS_DRIVER | status PENDING |
 */
export function deriveRefillStage(refill: RefillStageInput): DerivedRefillStage {
  const { status } = refill;
  if (status === 'CANCELLED' || status === 'FAILED') return 'CANCELLED';
  if (status === 'COMPLETED') return 'DONE';
  const received = count(refill.counts?.received);
  if (status === 'RETURNED' || ((refill.increment ?? 1) >= 3 && received >= 1)) return 'BACK_AT_STORE';
  if (status === 'FILLED') return 'COMING_BACK';
  if (status === 'AT_STATION') return 'AT_STATION';
  if (status === 'EMPTIES_PICKED') return 'PICKED_UP';
  if (status === 'ASSIGNED') return count(refill.counts?.picked) >= 1 ? 'PICKING_UP' : 'DRIVER_ASSIGNED';
  // PENDING; an unknown future status also waits for a driver rather than breaking a list.
  return 'NEEDS_DRIVER';
}

/** The fields Inc 1 refill rows carry (the legacy count columns). */
export interface LegacyRefillCountsInput {
  status: RefillStatusLike;
  requestedCount: number;
  pickedUpEmptyCount?: number | null;
  filledCount?: number | null;
}

/**
 * A refill's counts in Inc 1 (API_CONTRACT §1.4): from `requestedCount`, `pickedUpEmptyCount` and
 * `filledCount` (missing = 0), with received = picked once the status is RETURNED or COMPLETED.
 */
export function legacyRefillCounts(refill: LegacyRefillCountsInput): RefillCountsLike {
  const picked = count(refill.pickedUpEmptyCount);
  const back = refill.status === 'RETURNED' || refill.status === 'COMPLETED';
  return {
    requested: count(refill.requestedCount),
    picked,
    filled: count(refill.filledCount),
    received: back ? picked : 0,
  };
}

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
