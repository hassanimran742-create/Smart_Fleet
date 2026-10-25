import type { TFunction } from 'i18next';
import type { FillingOrderDto, RefillCounts, RefillLineDto, RefillStage } from '@smartfleet/shared-types';
import { deriveRefillStage } from '@smartfleet/shared-utils';
import { resolveStatus, type ResolvedStatus } from '../../../ui/statusTables';

/**
 * [Inc 3] The shop's view of a refill (UX_MOBILE §8.1; Inc 2/3 spec §4.1, §4.3): the stage chip with its
 * count, the one big count of the detail and its timeline. Plain logic (the status tables are type-only
 * imports), so the API's unit tests can load it.
 */

/** The server sends `stage` on every refill; an older answer without one is derived the Inc 3 way. */
export function stageOf(refill: Pick<FillingOrderDto, 'stage' | 'status' | 'counts'>): RefillStage {
  return refill.stage ?? deriveRefillStage({ status: refill.status, counts: refill.counts, increment: 3 });
}

/** The count after the stage's words in the list's chip: "Picking up empties · 1 of 2". */
export function stageCount(stage: RefillStage, counts: RefillCounts): { done: number; total: number } | null {
  switch (stage) {
    case 'PICKING_UP':
      return { done: counts.picked, total: counts.requested };
    case 'COMING_BACK':
      return { done: counts.filled, total: counts.picked };
    case 'BACK_AT_STORE':
      return { done: counts.received, total: counts.picked };
    default:
      return null;
  }
}

/** The stage chip's look and words, with the count where the cylinders are moving. Null for an unknown stage. */
export function refillChip(stage: RefillStage, counts: RefillCounts, t: TFunction): ResolvedStatus | null {
  const base = resolveStatus('refill', stage, t);
  if (!base) return null;
  const count = stageCount(stage, counts);
  return count ? { ...base, label: t('refill.list.progress', { stage: base.label, done: count.done, total: count.total }) } : base;
}

export type RefillCountVerb = 'picked' | 'filled' | 'back';

/**
 * The detail's CountBar while the refill moves (hidden otherwise): picked of requested while picking up,
 * filled of picked at the station and coming back, back of picked once the store receives them.
 */
export function detailCount(stage: RefillStage, counts: RefillCounts): { done: number; total: number; verb: RefillCountVerb } | null {
  switch (stage) {
    case 'PICKING_UP':
    case 'PICKED_UP':
      return { done: counts.picked, total: counts.requested, verb: 'picked' };
    case 'AT_STATION':
    case 'COMING_BACK':
      return { done: counts.filled, total: counts.picked, verb: 'filled' };
    case 'BACK_AT_STORE':
      return { done: counts.received, total: counts.picked, verb: 'back' };
    default:
      return null;
  }
}

export type RefillStepKey = 'requested' | 'assigned' | 'pickedUp' | 'filled' | 'back' | 'done' | 'cancelled';
export type RefillStepState = 'done' | 'current' | 'todo' | 'stopped';

export interface RefillStep {
  key: RefillStepKey;
  state: RefillStepState;
  /** ISO time of the step, when known. */
  at: string | null;
  /** A finished step's count ("2 of 2"). */
  count: { done: number; total: number } | null;
  /** The last step of a refill that finished with fewer filled than picked up. */
  doneShort?: { filled: number; picked: number };
}

/** The newest of a set of times, or null. */
function newest(times: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const at of times) {
    if (at && (best === null || Date.parse(at) > Date.parse(best))) best = at;
  }
  return best;
}

const ORDER: readonly RefillStage[] = [
  'NEEDS_DRIVER',
  'DRIVER_ASSIGNED',
  'PICKING_UP',
  'PICKED_UP',
  'AT_STATION',
  'COMING_BACK',
  'BACK_AT_STORE',
  'DONE',
];

/**
 * The timeline (S18): Requested · Driver assigned · Picked up · Filled · Back at store · Done, without
 * counts in the labels; a finished step shows its count as its detail. A refill that came back with
 * nothing filled shows Filled as the neutral stopped mark, never a tick. A cancelled refill ends with
 * Cancelled.
 */
export function refillSteps(refill: FillingOrderDto): RefillStep[] {
  const stage = stageOf(refill);
  const counts = refill.counts;
  const lines: readonly RefillLineDto[] = refill.cylinders ?? [];
  const requested: RefillStep = { key: 'requested', state: 'done', at: refill.createdAt, count: null };
  if (stage === 'CANCELLED') {
    return [requested, { key: 'cancelled', state: 'stopped', at: refill.cancelledAt ?? null, count: null }];
  }
  const at = Math.max(0, ORDER.indexOf(stage));
  const reached = (target: RefillStage) => at >= ORDER.indexOf(target);
  const stateFor = (doneFrom: RefillStage, currentFrom: RefillStage): RefillStepState =>
    reached(doneFrom) ? 'done' : reached(currentFrom) ? 'current' : 'todo';

  // Coming back, back at store or done: filled, or (brought back unfilled) the stopped mark.
  const filledState: RefillStepState = reached('COMING_BACK')
    ? counts.filled === 0
      ? 'stopped'
      : 'done'
    : reached('PICKED_UP')
      ? 'current'
      : 'todo';
  const short = stage === 'DONE' && counts.filled < counts.picked;

  return [
    requested,
    {
      key: 'assigned',
      state: stateFor('DRIVER_ASSIGNED', 'NEEDS_DRIVER'),
      at: reached('DRIVER_ASSIGNED') ? (refill.assignedAt ?? null) : null,
      count: null,
    },
    {
      key: 'pickedUp',
      state: stateFor('PICKED_UP', 'DRIVER_ASSIGNED'),
      at: reached('PICKED_UP') ? newest(lines.map((line) => line.pickedUpAt)) ?? refill.pickedUpAt ?? null : null,
      count: reached('PICKED_UP') ? { done: counts.picked, total: counts.requested } : null,
    },
    {
      key: 'filled',
      state: filledState,
      at: filledState === 'done' ? newest(lines.map((line) => line.filledAt)) : null,
      count: filledState === 'done' || filledState === 'stopped' ? { done: counts.filled, total: counts.picked } : null,
    },
    {
      key: 'back',
      state: stateFor('DONE', 'COMING_BACK'),
      at: reached('DONE') ? newest(lines.map((line) => line.returnedAt)) ?? refill.completedAt : null,
      count: reached('DONE') ? { done: counts.received, total: counts.picked } : null,
    },
    {
      key: 'done',
      state: reached('DONE') ? 'done' : 'todo',
      at: reached('DONE') ? refill.completedAt : null,
      count: null,
      ...(short ? { doneShort: { filled: counts.filled, picked: counts.picked } } : {}),
    },
  ];
}
