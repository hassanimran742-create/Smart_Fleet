import type { DayCloseStatus } from '@smartfleet/shared-types';
import { searchChoice } from '../../app/search';

/** The Day-end tabs (UX_ADMIN §4.3): the first is the default and leaves `tab` out of the URL. */
export const DAY_END_TABS = ['to-approve', 'open', 'approved'] as const;
export type DayEndTab = (typeof DAY_END_TABS)[number];

/** Each tab's status (API_CONTRACT §10.2): To approve SUBMITTED, Open OPEN, Approved APPROVED. */
export const DAY_END_TAB_STATUS: { readonly [T in DayEndTab]: DayCloseStatus } = {
  'to-approve': 'SUBMITTED',
  open: 'OPEN',
  approved: 'APPROVED',
};

/** `/day-end?tab=` */
export interface DayEndSearch {
  tab?: DayEndTab;
}

export function validateDayEndSearch(raw: Record<string, unknown>): DayEndSearch {
  return { tab: searchChoice(DAY_END_TABS, raw.tab) };
}
