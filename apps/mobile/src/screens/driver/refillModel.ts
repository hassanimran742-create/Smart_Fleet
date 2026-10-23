import type { TFunction } from 'i18next';
import type { FillingOrderDto, FillingOrderStatus, RefillStage } from '@smartfleet/shared-types';
import { deriveRefillStage, legacyRefillCounts } from '@smartfleet/shared-utils';
import { api } from '../../api/client';

/**
 * A refill on `GET /filling-orders/driver/mine` and `GET /filling-orders/:id` (API_CONTRACT §7.11).
 * `stage` and `counts` come from Inc 1 servers on; older servers send only the legacy fields, so both
 * are derived when missing. `distributor` and `pickupStore` are the legacy includes the app reads.
 */
export type DriverRefill = Pick<FillingOrderDto, 'id' | 'status' | 'requestedCount'> &
  Partial<
    Pick<
      FillingOrderDto,
      | 'stage'
      | 'counts'
      | 'sizeLabel'
      | 'fillingStation'
      | 'pickedUpEmptyCount'
      | 'filledCount'
      | 'createdAt'
      | 'completedAt'
    >
  > & {
    cylinderType?: { code?: string | null; name?: string | null } | null;
    distributor?: { businessName?: string | null } | null;
    pickupStore?: { name?: string | null } | null;
  };

/** The driver's refills; the prefix of each refill's own key, so one invalidation reaches both. */
export const REFILLS_QUERY_KEY = ['driver', 'refills'] as const;
export const refillQueryKey = (id: string) => ['driver', 'refills', id] as const;
export const REFILLS_POLL_MS = 15_000;

const FINISHED: readonly FillingOrderStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

export async function fetchDriverRefills(): Promise<DriverRefill[]> {
  const { data } = await api.get<DriverRefill[]>('/filling-orders/driver/mine');
  return Array.isArray(data) ? data : [];
}

export async function fetchDriverRefill(id: string): Promise<DriverRefill> {
  const { data } = await api.get<DriverRefill>(`/filling-orders/${id}`);
  return data;
}

/** The driver's refill steps: the four PATCH routes of the assigned driver (no money). */
export type RefillStep =
  | { endpoint: 'picked-empties'; body: { emptyCount: number } }
  | { endpoint: 'at-station' }
  | { endpoint: 'filled'; body: { filledCount: number } }
  | { endpoint: 'returned' };

/** Sends one step; resolves with the refill as the server now has it. */
export async function advanceRefill(id: string, step: RefillStep): Promise<DriverRefill> {
  const { data } = await api.patch<DriverRefill>(
    `/filling-orders/${id}/${step.endpoint}`,
    'body' in step ? step.body : {},
  );
  return data;
}

/** Still the driver's work: neither done nor cancelled (RETURNED waits for the office). */
export function isRefillOpen(refill: Pick<DriverRefill, 'status'>): boolean {
  return !FINISHED.includes(refill.status);
}

export function stageOf(refill: DriverRefill): RefillStage {
  if (refill.stage) return refill.stage;
  return deriveRefillStage({ status: refill.status, counts: legacyRefillCounts(refill) });
}

export function pickedOf(refill: DriverRefill): number {
  return refill.counts?.picked ?? refill.pickedUpEmptyCount ?? 0;
}

export function filledOf(refill: DriverRefill): number {
  return refill.counts?.filled ?? refill.filledCount ?? 0;
}

/** The refill's places and its one line: "2 × 11.8 kg · Ahmed Gas" (data). */
export function refillWords(refill: DriverRefill, t: TFunction) {
  const size = refill.sizeLabel ?? refill.cylinderType?.name ?? refill.cylinderType?.code ?? '';
  const store = refill.pickupStore?.name ?? t('driver.refills.theStore');
  const station = refill.fillingStation?.name ?? t('driver.refills.theStation');
  const shop = refill.distributor?.businessName ?? store;
  return {
    store,
    station,
    title: t('driver.refills.runTitle', { count: refill.requestedCount, size, shop }),
  };
}
