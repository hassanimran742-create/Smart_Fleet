import { describe, expect, it } from '@jest/globals';
import type { FillingOrderStatus, RefillStage } from '@smartfleet/shared-types';
import type { RefillRow } from '../api';
import {
  boardFromList,
  boardRows,
  matchesRefill,
  refillBoardParams,
  REFILLS_PAGE_SIZE,
  REFILLS_SEARCH_MAX,
  TAB_KEYS,
  TAB_STAGES,
  tabOf,
} from '../board';
import { REFILL_TABS } from '../search';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-10-25T09:00:00.000Z');

let next = 0;
function refill(stage: RefillStage, status: FillingOrderStatus, daysAgo: number, shop = 'Ahmed Gas', code = 'AG'): RefillRow {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    distributorId: '00000000-0000-4000-8000-0000000000aa',
    status,
    stage,
    counts: { requested: 2, picked: 0, filled: 0, received: 0 },
    cylinderTypeId: '00000000-0000-4000-8000-0000000000bb',
    sizeLabel: '11.8 kg',
    fillingStation: { id: '00000000-0000-4000-8000-0000000000cc', name: 'Lahore Filling Station' },
    requestedCount: 2,
    pickedUpEmptyCount: null,
    filledCount: null,
    pricePerCylinderPaisa: '0',
    totalCostPaisa: '0',
    assignedDriver: null,
    assignedVehicle: null,
    pickupStoreId: null,
    cancellationReason: null,
    createdAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    completedAt: null,
    shortCode: `${code}-R${String(next).padStart(3, '0')}`,
    distributor: { id: '00000000-0000-4000-8000-0000000000aa', businessName: shop, code },
    pickupStore: null,
  };
}

describe('Refills tabs (UX_ADMIN §4.1): each tab is its own server list', () => {
  it('REV23 contract-compat-06 every tab asks GET /filling-orders for its own list, a page at a time', () => {
    for (const tab of REFILL_TABS) {
      expect(refillBoardParams({ tab }, null)).toEqual({ tab, q: undefined, limit: REFILLS_PAGE_SIZE, cursor: undefined });
    }
    // "Load more" and a search stay on the server too: the cursor of the last page and the words typed.
    expect(refillBoardParams({ tab: 'done', q: 'bilal' }, 'cursor-1')).toEqual({ tab: 'done', q: 'bilal', limit: 30, cursor: 'cursor-1' });
    expect(refillBoardParams({ tab: 'in-progress', q: '' }, null).q).toBeUndefined();
    // The server takes at most 100 characters; a longer search is cut rather than refused.
    expect(refillBoardParams({ tab: 'done', q: 'x'.repeat(120) }, null).q).toHaveLength(REFILLS_SEARCH_MAX);
  });

  it('REV23 robustness-jobs-05 a server that answers one array still gets its open refills sorted into their tabs', () => {
    // A server from before the tab lists ignores `tab` and sends every refill it has, newest first.
    const waitingLongest = refill('NEEDS_DRIVER', 'PENDING', 120, 'Bilal Gas', 'BG');
    const waiting = refill('NEEDS_DRIVER', 'PENDING', 2);
    const onTheWay = refill('COMING_BACK', 'FILLED', 30);
    const back = refill('BACK_AT_STORE', 'FILLED', 90);
    const done = refill('DONE', 'COMPLETED', 1);
    const cancelled = refill('CANCELLED', 'CANCELLED', 3);
    const legacyFailed = refill('CANCELLED', 'FAILED', 200);
    const list = [done, waiting, cancelled, onTheWay, back, waitingLongest, legacyFailed];

    const queue = boardFromList(list, { tab: 'needs-driver' });
    // The queue is oldest first: the refill waiting longest is on top.
    expect(queue.items.map((row) => row.id)).toEqual([waitingLongest.id, waiting.id]);
    expect(queue.counts).toEqual({ needsDriver: 2, inProgress: 2, done: 1, cancelled: 2 });
    expect(queue.nextCursor).toBeNull();

    // The other tabs are newest first; a refill whose cylinders are still out stays In progress.
    expect(boardFromList(list, { tab: 'in-progress' }).items.map((row) => row.id)).toEqual([onTheWay.id, back.id]);
    expect(boardFromList(list, { tab: 'done' }).items.map((row) => row.id)).toEqual([done.id]);
    expect(boardFromList(list, { tab: 'cancelled' }).items.map((row) => row.id)).toEqual([cancelled.id, legacyFailed.id]);

    // The search narrows the tab's rows, never the counts.
    const searched = boardFromList(list, { tab: 'needs-driver', q: 'bilal' });
    expect(searched.items.map((row) => row.id)).toEqual([waitingLongest.id]);
    expect(searched.counts.needsDriver).toBe(2);
  });

  it('every stage has exactly one tab, and each tab has its count', () => {
    const stages = REFILL_TABS.flatMap((tab) => TAB_STAGES[tab]);
    expect(new Set(stages).size).toBe(stages.length);
    for (const tab of REFILL_TABS) {
      for (const stage of TAB_STAGES[tab]) expect(tabOf({ stage })).toBe(tab);
    }
    expect(Object.values(TAB_KEYS).sort()).toEqual(['cancelled', 'done', 'inProgress', 'needsDriver']);
  });

  it('a search matches the refill number or the distributor, every word, in any letter case', () => {
    const row = refill('NEEDS_DRIVER', 'PENDING', 1, 'Bilal Gas', 'BG');
    expect(matchesRefill(row, undefined)).toBe(true);
    expect(matchesRefill(row, 'bilal  GAS')).toBe(true);
    expect(matchesRefill(row, row.shortCode?.toLowerCase())).toBe(true);
    expect(matchesRefill(row, 'ahmed')).toBe(false);
  });

  it('pages fetched one by one show each refill once', () => {
    const a = refill('DONE', 'COMPLETED', 1);
    const b = refill('DONE', 'COMPLETED', 2);
    const c = refill('DONE', 'COMPLETED', 3);
    // b moved between the two page requests and came in both.
    expect(boardRows([{ items: [a, b], nextCursor: 'x' }, { items: [b, c], nextCursor: null }]).map((row) => row.id)).toEqual([a.id, b.id, c.id]);
  });
});
