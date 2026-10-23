import { Injectable } from '@nestjs/common';
import type { DeliveryStartedRule, FeeStrategy, NoRefundReason, OrderCancelReason, OrderFeeStatus, OrderStatusValue } from '@smartfleet/shared-types';
import type { Actor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from '../wallet/wallet.service';
import type { Db, Tx } from './support/tx';

/**
 * What the fee rules read from an order (API_CONTRACT §5.5). `storeDepartedAt` is the STORE_PICKUP
 * departure of the order's current trip, `deliveryArrivedAt` the first arrival at one of this order's
 * DELIVERY stops on any trip it was on (a reassignment cancels the old stop but keeps its arrival, so a
 * driver change never makes a started order refundable again), and `handoverStarted` a DELIVERED
 * cylinder event for the order (Inc 1).
 */
export interface OrderForPolicy {
  id: string;
  distributorId: string;
  status: OrderStatusValue;
  feeStatus: OrderFeeStatus;
  feeStrategy: FeeStrategy | null;
  deliveryFeePaisa: bigint;
  assignedAt: Date | null;
  loadStartedAt: Date | null;
  storeDepartedAt: Date | null;
  deliveryArrivedAt: Date | null;
  handoverStarted: boolean;
  /**
   * A cylinder moved on the order's current trip other than a hand-back at the store (SCAN_IN): a load,
   * or a cylinder given to or taken from a customer. assign-driver then refuses a driver change (§7.6
   * rule 4), so REASSIGN isn't offered (§1.6). It moves no money. Absent reads as false.
   */
  tripMoved?: boolean;
}

/** What a cancel would do now. */
export interface CancelTerms {
  allowed: boolean;
  refundPaisa: bigint;
  noRefundReason: NoRefundReason | null;
}

/** What a cancel did. `startedRule` is the rule it was decided under (saved in the `order.cancel` row). */
export interface CancelOutcome {
  refunded: boolean;
  refundPaisa: bigint;
  startedRule: DeliveryStartedRule;
}

const TERMINAL: readonly OrderStatusValue[] = ['DELIVERED', 'CANCELLED', 'FAILED'];

export function isTerminal(status: OrderStatusValue): boolean {
  return TERMINAL.includes(status);
}

/**
 * Whether delivery has started under `orders.deliveryStartedAt` (ADR-07, API_CONTRACT §5.5). A trip
 * start or IN_TRANSIT on its own never counts; only a load scan stamps `loadStartedAt`.
 *
 * | Rule | Started when any of these is true |
 * |---|---|
 * | FIRST_LOAD_SCAN | `loadStartedAt`, store stop `departedAt`, delivery stop `arrivedAt`, DELIVERED or FAILED |
 * | DRIVER_ASSIGNED | `assignedAt`, plus everything in FIRST_LOAD_SCAN |
 * | LEFT_STORE | store stop `departedAt`, delivery stop `arrivedAt`, DELIVERED or FAILED |
 */
export function isDeliveryStarted(order: OrderForPolicy, rule: DeliveryStartedRule): boolean {
  const atTheDoor =
    order.storeDepartedAt !== null || order.deliveryArrivedAt !== null || order.status === 'DELIVERED' || order.status === 'FAILED';
  switch (rule) {
    case 'LEFT_STORE':
      return atTheDoor;
    case 'DRIVER_ASSIGNED':
      return order.assignedAt !== null || order.loadStartedAt !== null || atTheDoor;
    case 'FIRST_LOAD_SCAN':
    default:
      return order.loadStartedAt !== null || atTheDoor;
  }
}

/** True when this platform deducted the cost at placement, so a cancel before the start can return it. */
function refundable(order: OrderForPolicy): boolean {
  return order.feeStatus === 'DEDUCTED' && order.feeStrategy !== 'LEGACY_ZONE_PAIR';
}

/**
 * The cancel terms (API_CONTRACT §5.5): allowed while the order isn't finished and no hand-over has
 * started; the refund is the whole cost when it was deducted by this platform and delivery hasn't
 * started, else 0. A legacy order (charged by the old code) or a zero-cost order gets 0 with no reason.
 */
export function cancelTerms(order: OrderForPolicy, rule: DeliveryStartedRule): CancelTerms {
  const allowed = !isTerminal(order.status) && !order.handoverStarted;
  if (!refundable(order)) return { allowed, refundPaisa: 0n, noRefundReason: null };
  if (isDeliveryStarted(order, rule)) return { allowed, refundPaisa: 0n, noRefundReason: 'DELIVERY_STARTED' };
  return { allowed, refundPaisa: allowed ? order.deliveryFeePaisa : 0n, noRefundReason: null };
}

/**
 * The only place the delivery-fee rules live (API_CONTRACT §5.5). Money moves only through
 * WalletService: the cost is deducted when the order is placed and returned once, on a cancel before
 * delivery has started. Delivered, failed, customer answers and day-end never call it for money.
 */
@Injectable()
export class OrdersFeePolicy {
  constructor(
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
  ) {}

  /** The refund cut-off now. Read on every decision, never stored on the order (G04-02). */
  deliveryStartedRule(): Promise<DeliveryStartedRule> {
    return this.settings.get('orders.deliveryStartedAt');
  }

  /** Placing an order deducts its cost in the order's transaction; a cost of 0 writes no ledger row. */
  async onCreated(tx: Tx, order: { id: string; distributorId: string }, quote: { totalPaisa: bigint }, actor: Actor): Promise<void> {
    await this.wallet.debit(tx, {
      distributorId: order.distributorId,
      subject: { type: 'ORDER', orderId: order.id },
      amountPaisa: quote.totalPaisa,
      actor,
    });
  }

  isDeliveryStarted(order: OrderForPolicy, rule: DeliveryStartedRule): boolean {
    return isDeliveryStarted(order, rule);
  }

  cancelTerms(order: OrderForPolicy, rule: DeliveryStartedRule): CancelTerms {
    return cancelTerms(order, rule);
  }

  /**
   * The money side of a cancel, under the order's row lock: the terms now; 409
   * ORDER_CANCEL_TERMS_CHANGED when the refund the person saw (`confirmRefundPaisa`) differs; then,
   * when a refund is due, `WalletService.reverse` once (key `order:<id>:reversal`) and the fee status
   * REVERSED. A legacy or zero-cost order never calls the wallet.
   */
  async cancel(
    tx: Tx,
    order: OrderForPolicy,
    p: { actor: Actor; reasonCode: OrderCancelReason; note?: string; confirmRefundPaisa?: bigint; rule?: DeliveryStartedRule },
  ): Promise<CancelOutcome> {
    const rule = p.rule ?? (await this.deliveryStartedRule());
    const terms = cancelTerms(order, rule);
    if (p.confirmRefundPaisa !== undefined && p.confirmRefundPaisa !== terms.refundPaisa) {
      throw new AppError('ORDER_CANCEL_TERMS_CHANGED', { refundPaisa: terms.refundPaisa.toString() });
    }
    if (terms.refundPaisa === 0n) return { refunded: false, refundPaisa: 0n, startedRule: rule };
    const entry = await this.wallet.reverse(tx, {
      subject: { type: 'ORDER', orderId: order.id },
      actor: p.actor,
      reason: p.reasonCode,
    });
    if (!entry) return { refunded: false, refundPaisa: 0n, startedRule: rule };
    await tx.$executeRaw`
      UPDATE orders SET fee_status = 'REVERSED', payment_status = 'UNPAID', updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id = ${order.id}::uuid AND fee_status = 'DEDUCTED'`;
    const returned = entry.amountPaisa < 0n ? -entry.amountPaisa : entry.amountPaisa;
    return { refunded: true, refundPaisa: returned, startedRule: rule };
  }
}

/**
 * Loads the fee-rule view of orders: their own columns, their current trip's store-stop departure, the
 * first arrival at any of their delivery stops (old trips included: ADR-07 counts "the order's delivery
 * stop was reached", and the office may still change the driver after that), whether a cylinder was
 * handed over for them, and whether a cylinder moved on their current trip other than a hand-back.
 */
export async function loadOrdersForPolicy(db: Db, ids: readonly string[]): Promise<Map<string, OrderForPolicy>> {
  if (ids.length === 0) return new Map();
  const orders = await db.order.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      distributorId: true,
      status: true,
      feeStatus: true,
      feeStrategy: true,
      deliveryFeePaisa: true,
      assignedAt: true,
      loadStartedAt: true,
      tripId: true,
    },
  });
  const tripIds = [...new Set(orders.map((order) => order.tripId).filter((id): id is string => id !== null))];
  const [storeStops, arrivals, handovers, moves] = await Promise.all([
    tripIds.length
      ? db.tripStop.findMany({
          where: { tripId: { in: tripIds }, stopType: 'STORE_PICKUP' },
          select: { tripId: true, departedAt: true },
        })
      : Promise.resolve([]),
    // Every trip's DELIVERY stop for these orders, not only the current trip's: a cancelled stop keeps
    // `arrived_at`, and a stop can't be arrived at once it is cancelled.
    db.tripStop.findMany({
      where: { orderId: { in: [...ids] }, stopType: 'DELIVERY', arrivedAt: { not: null } },
      select: { orderId: true, arrivedAt: true },
    }),
    db.cylinderEvent.findMany({
      where: { orderId: { in: [...ids] }, eventType: 'DELIVERED' },
      select: { orderId: true },
      distinct: ['orderId'],
    }),
    // The current trips with a cylinder event other than a hand-back (SCAN_IN): the same check as
    // assign-driver rule 4 (trip-writes.ts tripHasLoadOrHandover), for the REASSIGN button.
    tripIds.length
      ? db.cylinderEvent.findMany({
          where: { tripId: { in: tripIds }, eventType: { not: 'SCAN_IN' } },
          select: { tripId: true },
          distinct: ['tripId'],
        })
      : Promise.resolve([]),
  ]);
  const handedOver = new Set(handovers.map((row) => row.orderId));
  const movedTrips = new Set(moves.map((row) => row.tripId));
  const firstArrival = new Map<string, Date>();
  for (const stop of arrivals) {
    if (!stop.orderId || !stop.arrivedAt) continue;
    const seen = firstArrival.get(stop.orderId);
    if (!seen || stop.arrivedAt < seen) firstArrival.set(stop.orderId, stop.arrivedAt);
  }
  const out = new Map<string, OrderForPolicy>();
  for (const order of orders) {
    const store = storeStops.find((stop) => stop.tripId === order.tripId);
    out.set(order.id, {
      id: order.id,
      distributorId: order.distributorId,
      status: order.status,
      feeStatus: order.feeStatus,
      feeStrategy: order.feeStrategy,
      deliveryFeePaisa: order.deliveryFeePaisa,
      assignedAt: order.assignedAt,
      loadStartedAt: order.loadStartedAt,
      storeDepartedAt: store?.departedAt ?? null,
      deliveryArrivedAt: firstArrival.get(order.id) ?? null,
      handoverStarted: handedOver.has(order.id),
      tripMoved: order.tripId !== null && movedTrips.has(order.tripId),
    });
  }
  return out;
}
