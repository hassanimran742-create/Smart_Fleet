import type { CylinderHistoryDto, ManualDeliveryProblemReason, OrderDto } from '@smartfleet/shared-types';
import { codeOfNumber } from '../cylinders/code';

/**
 * The rules of "Mark delivered…" in Inc 2 (UX_ADMIN §3.4, API_CONTRACT §9.5), kept apart from the dialog
 * so they read as a list. The server decides: these checks only show early, on each chip, what it would
 * refuse, and only when the facts make it certain. Nothing here moves money.
 */

/** The states a taken-back cylinder can come back in. */
export const MANUAL_RETURN_STATES = ['EMPTY', 'PART_FILLED', 'FULL'] as const;
export type ManualReturnState = (typeof MANUAL_RETURN_STATES)[number];

/** Why a named cylinder can't be used: the words of `orders:manual.problem.*`. */
export type ChipProblemKind =
  | 'WRONG_OWNER'
  | 'NOT_FULL'
  | 'BLOCKED'
  | 'WRONG_SIZE'
  | 'WITH_CUSTOMER'
  | 'ON_VAN'
  | 'NOT_AVAILABLE'
  | 'NOT_WITH_THIS_CUSTOMER'
  | 'LISTED_TWICE'
  | 'UNKNOWN'
  | 'TOO_MANY'
  | 'NOT_CHECKED';

export interface ChipProblem {
  kind: ChipProblemKind;
  /** The size, for "order doesn't need 6 kg". */
  size?: string;
}

/** One cylinder named in the dialog. */
export interface NamedCylinder {
  /** The chip's identity: the code in upper case (a number named twice is one chip). */
  key: string;
  /** What is sent: the full number ("AG-C0001") or the QR value as scanned. */
  code: string;
  /** What the chip shows before "·": the cylinder's number once it is known. */
  label: string;
  status: 'checking' | 'ok' | 'problem';
  /** The cylinder the lookup found: two spellings of one cylinder (a QR value and its number) are one. */
  cylinderId?: string;
  size: { id: string; label: string } | null;
  problem: ChipProblem | null;
  /** Taken back only: the state it comes back in. */
  returnState?: ManualReturnState;
}

/** The order's distributor code ("AG"): the office view carries it, else it is read from the order number. */
export function orderDistributorCode(order: Pick<OrderDto, 'distributor' | 'shortCode'>): string | null {
  if (order.distributor?.code) return order.distributor.code;
  const match = /^([A-Z][A-Z0-9]{1,5})-\d+$/.exec(order.shortCode);
  return match ? (match[1] ?? null) : null;
}

/** Same owner: a full number of another distributor is "another shop's cylinder". */
function ownerProblem(history: CylinderHistoryDto, distributorCode: string | null): ChipProblem | null {
  const code = codeOfNumber(history.cylinder.shortCode);
  return code && distributorCode && code !== distributorCode ? { kind: 'WRONG_OWNER' } : null;
}

/**
 * A delivered cylinder, in the server's order (WRONG_OWNER, BLOCKED, NOT_FULL, WRONG_SIZE, NOT_AVAILABLE):
 * the order's distributor's, not damaged or lost, full, of a size in the order, and in the store or on
 * this trip's van. A cylinder already with this customer may be one the driver gave on this visit, which
 * the server counts as named, so it isn't flagged.
 */
export function checkDelivered(history: CylinderHistoryDto, order: OrderDto, distributorCode: string | null): ChipProblem | null {
  const owner = ownerProblem(history, distributorCode);
  if (owner) return owner;
  const { state, size } = history.cylinder;
  if (state === 'FAULTY' || state === 'LOST') return { kind: 'BLOCKED' };
  if (state !== 'FULL') return { kind: 'NOT_FULL' };
  if (!order.lines.some((line) => line.cylinderTypeId === size.id)) return { kind: 'WRONG_SIZE', size: size.label };
  const { holder } = history;
  if (holder.type === 'CLIENT' && holder.label !== order.client.name) return { kind: 'WITH_CUSTOMER' };
  if (holder.type === 'VEHICLE' && holder.label !== order.trip?.vehicle.plateNo) return { kind: 'ON_VAN' };
  return null;
}

/** A taken-back cylinder: the order's distributor's, and with this customer now. */
export function checkTakenBack(history: CylinderHistoryDto, order: OrderDto, distributorCode: string | null): ChipProblem | null {
  const owner = ownerProblem(history, distributorCode);
  if (owner) return owner;
  const { holder } = history;
  if (holder.type !== 'CLIENT' || holder.label !== order.client.name) return { kind: 'NOT_WITH_THIS_CUSTOMER' };
  return null;
}

/** The server's refusal (`MANUAL_DELIVERY_CYLINDERS_MISMATCH.details.problems[]`) as chip words. */
export function serverProblem(
  problem: { reason: ManualDeliveryProblemReason; holderType?: 'VEHICLE' | 'CLIENT' },
  size: string | undefined,
): ChipProblem {
  switch (problem.reason) {
    case 'NOT_AVAILABLE':
      return { kind: problem.holderType === 'CLIENT' ? 'WITH_CUSTOMER' : problem.holderType === 'VEHICLE' ? 'ON_VAN' : 'NOT_AVAILABLE' };
    case 'WRONG_SIZE':
      return { kind: 'WRONG_SIZE', size };
    default:
      return { kind: problem.reason };
  }
}

/**
 * A cylinder named twice, under two spellings or in both lists, is "listed twice" on its later chip (the
 * server refuses it as LISTED_TWICE): a cylinder can't be both delivered and taken back on one visit.
 */
export function markListedTwice(delivered: readonly NamedCylinder[], takenBack: readonly NamedCylinder[]): [NamedCylinder[], NamedCylinder[]] {
  const seen = new Set<string>();
  const mark = (chips: readonly NamedCylinder[]) =>
    chips.map((chip): NamedCylinder => {
      if (!chip.cylinderId) return chip;
      if (seen.has(chip.cylinderId)) return { ...chip, status: 'problem', problem: { kind: 'LISTED_TWICE' } };
      seen.add(chip.cylinderId);
      return chip;
    });
  return [mark(delivered), mark(takenBack)];
}

/** One size of the order: how many it needs and how many usable cylinders are named. */
export interface SizeProgress {
  cylinderTypeId: string;
  sizeLabel: string;
  needed: number;
  named: number;
}

/**
 * The delivered chips with what the counts add: a usable cylinder beyond what its size needs is "more
 * than the order needs" (the counts must equal the order lines, §9.5).
 */
export function withCountProblems(delivered: readonly NamedCylinder[], order: OrderDto): NamedCylinder[] {
  const left = new Map(order.lines.map((line) => [line.cylinderTypeId, line.fullCount]));
  return delivered.map((chip) => {
    if (chip.status !== 'ok' || !chip.size) return chip;
    const remaining = left.get(chip.size.id) ?? 0;
    if (remaining <= 0) return { ...chip, status: 'problem', problem: { kind: 'TOO_MANY' } };
    left.set(chip.size.id, remaining - 1);
    return chip;
  });
}

/** Per size: needed and named (usable chips only, never more than needed). */
export function sizeProgress(delivered: readonly NamedCylinder[], order: OrderDto): SizeProgress[] {
  return order.lines.map((line) => {
    const usable = delivered.filter((chip) => chip.status === 'ok' && chip.size?.id === line.cylinderTypeId).length;
    return { cylinderTypeId: line.cylinderTypeId, sizeLabel: line.sizeLabel, needed: line.fullCount, named: Math.min(usable, line.fullCount) };
  });
}
