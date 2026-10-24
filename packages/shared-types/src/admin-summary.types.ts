import type { IdName, IsoDateTime, Paisa, UUID } from './common.types';

/**
 * `GET /admin/summary` (office): the Today page and the navigation badges (API_CONTRACT §7.13).
 * "Today" is the current business day (Asia/Karachi, 03:00 cut-off).
 */
export interface AdminSummaryDto {
  topups: {
    toCheck: number;
    oldestWaitingAt: IsoDateTime | null;
    approvedToday: { count: number; totalPaisa: Paisa };
  };
  orders: {
    needsDriver: number;
    oldestNeedsDriverAt: IsoDateTime | null;
    inProgress: number;
    placedToday: number;
    deliveredToday: number;
    /** Σ DEBIT_ORDER − Σ CREDIT_ORDER_REVERSAL for today's business day. */
    costTakenTodayPaisa: Paisa;
  };
  /** `zones` is how many active zones have no price for that distributor. */
  prices: { missing: { distributorId: UUID; distributorName: string; zones: number }[] };
  distributors: { waitingToStart: IdName[] };
  drivers: { onDuty: number; total: number };
  /**
   * [Inc 2] Open CUSTOMER_PROBLEM cases and the oldest one's `createdAt` (0 and null when none is
   * open). Absent before Inc 2.
   */
  problems?: { open: number; oldestOpenAt: IsoDateTime | null };
  /**
   * [Inc 3] The Today card "Refills need a driver": refills waiting for a driver (PENDING) and the oldest
   * one's `createdAt` (0 and null when none waits). Sent from the Inc 3 server; absent before it.
   */
  refills?: { needsDriver: number; oldestNeedsDriverAt: IsoDateTime | null };
  /**
   * [Inc 3] The Today card "Day-end ready to approve": days waiting for approval (SUBMITTED) and the oldest
   * of them by business date. Sent from the Inc 3 server, and left out while `dayEnd.enabled` is off.
   */
  dayEnd?: { toApprove: number; oldest: { id: UUID; businessDate: string; distributor: IdName } | null };
}

/** The same shape under the name the Inc 1 lane plan uses. */
export type AdminSummary = AdminSummaryDto;
