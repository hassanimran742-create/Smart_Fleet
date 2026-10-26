import type { Prisma } from '@prisma/client';
import {
  ORDER_BOARD_TAB_STATUSES,
  ORDER_LIST_TAB_STATUSES,
  type OrderBoardTab,
  type OrderListTab,
} from '@smartfleet/shared-types';
import type { DayRange } from './support/business-day';

/**
 * The one definition of each order tab (G04-06), shared by `GET /orders?tab`, `GET /orders/board`,
 * `GET /admin/summary` and `GET /distributor/home`. The status sets come from shared-types; the date
 * windows are business days (the current one, and the 6 before it for cancelled and failed).
 */

/** How many business days before today the cancelled-and-failed tab reaches back. */
export const CANCELLED_FAILED_DAYS_BEFORE = 6;

/** The shop's tabs: any date, newest first. */
export function listTabWhere(tab: OrderListTab): Prisma.OrderWhereInput {
  return { status: { in: [...ORDER_LIST_TAB_STATUSES[tab]] } };
}

/** The office board's tabs. `today` is the current business day; `week` today and the 6 before it. */
export function boardTabWhere(tab: OrderBoardTab, today: DayRange, week: DayRange): Prisma.OrderWhereInput {
  switch (tab) {
    case 'needs-driver':
    case 'in-progress':
    case 'all':
      return { status: { in: [...ORDER_BOARD_TAB_STATUSES[tab]] } };
    case 'done-today':
      return { status: 'DELIVERED', deliveredAt: { gte: today.start, lt: today.end } };
    case 'cancelled-failed':
      return {
        OR: [
          { status: 'CANCELLED', cancelledAt: { gte: week.start, lt: week.end } },
          { status: 'FAILED', failedAt: { gte: week.start, lt: week.end } },
        ],
      };
  }
}

/** `needs-driver` is oldest first (who waits longest); every other tab is newest first. */
export function boardTabAscending(tab: OrderBoardTab): boolean {
  return tab === 'needs-driver';
}
