import type { StoreIncomingDto, StoreScanResult } from '@smartfleet/shared-types';

/**
 * [Inc 2] The rules of Receive from driver (UX_MOBILE §7.3 S13; Inc 2/3 spec §2.2–§2.3), as plain logic
 * over `GET /store/incoming`. It imports only shared-types, so the API's unit tests can load it.
 *
 * `counts.received` is what came off a van into the store in the current business day and
 * `counts.total` that plus what is still on the van, so "{{done}} of {{total}} received" reads right.
 * `bySize` covers the same set; `cylinders` lists only what is still on the van.
 */

export type IncomingVan = StoreIncomingDto['vans'][number];

/** The cylinders still on the vans: Home's "3 coming back". */
export function cylindersComing(vans: readonly IncomingVan[]): number {
  return vans.reduce((sum, van) => sum + van.cylinders.length, 0);
}

export interface VanProgress {
  done: number;
  total: number;
  /** Every cylinder of the van is in (the van leaves the list at the next poll). */
  complete: boolean;
  /** A cylinder still on the van came back from a refill: the "Refill" chip. */
  hasRefill: boolean;
  /** Everything still on the van came from refills (such a van has no trip). */
  refillOnly: boolean;
}

export function vanProgress(van: IncomingVan): VanProgress {
  const total = Math.max(0, van.counts.total);
  const done = Math.min(Math.max(0, van.counts.received), total);
  const left = van.cylinders.length;
  return {
    done,
    total,
    complete: total > 0 && left === 0,
    hasRefill: van.cylinders.some((cylinder) => cylinder.came === 'REFILL'),
    refillOnly: left > 0 ? van.cylinders.every((cylinder) => cylinder.came === 'REFILL') : van.trip === null,
  };
}

export interface SizeProgress {
  key: string;
  sizeLabel: string;
  done: number;
  total: number;
}

/** One line per size ("11.8 kg · 1 of 2"): the size's total less what of it is still on the van. */
export function sizeProgress(van: IncomingVan): SizeProgress[] {
  const left = new Map<string, number>();
  for (const cylinder of van.cylinders) left.set(cylinder.sizeLabel, (left.get(cylinder.sizeLabel) ?? 0) + 1);
  return van.counts.bySize.map((size) => ({
    key: size.cylinderTypeId,
    sizeLabel: size.sizeLabel,
    total: size.count,
    done: Math.max(0, size.count - (left.get(size.sizeLabel) ?? 0)),
  }));
}

/** The van with this id, or undefined once it has left the list (nothing left on it). */
export function vanById(data: StoreIncomingDto | undefined, vehicleId: string): IncomingVan | undefined {
  return data?.vans.find((van) => van.vehicle.id === vehicleId);
}

/**
 * The list as it is right after a recorded receive, before the next poll: the cylinder leaves the van
 * it was on and that van's received count goes up by one. A cylinder the list doesn't show (one with
 * no number, or on a van it missed) changes nothing; the poll that follows brings the truth.
 */
export function afterReceive(data: StoreIncomingDto, result: StoreScanResult): StoreIncomingDto {
  const shortCode = result.cylinder.shortCode;
  if (result.result !== 'RECORDED' || shortCode === null) return data;
  for (let index = 0; index < data.vans.length; index++) {
    const van = data.vans[index];
    const at = van.cylinders.findIndex((cylinder) => cylinder.shortCode === shortCode);
    if (at < 0) continue;
    const updated: IncomingVan = {
      ...van,
      cylinders: [...van.cylinders.slice(0, at), ...van.cylinders.slice(at + 1)],
      counts: { ...van.counts, received: Math.min(van.counts.total, van.counts.received + 1) },
    };
    return { vans: [...data.vans.slice(0, index), updated, ...data.vans.slice(index + 1)] };
  }
  return data;
}
