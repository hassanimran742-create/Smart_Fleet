/** An order status, as Prisma, the API and the `OrderStatus` enum of shared-types spell it. */
export type OrderStatusLike = 'PENDING' | 'CONFIRMED' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | 'FAILED';

/** What {@link deriveOrderStage} returns: the same values as `OrderStage` in @smartfleet/shared-types. */
export type DerivedOrderStage =
  | 'NEEDS_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'LOADING'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'NOT_DELIVERED'
  | 'CANCELLED';

/** The fields the stage depends on. Timestamps may be ISO strings or Dates; null or absent means "not yet". */
export interface OrderStageInput {
  status: OrderStatusLike;
  loadStartedAt?: string | Date | null;
  onTheWayAt?: string | Date | null;
}

/**
 * The stage people see for an order (API_CONTRACT §1.4). The rules apply in this order, first match:
 *
 * | Stage | When |
 * |---|---|
 * | CANCELLED | status CANCELLED |
 * | NOT_DELIVERED | status FAILED |
 * | DELIVERED | status DELIVERED |
 * | ON_THE_WAY | status IN_TRANSIT, or `onTheWayAt` set |
 * | LOADING | status ASSIGNED and `loadStartedAt` set |
 * | DRIVER_ASSIGNED | status ASSIGNED |
 * | NEEDS_DRIVER | status PENDING or CONFIRMED |
 *
 * The customer's confirmation answer is never a stage.
 */
export function deriveOrderStage(order: OrderStageInput): DerivedOrderStage {
  switch (order.status) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
      return 'NOT_DELIVERED';
    case 'DELIVERED':
      return 'DELIVERED';
    default:
      break;
  }
  if (order.status === 'IN_TRANSIT' || isSet(order.onTheWayAt)) return 'ON_THE_WAY';
  if (order.status === 'ASSIGNED') return isSet(order.loadStartedAt) ? 'LOADING' : 'DRIVER_ASSIGNED';
  // PENDING and CONFIRMED; an unknown future status also waits for a driver rather than breaking a list.
  return 'NEEDS_DRIVER';
}

function isSet(value: string | Date | null | undefined): boolean {
  return value instanceof Date ? !Number.isNaN(value.getTime()) : typeof value === 'string' && value.length > 0;
}
