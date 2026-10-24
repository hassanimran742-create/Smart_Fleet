import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import type { DayCloseTotals, DayEndSummary } from '@smartfleet/shared-types';
import { appDayClosePlace } from '@smartfleet/shared-utils';
import type { Db } from '../orders/support/tx';
import { compareSizes, toCylinderSize } from '../pricing/size-label';

/**
 * [Inc 3] The day's counts (API_CONTRACT §10.2 `summary`): live from the cylinders, except on an APPROVED
 * day, which reads the totals frozen at approval (`day_closes.totals`, DayCloseTotals).
 *
 * - `inStore` / `onVans` / `withCustomers`: the distributor's cylinders by their app place now (a LOST
 *   cylinder is "Missing", so it is in none of them); `inStore.bySize` per size, lightest first.
 * - `deliveredToday` / `takenBackToday` / `receivedToday`: moves of its cylinders in that business day
 *   (start inclusive, end exclusive): hand-overs to customers (DELIVERED), take-backs (PICKED_UP_EMPTY), and
 *   the store's receive scans into its store (SCAN_IN).
 */

export interface DayCounts {
  summary: DayEndSummary;
  byPlace: DayCloseTotals['byPlace'];
  byState: DayCloseTotals['byState'];
  bySize: DayCloseTotals['bySize'];
  cylinders: number;
}

/** Counts the distributor's cylinders now and its moves in `range`. */
export async function countDay(
  db: Db,
  p: { distributorId: string; homeStoreId: string; range: { start: Date; end: Date } },
): Promise<DayCounts> {
  const [groups, delivered, takenBack, received] = await Promise.all([
    db.cylinder.groupBy({
      by: ['cylinderTypeId', 'custodyType', 'state'],
      where: { distributorId: p.distributorId },
      _count: { _all: true },
    }),
    db.cylinderEvent.count({
      where: { eventType: CylinderEventType.DELIVERED, createdAt: { gte: p.range.start, lt: p.range.end }, cylinder: { distributorId: p.distributorId } },
    }),
    db.cylinderEvent.count({
      where: { eventType: CylinderEventType.PICKED_UP_EMPTY, createdAt: { gte: p.range.start, lt: p.range.end }, cylinder: { distributorId: p.distributorId } },
    }),
    db.cylinderEvent.count({
      where: {
        eventType: CylinderEventType.SCAN_IN,
        toCustodyType: CustodyType.STORE,
        toCustodyId: p.homeStoreId,
        createdAt: { gte: p.range.start, lt: p.range.end },
        cylinder: { distributorId: p.distributorId },
      },
    }),
  ]);
  const typeIds = [...new Set(groups.map((group) => group.cylinderTypeId))];
  const types = typeIds.length
    ? await db.cylinderType.findMany({ where: { id: { in: typeIds } }, select: { id: true, code: true, name: true, weightKg: true } })
    : [];
  const sizes = new Map(types.map((type) => [type.id, toCylinderSize(type)]));

  const byPlace = { STORE: 0, VAN: 0, CUSTOMER: 0, NOT_FOUND: 0 };
  const byState = { FULL: 0, EMPTY: 0, PART_FILLED: 0, FAULTY: 0, LOST: 0 };
  const inStoreBySize = new Map<string, number>();
  const allBySize = new Map<string, number>();
  let cylinders = 0;
  for (const group of groups) {
    const n = group._count._all;
    cylinders += n;
    const place = appDayClosePlace({ custodyType: group.custodyType, state: group.state });
    byPlace[place] += n;
    byState[group.state as CylinderState] += n;
    allBySize.set(group.cylinderTypeId, (allBySize.get(group.cylinderTypeId) ?? 0) + n);
    if (place === 'STORE') inStoreBySize.set(group.cylinderTypeId, (inStoreBySize.get(group.cylinderTypeId) ?? 0) + n);
  }
  const ordered = (counts: Map<string, number>) =>
    [...counts.entries()]
      .map(([cylinderTypeId, count]) => ({ cylinderTypeId, count, size: sizes.get(cylinderTypeId) }))
      .sort((a, b) => (a.size && b.size ? compareSizes(a.size, b.size) : a.cylinderTypeId.localeCompare(b.cylinderTypeId)));

  return {
    summary: {
      inStore: {
        total: byPlace.STORE,
        bySize: ordered(inStoreBySize).map((row) => ({ sizeLabel: row.size?.label ?? '', count: row.count })),
      },
      onVans: byPlace.VAN,
      withCustomers: byPlace.CUSTOMER,
      deliveredToday: delivered,
      takenBackToday: takenBack,
      receivedToday: received,
    },
    byPlace,
    byState,
    bySize: ordered(allBySize).map((row) => ({ cylinderTypeId: row.cylinderTypeId, sizeLabel: row.size?.label ?? '', count: row.count })),
    cylinders,
  };
}

/** The totals an approval freezes: the counts after its fixes, and what the fixes did. */
export function frozenTotals(counts: DayCounts, fixes: DayCloseTotals['fixes'], at: Date): DayCloseTotals {
  return { ...counts, fixes, frozenAt: at.toISOString() };
}

/** Reads frozen totals back; null when the column holds something else (never written by this module). */
export function readTotals(value: unknown): DayCloseTotals | null {
  if (!value || typeof value !== 'object') return null;
  const totals = value as Partial<DayCloseTotals>;
  if (!totals.summary || typeof totals.summary !== 'object' || !totals.summary.inStore) return null;
  return totals as DayCloseTotals;
}
