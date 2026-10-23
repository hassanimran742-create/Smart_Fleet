import { UserRole } from '@prisma/client';
import { ORDER_ACTIONS, type DeliveryStartedRule, type OrderAction } from '@smartfleet/shared-types';
import { deriveOrderStage } from '@smartfleet/shared-utils';
import type { PolicyCaller } from '../../common/auth/policies';
import { cancelTerms, isDeliveryStarted, isTerminal, type OrderForPolicy } from './orders-fee.policy';

/** What the buttons depend on beyond the fee view: who drives the order's trip. */
export interface OrderForActions extends OrderForPolicy {
  onTheWayAt: Date | null;
  tripDriverId: string | null;
}

/**
 * The buttons a caller may press on an order (API_CONTRACT §1.6), in `ORDER_ACTIONS` order and empty
 * for finished orders. Computed per request, so a change of `orders.deliveryStartedAt` shows at once.
 *
 * | Action | Caller | Offered when |
 * |---|---|---|
 * | CANCEL | owning distributor, office | `cancel.allowed` |
 * | ASSIGN | office | PENDING or CONFIRMED |
 * | REASSIGN | office | ASSIGNED, nothing loaded, no hand-over, and no cylinder event on its trip but a hand-back (SCAN_IN): what assign-driver accepts (§7.6 rule 4) |
 * | MARK_FAILED | office, the trip's driver | ASSIGNED or IN_TRANSIT, delivery started, no hand-over |
 * | MANUAL_DELIVERY | office | ASSIGNED or IN_TRANSIT |
 * | TRACK | owning distributor, office | stage ON_THE_WAY |
 */
export function allowedActions(order: OrderForActions, caller: PolicyCaller, rule: DeliveryStartedRule): OrderAction[] {
  if (isTerminal(order.status)) return [];
  const office = caller.role === UserRole.SUPER_ADMIN;
  const owner = caller.role === UserRole.DISTRIBUTOR && !!caller.distributorId && caller.distributorId === order.distributorId;
  const tripDriver = caller.role === UserRole.DRIVER && !!caller.driverId && caller.driverId === order.tripDriverId;
  const withDriver = order.status === 'ASSIGNED' || order.status === 'IN_TRANSIT';
  const stage = deriveOrderStage({ status: order.status, loadStartedAt: order.loadStartedAt, onTheWayAt: order.onTheWayAt });

  const offered: Record<OrderAction, boolean> = {
    CANCEL: (owner || office) && cancelTerms(order, rule).allowed,
    ASSIGN: office && (order.status === 'PENDING' || order.status === 'CONFIRMED'),
    REASSIGN: office && order.status === 'ASSIGNED' && order.loadStartedAt === null && !order.handoverStarted && !order.tripMoved,
    MARK_FAILED: (office || tripDriver) && withDriver && isDeliveryStarted(order, rule) && !order.handoverStarted,
    MANUAL_DELIVERY: office && withDriver,
    TRACK: (owner || office) && stage === 'ON_THE_WAY',
  };
  return ORDER_ACTIONS.filter((action) => offered[action]);
}
