import type { ConfirmationView, OrderDto } from '@smartfleet/shared-types';

/**
 * [Inc 2] What went to the customer and what came back (UX_MOBILE S14; Inc 2/3 spec §2.4), for a
 * delivered order. `GET /orders/:id` sends the visit by cylinder number (`OrderDto.visit`), so the
 * taken-back lines name each cylinder ("Empty · AG-C0011"); an answer without it falls back to the
 * customer link's frozen snapshot (sizes, states and counts, never numbers). Plain logic over the shared
 * types, so the API's unit tests can load it.
 */

export type TakenBackState = 'EMPTY' | 'PART_FILLED' | 'FULL';

export interface DeliveredLine {
  key: string;
  sizeLabel: string;
  /** Given. */
  count: number;
  /** The order's full count for the size. */
  needed: number;
  /** Fewer given than ordered: "11.8 kg · 1 of 2". */
  short: boolean;
}

export interface TakenBackLine {
  key: string;
  state: TakenBackState;
  sizeLabel: string;
  count: number;
  /** No label or another brand: "Empty · No label · 1 × 11.8 kg". */
  unlabelled: boolean;
  /** The cylinders' numbers, one line per state ("Empty · AG-C0011, AG-C0012"); absent from the snapshot. */
  numbers?: string[];
}

export interface VisitSummary {
  delivered: DeliveredLine[];
  takenBack: TakenBackLine[];
  /** Everything taken back, labelled or not. */
  takenTotal: number;
  /** The order's take-back (Σ `expectedReturnCount`). */
  expected: number;
}

const STATES: readonly TakenBackState[] = ['EMPTY', 'PART_FILLED', 'FULL'];

function asState(value: string): TakenBackState {
  return (STATES as readonly string[]).includes(value) ? (value as TakenBackState) : 'EMPTY';
}

/** The order's need per size, and a size it has with nothing given still shows, short ("11.8 kg · 0 of 2"). */
function neededBySize(order: OrderDto): Map<string, number> {
  const needed = new Map<string, number>();
  for (const line of order.lines) needed.set(line.sizeLabel, (needed.get(line.sizeLabel) ?? 0) + line.fullCount);
  return needed;
}

function deliveredLines(needed: ReadonlyMap<string, number>, given: ReadonlyMap<string, number>): DeliveredLine[] {
  const delivered: DeliveredLine[] = [...given]
    .filter(([, count]) => count > 0)
    .map(([size, count]) => {
      const ordered = needed.get(size) ?? count;
      return { key: size, sizeLabel: size, count, needed: ordered, short: count < ordered };
    });
  for (const [size, count] of needed) {
    if (count > 0 && !delivered.some((line) => line.sizeLabel === size)) {
      delivered.push({ key: size, sizeLabel: size, count: 0, needed: count, short: true });
    }
  }
  return delivered;
}

/**
 * The visit from the order's own lists (`OrderDto.visit`): delivered per size, the labelled cylinders
 * taken back as one line per state with their numbers, then the unlabelled counts. Null when the answer
 * has no visit list (an older server) or nothing was given or taken back.
 */
export function visitFromOrder(order: OrderDto): VisitSummary | null {
  const visit = order.visit;
  if (!visit) return null;
  const given = new Map<string, number>();
  for (const cylinder of visit.given) given.set(cylinder.sizeLabel, (given.get(cylinder.sizeLabel) ?? 0) + 1);

  const takenBack: TakenBackLine[] = [];
  for (const state of STATES) {
    const labelled = visit.takenBack.filter((cylinder) => cylinder.state === state);
    if (labelled.length > 0) {
      takenBack.push({
        key: `${state}:numbers`,
        state,
        sizeLabel: labelled[0].sizeLabel,
        count: labelled.length,
        unlabelled: false,
        numbers: labelled.map((cylinder) => cylinder.shortCode),
      });
    }
    for (const row of visit.unlabelled.filter((line) => line.state === state && line.count > 0)) {
      takenBack.push({ key: `${state}:u:${row.cylinderTypeId}`, state, sizeLabel: row.sizeLabel, count: row.count, unlabelled: true });
    }
  }

  return {
    delivered: deliveredLines(neededBySize(order), given),
    takenBack,
    takenTotal: takenBack.reduce((sum, line) => sum + line.count, 0),
    expected: order.lines.reduce((sum, line) => sum + line.expectedReturnCount, 0),
  };
}

export function visitFromConfirmation(order: OrderDto, view: ConfirmationView): VisitSummary {
  const needed = neededBySize(order);

  const delivered: DeliveredLine[] = view.delivered
    .filter((line) => line.count > 0)
    .map((line) => {
      const ordered = needed.get(line.size) ?? line.count;
      return { key: line.size, sizeLabel: line.size, count: line.count, needed: ordered, short: line.count < ordered };
    });
  // A size of the order with nothing given still shows, short ("11.8 kg · 0 of 2").
  for (const [size, count] of needed) {
    if (count > 0 && !delivered.some((line) => line.sizeLabel === size)) {
      delivered.push({ key: size, sizeLabel: size, count: 0, needed: count, short: true });
    }
  }

  const takenBack: TakenBackLine[] = view.takenBack
    .filter((line) => line.count > 0)
    .map((line, index) => ({
      key: `${line.size}:${line.state}:${line.unlabelled ? 'u' : 'l'}:${index}`,
      state: asState(line.state),
      sizeLabel: line.size,
      count: line.count,
      unlabelled: line.unlabelled,
    }));

  return {
    delivered,
    takenBack,
    takenTotal: takenBack.reduce((sum, line) => sum + line.count, 0),
    expected: order.lines.reduce((sum, line) => sum + line.expectedReturnCount, 0),
  };
}
