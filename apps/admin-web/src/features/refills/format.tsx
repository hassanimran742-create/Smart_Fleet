import i18n from '../../i18n';
import { formatAgo, formatDateTime } from '../../i18n/format';
import { StatusChip } from '../../ui';
import type { RefillRow } from './api';

/** The count a stage shows after "·" (`status:refillProgress.*`), or null for a stage without one. */
function progressOf(refill: Pick<RefillRow, 'stage' | 'counts'>): { done: number; total: number } | null {
  const { counts } = refill;
  switch (refill.stage) {
    case 'PICKING_UP':
    case 'PICKED_UP':
      return { done: counts.picked, total: counts.requested };
    case 'COMING_BACK':
      return { done: counts.filled, total: counts.picked };
    case 'BACK_AT_STORE':
      return { done: counts.received, total: counts.picked };
    case 'DONE':
      return counts.picked > 0 && counts.filled < counts.picked ? { done: counts.filled, total: counts.picked } : null;
    default:
      return null;
  }
}

/**
 * The status chip from the kit: `refillProgress` with its count ("Coming back · 2 of 2 filled"), else
 * `refillStage` ("Needs a driver", "Done"). Both kinds share the tones and the stage icons.
 */
export function RefillStageChip({ refill }: { refill: Pick<RefillRow, 'stage' | 'counts'> }) {
  const progress = progressOf(refill);
  return progress ? (
    <StatusChip kind="refillProgress" value={refill.stage} params={progress} />
  ) : (
    <StatusChip kind="refillStage" value={refill.stage} />
  );
}

/** "2 × 11.8 kg". */
export function refillCylinders(refill: Pick<RefillRow, 'requestedCount' | 'sizeLabel'>): string {
  return i18n.t('refills:cylinders', { count: refill.requestedCount, size: refill.sizeLabel });
}

/** "Imran · LEB-202", or null before a driver is assigned. */
export function refillDriver(refill: Pick<RefillRow, 'assignedDriver' | 'assignedVehicle'>): string | null {
  if (!refill.assignedDriver) return null;
  return refill.assignedVehicle
    ? i18n.t('refills:driverVan', { driver: refill.assignedDriver.name, plate: refill.assignedVehicle.plateNo })
    : refill.assignedDriver.name;
}

const DAY_MS = 24 * 60 * 60_000;

/** "12 min ago" within a day, else "21 Oct, 4:12 pm". */
export function requestedText(at: string, now: number = Date.now()): string {
  return now - new Date(at).getTime() < DAY_MS ? formatAgo(at, now) : formatDateTime(at, now);
}
