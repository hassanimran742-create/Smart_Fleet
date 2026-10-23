import type { OrderDto, OrderStage } from '@smartfleet/shared-types';
import { localDate } from '@smartfleet/shared-utils';
import i18n from '../../i18n';
import { formatDateTime, formatRs, formatTime } from '../../i18n/format';

/**
 * Plain words for an order, shared by the board, the drawer and the dialogs (UX_ADMIN §2.5). Every
 * string comes from the `orders` namespace; money is always `formatRs`.
 */

/** "2 × 11.8 kg, 1 × 45.4 kg". */
export function cylindersText(order: Pick<OrderDto, 'lines'>): string {
  return order.lines
    .map((line) => i18n.t('orders:format.cylinderLine', { n: line.fullCount, size: line.sizeLabel }))
    .join(', ');
}

/** "Imran · LEA-1234", or null when the order has no driver. */
export function driverText(order: Pick<OrderDto, 'trip'>): string | null {
  if (!order.trip) return null;
  return i18n.t('orders:format.driverVan', { driver: order.trip.driver.name, plate: order.trip.vehicle.plateNo });
}

/** "Ali Gas store · G-9 Markaz" (the address left out when the store has none). */
export function storeText(store: { name: string; address: string }): string {
  return store.address.trim() ? i18n.t('orders:format.storeAt', { store: store.name, address: store.address }) : store.name;
}

/** "10:12 am" for an order placed today (Asia/Karachi), "21 Oct, 4:12 pm" otherwise. */
export function placedWhen(createdAt: string, now: number = Date.now()): string {
  return localDate(createdAt) === localDate(now) ? formatTime(createdAt) : formatDateTime(createdAt, now);
}

/**
 * The cost line of the drawer (UX_ADMIN §2.5): "Base Rs 250 + 2 × Rs 40 (11.8 kg) = Rs 330 · taken from
 * the wallet when the order was placed". Zero parts are left out, so a flat price reads "Rs 250 · …".
 * A legacy order (no breakdown) says it was charged by the old system; a free order says so.
 */
export function costLine(order: Pick<OrderDto, 'fee'>): string {
  const { fee } = order;
  const total = formatRs(fee.totalPaisa);
  if (fee.status === 'NONE' && (fee.totalPaisa === '0' || !fee.breakdown)) return i18n.t('orders:drawer.costNone');
  if (!fee.breakdown) return i18n.t('orders:drawer.costLegacy', { cost: total });
  const parts: string[] = [];
  if (fee.breakdown.basePaisa !== '0') parts.push(i18n.t('orders:drawer.costBase', { amount: formatRs(fee.breakdown.basePaisa) }));
  for (const line of fee.breakdown.lines) {
    if (line.perCylinderPaisa === '0' || line.count === 0) continue;
    parts.push(i18n.t('orders:drawer.costLine', { n: line.count, amount: formatRs(line.perCylinderPaisa), size: line.sizeLabel }));
  }
  // A flat price (the base alone) reads "Rs 250"; anything with a per-size part shows its sum.
  const flat = parts.length <= 1 && fee.breakdown.basePaisa !== '0';
  const cost = parts.length === 0 || flat ? total : i18n.t('orders:drawer.costSum', { parts: parts.join(' + '), total });
  return i18n.t('orders:drawer.costTaken', { cost });
}

/** Stages that can't change any more. */
export const FINISHED_STAGES: readonly OrderStage[] = ['DELIVERED', 'NOT_DELIVERED', 'CANCELLED'];
