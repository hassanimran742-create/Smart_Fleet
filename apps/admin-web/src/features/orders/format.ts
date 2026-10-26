import type { OrderBoardTab, OrderDto, OrderStage } from '@smartfleet/shared-types';
import { localDate } from '@smartfleet/shared-utils';
import i18n from '../../i18n';
import { formatAgo, formatDateTime, formatTime } from '../../i18n/format';

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

/** "10:12 am" for a moment today (Asia/Karachi), "21 Oct, 4:12 pm" otherwise. */
export function whenText(at: string, now: number = Date.now()): string {
  return localDate(at) === localDate(now) ? formatTime(at) : formatDateTime(at, now);
}

/**
 * The muted line under an order number on the board (website spec W27): "Placed 29 min ago", on Done
 * today "Delivered 10:42 am", on Cancelled or not delivered "Cancelled 9:50 am" or "Not delivered
 * 10:30 am".
 */
export function rowWhen(order: OrderDto, tab: OrderBoardTab, now: number = Date.now()): string {
  if (tab === 'done-today' && order.deliveredAt) {
    return i18n.t('orders:row.when.delivered', { time: whenText(order.deliveredAt, now) });
  }
  if (tab === 'cancelled-failed') {
    if (order.cancelledAt) return i18n.t('orders:row.when.cancelled', { time: whenText(order.cancelledAt, now) });
    if (order.failedAt) return i18n.t('orders:row.when.notDelivered', { time: whenText(order.failedAt, now) });
  }
  return i18n.t('orders:row.when.placed', { ago: formatAgo(order.createdAt, now) });
}

/** The reason of a cancelled or not-delivered order in words ("Customer cancelled"), or null. */
export function outcomeReason(order: Pick<OrderDto, 'stage' | 'cancelReasonCode' | 'failureReasonCode'>): string | null {
  if (order.stage === 'CANCELLED' && order.cancelReasonCode) return i18n.t(`orders:cancel.reason.${order.cancelReasonCode}`);
  if (order.stage === 'NOT_DELIVERED' && order.failureReasonCode) return i18n.t(`orders:fail.reason.${order.failureReasonCode}`);
  return null;
}

/** The drawer's subtitle by stage: "Ahmed Gas · placed 10:00 am", "… · delivered 10:42 am", … */
export function drawerSubtitle(order: OrderDto, now: number = Date.now()): string {
  const t = i18n.t;
  const distributor = order.distributor?.businessName;
  if (order.stage === 'DELIVERED' && order.deliveredAt) {
    const when = whenText(order.deliveredAt, now);
    return distributor ? t('orders:drawer.subtitleDelivered', { distributor, when }) : t('orders:drawer.subtitleDeliveredNoDistributor', { when });
  }
  if (order.stage === 'CANCELLED' && order.cancelledAt) {
    const when = whenText(order.cancelledAt, now);
    return distributor ? t('orders:drawer.subtitleCancelled', { distributor, when }) : t('orders:drawer.subtitleCancelledNoDistributor', { when });
  }
  if (order.stage === 'NOT_DELIVERED' && order.failedAt) {
    const when = whenText(order.failedAt, now);
    return distributor
      ? t('orders:drawer.subtitleNotDelivered', { distributor, when })
      : t('orders:drawer.subtitleNotDeliveredNoDistributor', { when });
  }
  const when = whenText(order.createdAt, now);
  return distributor ? t('orders:drawer.subtitle', { distributor, when }) : t('orders:drawer.subtitleNoDistributor', { when });
}

/** Stages that can't change any more. */
export const FINISHED_STAGES: readonly OrderStage[] = ['DELIVERED', 'NOT_DELIVERED', 'CANCELLED'];
