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
  /** [Inc 2] Open customer problems (Customer problems' badge). */
  problems: number;
  /** [Inc 3] Day-end sheets waiting for approval (Day-end's badge); 0 while day-end is off. */
  dayEnd: number;
}

export function navBadgeCounts(summary: AdminSummaryDto | undefined): NavBadgeCounts {
  if (!summary) return { waiting: 0, needsDriver: 0, topupsToCheck: 0, problems: 0, dayEnd: 0 };
  const topupsToCheck = summary.topups.toCheck;
  const needsDriver = summary.orders.needsDriver;
  const problems = summary.problems?.open ?? 0;
  const waiting = topupsToCheck + needsDriver + problems;
  return { waiting, needsDriver, topupsToCheck, problems, dayEnd: summary.dayEnd?.toApprove ?? 0 };
}
