/**
 * The confirmation snapshot (CUSTOMER_PAGE §3): what the public page shows, frozen when the order is
 * delivered. It holds the shop's name and phone, the order number, the delivery time and the stop's two
 * lists by size; never the customer's name, address, any money or a cylinder number (the link can be
 * forwarded).
 */
import type { ConfirmationSnapshot } from '@smartfleet/shared-types';

/** The three states a take-back is tapped as. */
export type ReturnState = 'EMPTY' | 'PART_FILLED' | 'FULL';
const STATE_ORDER: Record<ReturnState, number> = { EMPTY: 0, PART_FILLED: 1, FULL: 2 };

/** A size's weight as Prisma returns it (Decimal), or as a number or text. */
export type Weight = { toString(): string } | number | string;

export interface SnapshotSize {
  cylinderTypeId: string;
  weightKg: Weight;
}

export interface SnapshotInput {
  shop: { name: string; phoneE164: string | null };
  orderNo: string;
  deliveredAt: Date;
  /** One entry per cylinder on the stop's GIVEN list. */
  given: SnapshotSize[];
  /** One entry per cylinder on the stop's TAKEN_BACK list, with the tapped return state. */
  takenBack: Array<SnapshotSize & { state: ReturnState }>;
  /** The stop's unlabelled returns, counted by size and state. */
  unlabelled: Array<SnapshotSize & { state: ReturnState; count: number }>;
}

function weightOf(weight: Weight): number {
  const value = Number(typeof weight === 'number' ? weight : weight.toString());
  return Number.isFinite(value) ? value : 0;
}

/** A size printed from `CylinderType.weightKg` without trailing zeros, plus " kg": "11.8 kg", "6 kg". */
export function sizeLabel(weight: Weight): string {
  return `${String(weightOf(weight))} kg`;
}

/**
 * Builds the snapshot: `delivered` groups the GIVEN list by size, ascending by weight; `takenBack`
 * groups the TAKEN_BACK list by size and state, plus the unlabelled counts, ascending by weight, then
 * Empty, Part-filled, Full, then labelled before unlabelled. Groups with nothing in them are left out.
 */
export function buildSnapshot(input: SnapshotInput): ConfirmationSnapshot {
  const delivered = new Map<string, { cylinderTypeId: string; weight: number; count: number }>();
  for (const row of input.given) {
    const entry = delivered.get(row.cylinderTypeId) ?? { cylinderTypeId: row.cylinderTypeId, weight: weightOf(row.weightKg), count: 0 };
    entry.count += 1;
    delivered.set(row.cylinderTypeId, entry);
  }

  type Back = { cylinderTypeId: string; weight: number; state: ReturnState; count: number; unlabelled: boolean };
  const back = new Map<string, Back>();
  const add = (row: SnapshotSize & { state: ReturnState }, count: number, unlabelled: boolean) => {
    if (count <= 0) return;
    const key = `${row.cylinderTypeId}|${row.state}|${unlabelled ? 'u' : 'l'}`;
    const entry = back.get(key) ?? { cylinderTypeId: row.cylinderTypeId, weight: weightOf(row.weightKg), state: row.state, count: 0, unlabelled };
    entry.count += count;
    back.set(key, entry);
  };
  for (const row of input.takenBack) add(row, 1, false);
  for (const row of input.unlabelled) add(row, row.count, true);

  const bySize = (a: { weight: number; cylinderTypeId: string }, b: { weight: number; cylinderTypeId: string }) =>
    a.weight - b.weight || a.cylinderTypeId.localeCompare(b.cylinderTypeId);

  return {
    v: 1,
    shop: { name: input.shop.name, phoneE164: input.shop.phoneE164 },
    orderNo: input.orderNo,
    deliveredAt: input.deliveredAt.toISOString(),
    delivered: [...delivered.values()]
      .sort(bySize)
      .map((entry) => ({ cylinderTypeId: entry.cylinderTypeId, size: sizeLabel(entry.weight), count: entry.count })),
    takenBack: [...back.values()]
      .sort((a, b) => bySize(a, b) || STATE_ORDER[a.state] - STATE_ORDER[b.state] || Number(a.unlabelled) - Number(b.unlabelled))
      .map((entry) => ({
        cylinderTypeId: entry.cylinderTypeId,
        size: sizeLabel(entry.weight),
        state: entry.state,
        count: entry.count,
        unlabelled: entry.unlabelled,
      })),
  };
}

/** Reads a stored snapshot (`delivery_confirmations.snapshot`), tolerating a missing list. */
export function readSnapshot(value: unknown): ConfirmationSnapshot {
  const raw = (value ?? {}) as Partial<ConfirmationSnapshot>;
  return {
    v: 1,
    shop: { name: raw.shop?.name ?? '', phoneE164: raw.shop?.phoneE164 ?? null },
    orderNo: raw.orderNo ?? '',
    deliveredAt: raw.deliveredAt ?? new Date(0).toISOString(),
    delivered: Array.isArray(raw.delivered) ? raw.delivered : [],
    takenBack: Array.isArray(raw.takenBack) ? raw.takenBack : [],
  };
}
