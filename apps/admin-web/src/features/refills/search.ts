import { searchChoice, searchText } from '../../app/search';

/** The Refills tabs (UX_ADMIN §4.1): the first is the default and leaves `tab` out of the URL. */
export const REFILL_TABS = ['needs-driver', 'in-progress', 'done', 'cancelled'] as const;
export type RefillTab = (typeof REFILL_TABS)[number];

/** `/refills?tab=&q=` */
export interface RefillsSearch {
  tab?: RefillTab;
  q?: string;
}

export function validateRefillsSearch(raw: Record<string, unknown>): RefillsSearch {
  return { tab: searchChoice(REFILL_TABS, raw.tab), q: searchText(raw.q) };
}
