import type { TFunction } from 'i18next';
import { create } from 'zustand';
import type {
  FillingOrderDto,
  FillingOrderStatus,
  RefillAdvanceTarget,
  RefillScanPhase,
  RefillScanProgress,
  RefillScanResult,
  RefillStage,
} from '@smartfleet/shared-types';
import { deriveRefillStage, legacyRefillCounts } from '@smartfleet/shared-utils';
import { api } from '../../api/client';
import { toApiError } from '../../api/errors';
import type { ScanRead } from '../../ui/scan';

/**
 * A refill on `GET /filling-orders/driver/mine` and `GET /filling-orders/:id` (API_CONTRACT §7.11,
 * §10.1): the shared FillingOrderDto plus the includes the refill routes send (`distributor`,
 * `pickupStore`, `cylinderType`). `stage` and `counts` come from the server; older answers are read
 * from the legacy fields.
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
      | 'allowedActions'
      | 'shortCode'
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
/** Step 3 watches the shop's receive scans, so it polls faster (UX_MOBILE §8.2). */
export const REFILL_UNLOAD_POLL_MS = 5_000;

const FINISHED: readonly FillingOrderStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

export async function fetchDriverRefills(): Promise<DriverRefill[]> {
  const { data } = await api.get<DriverRefill[]>('/filling-orders/driver/mine');
  return Array.isArray(data) ? data : [];
}

export async function fetchDriverRefill(id: string): Promise<DriverRefill> {
  const { data } = await api.get<DriverRefill>(`/filling-orders/${id}`);
  return data;
}

/**
 * `POST /filling-orders/:id/scans` (the assigned driver; API_CONTRACT §10.1): PICKUP in the store,
 * FILL at the station. 201 RECORDED; 200 ALREADY_RECORDED for a resend or the same move again. A
 * refusal carries the refill's counts as `details.progress`.
 */
export async function postRefillScan(id: string, phase: RefillScanPhase, read: ScanRead): Promise<RefillScanResult> {
  const body: Record<string, unknown> = { scanId: read.scanId, phase, code: read.code, entryMethod: read.entryMethod };
  if (read.lat !== undefined && read.lng !== undefined) {
    body.lat = read.lat;
    body.lng = read.lng;
  }
  const { data } = await api.post<RefillScanResult>(`/filling-orders/${id}/scans`, body);
  return data;
}

/**
 * `POST /filling-orders/:id/advance`: EMPTIES_PICKED is "Done picking up" (leave the store), FILLED is
 * "Done filling" (leave the station). Resolves with the refill as the server now has it.
 */
export async function advanceRefill(id: string, to: RefillAdvanceTarget): Promise<DriverRefill> {
  const { data } = await api.post<DriverRefill>(`/filling-orders/${id}/advance`, { to });
  return data;
}

/** The counts a refill scan's answer (or refusal) carries, laid over the cached refill. */
export function withRefillCounts(
  refill: DriverRefill | undefined,
  counts: Pick<RefillScanProgress, 'status' | 'requested' | 'picked' | 'filled' | 'received'>,
): DriverRefill | undefined {
  if (!refill) return refill;
  return {
    ...refill,
    status: counts.status,
    counts: { requested: counts.requested, picked: counts.picked, filled: counts.filled, received: counts.received },
  };
}

/** The refill counts a scan refusal carries (`details.progress` of type REFILL), or null. */
export function refillRefusalCounts(error: unknown): RefillScanProgress | null {
  const progress = toApiError(error).details.progress as RefillScanProgress | undefined;
  return progress && progress.type === 'REFILL' ? progress : null;
}

/** Still the driver's work: neither done nor cancelled. */
export function isRefillOpen(refill: Pick<DriverRefill, 'status'>): boolean {
  return !FINISHED.includes(refill.status);
}

export function stageOf(refill: DriverRefill): RefillStage {
  if (refill.stage) return refill.stage;
  return deriveRefillStage({ status: refill.status, counts: legacyRefillCounts(refill) });
}

export interface RefillCountsNow {
  requested: number;
  picked: number;
  filled: number;
  received: number;
}

export function countsOf(refill: DriverRefill): RefillCountsNow {
  return {
    requested: refill.counts?.requested ?? refill.requestedCount,
    picked: refill.counts?.picked ?? refill.pickedUpEmptyCount ?? 0,
    filled: refill.counts?.filled ?? refill.filledCount ?? 0,
    received: refill.counts?.received ?? 0,
  };
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

/**
 * The refill run's three steps (R10): pick up at the store (ASSIGNED), fill at the station
 * (EMPTIES_PICKED or AT_STATION), unload at the store (FILLED, while the shop scans them in). DONE
 * once the shop's last receive completes it.
 */
export type RefillStep = 'PICKUP' | 'FILL' | 'UNLOAD' | 'DONE' | 'CANCELLED' | 'WAITING';

export function refillStepOf(refill: DriverRefill, broughtBackUnfilled: boolean): RefillStep {
  switch (refill.status) {
    case 'ASSIGNED':
      return 'PICKUP';
    case 'EMPTIES_PICKED':
    case 'AT_STATION':
      return broughtBackUnfilled ? 'UNLOAD' : 'FILL';
    case 'FILLED':
    case 'RETURNED':
      return 'UNLOAD';
    case 'COMPLETED':
      return 'DONE';
    case 'CANCELLED':
    case 'FAILED':
      return 'CANCELLED';
    default:
      return 'WAITING';
  }
}

/**
 * "Bring back unfilled" (UX_MOBILE §8.2): the driver goes on to the unload with nothing filled. No
 * server call: the shop's receive scans still finish the refill. Kept in memory per refill while the
 * app runs, so the screen opens on the unload again. "Back to filling" undoes it, also with no server
 * call, while the server still has the refill at the station step and nothing has come back
 * (`canGoBackToFilling`; review23 ux-04).
 */
const useUnfilledStore = create<{ ids: Readonly<Record<string, true>> }>(() => ({ ids: {} }));

export function useBroughtBackUnfilled(id: string): boolean {
  return useUnfilledStore((state) => state.ids[id] === true);
}

/** Every refill this phone is bringing back unfilled (the lists' chips follow it). */
export function useBroughtBackUnfilledIds(): Readonly<Record<string, true>> {
  return useUnfilledStore((state) => state.ids);
}

export function bringBackUnfilled(id: string): void {
  useUnfilledStore.setState((state) => ({ ids: { ...state.ids, [id]: true } }));
}

/** "Back to filling": the run returns to step 2 (Fill). */
export function backToFilling(id: string): void {
  useUnfilledStore.setState((state) => {
    if (!state.ids[id]) return state;
    const ids = { ...state.ids };
    delete ids[id];
    return { ids };
  });
}

/**
 * True while "Back to filling" can undo "Bring back unfilled": the server still has the refill at the
 * station step (EMPTIES_PICKED or AT_STATION, so FILL scans are still taken) and the shop has received
 * none of its cylinders yet.
 */
export function canGoBackToFilling(refill: DriverRefill, broughtBackUnfilled: boolean): boolean {
  return (
    broughtBackUnfilled &&
    (refill.status === 'EMPTIES_PICKED' || refill.status === 'AT_STATION') &&
    countsOf(refill).received === 0
  );
}

/**
 * The chip the driver's lists show (Today, Refills): the server's stage, except that a refill this phone
 * is bringing back unfilled reads "Bring them back", the run's own step, rather than "Go to the station"
 * (review23 ux-04).
 */
export function driverStageOf(refill: DriverRefill, broughtBackUnfilled: boolean): RefillStage {
  const stage = stageOf(refill);
  return broughtBackUnfilled && (stage === 'PICKED_UP' || stage === 'AT_STATION') ? 'COMING_BACK' : stage;
}

/** The driver's open refills, oldest first (Today's rows, the Refills list). */
export function openRefillsOf(list: readonly DriverRefill[]): DriverRefill[] {
  return list.filter(isRefillOpen).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/** Today's one-line refill summary: how many open refills the driver has and their cylinders in all. */
export interface RefillSummary {
  refills: number;
  cylinders: number;
}

/**
 * Today's one line about the refills the office assigned (UX_MOBILE §7.2 R2): "2 refills · 7 cylinders", the
 * open refills and the cylinders they ask for in all; null with none open, so the line shows only then.
 */
export function refillSummaryOf(list: readonly DriverRefill[]): RefillSummary | null {
  const open = list.filter(isRefillOpen);
  if (open.length === 0) return null;
  return { refills: open.length, cylinders: open.reduce((sum, refill) => sum + countsOf(refill).requested, 0) };
}
