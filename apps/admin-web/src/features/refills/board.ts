import type { Page, RefillStage } from '@smartfleet/shared-types';
import type { RefillRow } from './api';
import type { RefillTab } from './search';

/**
 * The Refills tabs and their lists (UX_ADMIN §4.1). Each tab is its own server list (API_CONTRACT §1.3:
 * `GET /filling-orders?tab&q&limit&cursor`, the Orders board's shape), so a refill waiting for a driver
 * stays in Needs a driver however many newer refills there are, and the tab counts are the server's.
 * No React, i18n or HTTP here, so it is unit-tested on its own (`__tests__/board.spec.ts`).
 */

/** The stages behind each tab (UX_ADMIN §4.1): In progress is Driver assigned through Back at store. */
export const TAB_STAGES: { readonly [T in RefillTab]: readonly RefillStage[] } = {
  'needs-driver': ['NEEDS_DRIVER'],
  'in-progress': ['DRIVER_ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'AT_STATION', 'COMING_BACK', 'BACK_AT_STORE'],
  done: ['DONE'],
  cancelled: ['CANCELLED'],
};

/** The i18n key of each tab (`refills:tabs.<key>`, `refills:empty.<key>`) and its name in `counts`. */
export const TAB_KEYS = {
  'needs-driver': 'needsDriver',
  'in-progress': 'inProgress',
  done: 'done',
  cancelled: 'cancelled',
} as const satisfies Record<RefillTab, string>;

export function tabOf(refill: Pick<RefillRow, 'stage'>): RefillTab {
  const tab = (Object.keys(TAB_STAGES) as RefillTab[]).find((id) => TAB_STAGES[id].includes(refill.stage));
  return tab ?? 'in-progress';
}

/** The size of each tab, counted by the server over every refill; the search doesn't change them. */
export type RefillTabCounts = { [T in RefillTab as (typeof TAB_KEYS)[T]]: number };

/** One page of one tab: its refills (Needs a driver oldest first, the others newest first) and every tab's size. */
export interface RefillBoardPage extends Page<RefillRow> {
  counts: RefillTabCounts;
}

/** A page as the Refills page keeps it: with the tab it was asked for (a page kept on screen while another tab loads is that tab's). */
export interface RefillTabPage extends RefillBoardPage {
  tab: RefillTab;
}

export const REFILLS_PAGE_SIZE = 30;
/** The longest search the server takes (a longer one would be refused, and the table would show an error). */
export const REFILLS_SEARCH_MAX = 100;

export interface RefillBoardFilters {
  tab: RefillTab;
  q?: string;
}

/** The query of one page of one tab. */
export function refillBoardParams(filters: RefillBoardFilters, cursor: string | null) {
  const q = filters.q?.trim().slice(0, REFILLS_SEARCH_MAX);
  return { tab: filters.tab, q: q || undefined, limit: REFILLS_PAGE_SIZE, cursor: cursor ?? undefined };
}

/** A refill matches the search by its number or its distributor's name: every word, in any letter case. */
export function matchesRefill(refill: Pick<RefillRow, 'shortCode' | 'distributor'>, q: string | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${refill.shortCode ?? ''} ${refill.distributor.businessName}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * A server from before the tab lists ignores `tab` and answers one array of refills: sort it into the
 * tab here (Needs a driver oldest first, the others newest first), count every tab from it, and offer
 * no next page.
 */
export function boardFromList(rows: readonly RefillRow[], filters: RefillBoardFilters): RefillBoardPage {
  const counts: RefillTabCounts = { needsDriver: 0, inProgress: 0, done: 0, cancelled: 0 };
  for (const refill of rows) counts[TAB_KEYS[tabOf(refill)]] += 1;
  const order = filters.tab === 'needs-driver' ? 1 : -1;
  const items = rows
    .filter((refill) => tabOf(refill) === filters.tab && matchesRefill(refill, filters.q))
    .sort((a, b) => order * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  return { counts, items, nextCursor: null };
}

/** The pages' rows in order, each refill once (a refill that moved while the pages were fetched one by one could come twice). */
export function boardRows(pages: readonly Page<RefillRow>[]): RefillRow[] {
  const seen = new Set<string>();
  const rows: RefillRow[] = [];
  for (const page of pages) {
    for (const refill of page.items) {
      if (seen.has(refill.id)) continue;
      seen.add(refill.id);
      rows.push(refill);
    }
  }
  return rows;
}
