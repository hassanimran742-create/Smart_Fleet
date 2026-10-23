import type { AdminSummaryDto } from '@smartfleet/shared-types';

/** The badge counts the navigation shows, from the summary (all 0 while it hasn't loaded). */
export interface NavBadgeCounts {
  /**
   * What waits for the office (UX_ADMIN §1.3, G07-22): top-ups to check + orders needing a driver, plus
   * open customer problems from Inc 2. It is the Today badge and the "(n)" of the browser tab. Missing
   * prices and distributors waiting to start are Today cards only: they are standing conditions, so they
   * would keep the count above zero when nothing is waiting.
   */
  waiting: number;
  needsDriver: number;
  topupsToCheck: number;
}

export function navBadgeCounts(summary: AdminSummaryDto | undefined): NavBadgeCounts {
  if (!summary) return { waiting: 0, needsDriver: 0, topupsToCheck: 0 };
  const topupsToCheck = summary.topups.toCheck;
  const needsDriver = summary.orders.needsDriver;
  const waiting = topupsToCheck + needsDriver + (summary.problems?.open ?? 0);
  return { waiting, needsDriver, topupsToCheck };
}
