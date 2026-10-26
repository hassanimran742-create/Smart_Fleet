import { FillingOrderStatus, type Prisma } from '@prisma/client';
import type { Page } from '@smartfleet/shared-types';
import { optionalTextSchema, optionalUuidSchema, pageQuerySchema } from '@smartfleet/shared-validation';
import { z } from 'zod';
import type { RefillView } from './refill.mapper';

/**
 * [review23 contract-compat-06, robustness-jobs-05] The office's Refills page (UX_ADMIN §4.1) reads one tab
 * at a time from the server, each tab its own cursor list (API_CONTRACT §1.3, the Orders board's shape), so
 * a refill waiting for a driver stays in "Needs a driver" however many newer refills there are, and the
 * tab counts are the server's, over every refill.
 */

/** The tabs, in the page's order. */
export const REFILL_BOARD_TABS = ['needs-driver', 'in-progress', 'done', 'cancelled'] as const;
export type RefillBoardTab = (typeof REFILL_BOARD_TABS)[number];

/**
 * The statuses behind each tab; together they are every status. They give the stages UX_ADMIN §4.1 names:
 * Needs a driver = NEEDS_DRIVER; In progress = DRIVER_ASSIGNED to BACK_AT_STORE (RETURNED is an Inc 1
 * refill back at the store); Done = DONE; Cancelled = CANCELLED (a legacy FAILED refill reads CANCELLED).
 */
export const REFILL_TAB_STATUSES: Readonly<Record<RefillBoardTab, readonly FillingOrderStatus[]>> = {
  'needs-driver': [FillingOrderStatus.PENDING],
  'in-progress': [
    FillingOrderStatus.ASSIGNED,
    FillingOrderStatus.EMPTIES_PICKED,
    FillingOrderStatus.AT_STATION,
    FillingOrderStatus.FILLED,
    FillingOrderStatus.RETURNED,
  ],
  done: [FillingOrderStatus.COMPLETED],
  cancelled: [FillingOrderStatus.CANCELLED, FillingOrderStatus.FAILED],
};

/** A refill still open: it waits for a driver, or its cylinders aren't all back (§10.1). */
export const OPEN_REFILL_STATUSES: readonly FillingOrderStatus[] = [...REFILL_TAB_STATUSES['needs-driver'], ...REFILL_TAB_STATUSES['in-progress']];
/** A refill that is over: done or cancelled. */
export const CLOSED_REFILL_STATUSES: readonly FillingOrderStatus[] = [...REFILL_TAB_STATUSES.done, ...REFILL_TAB_STATUSES.cancelled];

/** "Needs a driver" is oldest first (who waits longest); every other tab is newest first. */
export function refillTabAscending(tab: RefillBoardTab): boolean {
  return tab === 'needs-driver';
}

/**
 * `GET /filling-orders` (office): `?tab=needs-driver|in-progress|done|cancelled&q&distributorId&driverId&limit&cursor`.
 * Without `tab` it is the legacy bare array, where `status` (one FillingOrderStatus) and `driverId` filter as
 * before: a value that isn't one of them is ignored. `limit` is 1–100 (default 30) and `cursor` the page's.
 */
export const refillListQuerySchema = pageQuerySchema.extend({
  tab: z.enum(REFILL_BOARD_TABS).optional(),
  q: optionalTextSchema(100),
  distributorId: optionalUuidSchema,
  status: z.string().optional(),
  driverId: z.string().optional(),
});
export type RefillListQuery = z.infer<typeof refillListQuerySchema>;

/** Every tab's size, with `distributorId` and `driverId` applied and `q` ignored. */
export interface RefillBoardCounts {
  needsDriver: number;
  inProgress: number;
  done: number;
  cancelled: number;
}

/** One page of one tab, and every tab's size (`GET /filling-orders?tab=…`). */
export interface RefillBoardDto extends Page<RefillView> {
  counts: RefillBoardCounts;
}

/**
 * The office search `q` (1–100 characters): part of the distributor's business name, in any letter case;
 * or the refill's number exactly, in any letter case: `AG-R007` (that distributor's), or `R007`, `007`, `7`
 * (any distributor's).
 */
export function refillSearchWhere(q: string | undefined): Prisma.FillingOrderWhereInput {
  const text = q?.trim();
  if (!text) return {};
  const or: Prisma.FillingOrderWhereInput[] = [{ distributor: { businessName: { contains: text, mode: 'insensitive' } } }];
  const full = /^([A-Za-z][A-Za-z0-9]{1,5})-R0*(\d{1,9})$/i.exec(text);
  if (full) or.push({ distributor: { code: full[1].toUpperCase() }, refillNo: Number(full[2]) });
  const bare = /^R?0*(\d{1,9})$/i.exec(text);
  if (bare) or.push({ refillNo: Number(bare[1]) });
  return { OR: or };
}
