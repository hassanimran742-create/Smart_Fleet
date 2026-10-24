import type { GeoPoint, IdName, IsoDateTime, ISODateString, Paisa, UUID } from './common.types';
import type { OrderConfirmationSummary } from './confirmation.types';
import type { DistributorRef } from './distributor.types';
import type { DeliveryQuote } from './pricing.types';
import type { TripStatusValue } from './trip.types';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

/** The wire value of an {@link OrderStatus}. A string union, so Prisma's enum values are assignable to it. */
export type OrderStatusValue = `${OrderStatus}`;

/**
 * @deprecated Legacy mirror for installed app builds (DATA_MODEL §3.2): `PAID_VIA_LEDGER` while the
 * fee is DEDUCTED, `UNPAID` otherwise. Read {@link OrderFeeStatus} instead.
 */
export enum OrderPaymentStatus {
  UNPAID = 'UNPAID',
  PAID_VIA_LEDGER = 'PAID_VIA_LEDGER',
  PAID_DIRECT = 'PAID_DIRECT',
}

/** The wire value of an {@link OrderPaymentStatus}. */
export type OrderPaymentStatusValue = `${OrderPaymentStatus}`;

/** Mirrors Prisma `OrderFeeStatus` (`orders.fee_status`): NONE (legacy or zero cost), DEDUCTED, REVERSED. */
export const OrderFeeStatus = {
  NONE: 'NONE',
  DEDUCTED: 'DEDUCTED',
  REVERSED: 'REVERSED',
} as const;
export type OrderFeeStatus = (typeof OrderFeeStatus)[keyof typeof OrderFeeStatus];

/** Mirrors Prisma `FeeStrategy`. `DISTRIBUTOR_ZONE` is the pilot strategy; old orders are `LEGACY_ZONE_PAIR`. */
export const FeeStrategy = {
  DISTRIBUTOR_ZONE: 'DISTRIBUTOR_ZONE',
  LEGACY_ZONE_PAIR: 'LEGACY_ZONE_PAIR',
} as const;
export type FeeStrategy = (typeof FeeStrategy)[keyof typeof FeeStrategy];

/** Mirrors Prisma `DeliveryMethod`: the Inc 1 driver tap, Inc 2 scans, or the office with a reason. */
export const DeliveryMethod = {
  DRIVER_TAP: 'DRIVER_TAP',
  SCANNED: 'SCANNED',
  MANUAL: 'MANUAL',
} as const;
export type DeliveryMethod = (typeof DeliveryMethod)[keyof typeof DeliveryMethod];

/**
 * The stage shown to people, derived by `deriveOrderStage` in shared-utils (API_CONTRACT §1.4).
 * Listed in lifecycle order. Apps map it to `stages.order.<STAGE>`.
 */
export const ORDER_STAGES = [
  'NEEDS_DRIVER',
  'DRIVER_ASSIGNED',
  'LOADING',
  'ON_THE_WAY',
  'DELIVERED',
  'NOT_DELIVERED',
  'CANCELLED',
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

/**
 * Setting `orders.deliveryStartedAt`: the point after which a cancel returns nothing (ADR-07, API_CONTRACT §5.5).
 * The default is `FIRST_LOAD_SCAN`.
 */
export const DELIVERY_STARTED_RULES = ['FIRST_LOAD_SCAN', 'DRIVER_ASSIGNED', 'LEFT_STORE'] as const;
export type DeliveryStartedRule = (typeof DELIVERY_STARTED_RULES)[number];

/** Reason codes for a cancel (API_CONTRACT §1.5). `OTHER` needs a note. Listed in display order. */
export const ORDER_CANCEL_REASONS = [
  'CUSTOMER_CANCELLED',
  'WRONG_ORDER',
  'DUPLICATE',
  'OUT_OF_STOCK',
  'OTHER',
] as const;
export type OrderCancelReason = (typeof ORDER_CANCEL_REASONS)[number];

/** Reason codes for "could not deliver" (API_CONTRACT §1.5). `OTHER` needs a note. Listed in display order. */
export const DELIVERY_FAILURE_REASONS = [
  'CUSTOMER_NOT_HOME',
  'CUSTOMER_REFUSED',
  'WRONG_ADDRESS',
  'NOT_REACHABLE',
  'VAN_PROBLEM',
  'OTHER',
] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

/** Why a cancel returns nothing. */
export type NoRefundReason = 'DELIVERY_STARTED';

/** Buttons the server allows on an order (API_CONTRACT §1.6). */
export const ORDER_ACTIONS = ['CANCEL', 'ASSIGN', 'REASSIGN', 'MARK_FAILED', 'MANUAL_DELIVERY', 'TRACK'] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** `GET /orders?tab=` (distributor). */
export const ORDER_LIST_TABS = ['active', 'done'] as const;
export type OrderListTab = (typeof ORDER_LIST_TABS)[number];

/** `GET /orders/board?tab=` (office). */
export const ORDER_BOARD_TABS = ['needs-driver', 'in-progress', 'done-today', 'cancelled-failed', 'all'] as const;
export type OrderBoardTab = (typeof ORDER_BOARD_TABS)[number];

/**
 * The statuses of each shop tab (API_CONTRACT §7.6), shared by `GET /orders?tab`, the shop's home
 * figures and the apps. Both tabs list any date, newest first.
 */
export const ORDER_LIST_TAB_STATUSES = {
  active: ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT'],
  done: ['DELIVERED', 'CANCELLED', 'FAILED'],
} as const satisfies { readonly [T in OrderListTab]: readonly OrderStatusValue[] };

/**
 * The statuses of each office board tab (API_CONTRACT §7.6), shared by `GET /orders/board`,
 * `GET /admin/summary` and the website. The date windows are the API's: `done-today` is DELIVERED with
 * `deliveredAt` in the current business day; `cancelled-failed` has `cancelledAt` or `failedAt` in the
 * current business day or the 6 before it. `needs-driver` is oldest first, every other tab newest first.
 */
export const ORDER_BOARD_TAB_STATUSES = {
  'needs-driver': ['PENDING', 'CONFIRMED'],
  'in-progress': ['ASSIGNED', 'IN_TRANSIT'],
  'done-today': ['DELIVERED'],
  'cancelled-failed': ['CANCELLED', 'FAILED'],
  all: ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED'],
} as const satisfies { readonly [T in OrderBoardTab]: readonly OrderStatusValue[] };

export interface OrderLine {
  cylinderTypeId: UUID;
  fullCount: number;
  expectedReturnCount: number;
}

/** The legacy order shape. New screens read {@link OrderDto}. */
export interface Order {
  id: UUID;
  distributorId: UUID;
  clientId: UUID;
  deliveryLocation: GeoPoint;
  deliveryLabel: string;
  destZoneId: UUID;
  originStoreId?: UUID;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  deliveryFeePaisa: Paisa;
  scheduledWindowStart?: ISODateString;
  scheduledWindowEnd?: ISODateString;
  lines: OrderLine[];
  tripId?: UUID;
  createdAt: ISODateString;
}

export interface OrderLineDto {
  id: UUID;
  cylinderTypeId: UUID;
  /** For example "11.8 kg". */
  sizeLabel: string;
  fullCount: number;
  expectedReturnCount: number;
}

/** One size in the order's own copy of its delivery cost. */
export interface OrderFeeLineDto {
  cylinderTypeId: UUID;
  sizeLabel: string;
  count: number;
  perCylinderPaisa: Paisa;
  subtotalPaisa: Paisa;
}

/** The cost the order stores at placement (ADR-08). `breakdown` is null for legacy orders. */
export interface OrderFeeDto {
  totalPaisa: Paisa;
  status: OrderFeeStatus;
  breakdown: { basePaisa: Paisa; lines: OrderFeeLineDto[] } | null;
}

/** What a cancel would do now (API_CONTRACT §5.5 `cancelTerms`). */
export interface OrderCancelTerms {
  allowed: boolean;
  refundPaisa: Paisa;
  noRefundReason: NoRefundReason | null;
}

export interface OrderTripDto {
  id: UUID;
  status: TripStatusValue;
  driver: { id: UUID; name: string; phone: string };
  vehicle: { plateNo: string };
}

/** `GET /orders/:id` and every order list (API_CONTRACT §7). */
export interface OrderDto {
  id: UUID;
  orderNo: number;
  /** `formatNo(code, 'ORDER', orderNo)`, for example "AG-0142". */
  shortCode: string;
  status: OrderStatusValue;
  stage: OrderStage;
  client: { id: UUID; name: string; phone: string };
  lines: OrderLineDto[];
  deliveryAddressLabel: string;
  destination: GeoPoint;
  destZone: IdName;
  fee: OrderFeeDto;
  cancel: OrderCancelTerms;
  originStore: { id: UUID; name: string; address: string } | null;
  trip: OrderTripDto | null;
  createdAt: IsoDateTime;
  assignedAt: IsoDateTime | null;
  loadStartedAt: IsoDateTime | null;
  onTheWayAt: IsoDateTime | null;
  deliveredAt: IsoDateTime | null;
  deliveryMethod: DeliveryMethod | null;
  cancelledAt: IsoDateTime | null;
  cancelReasonCode: OrderCancelReason | null;
  failedAt: IsoDateTime | null;
  failureReasonCode: DeliveryFailureReason | null;
  failureNote: string | null;
  /** Legacy mirror for installed apps: the cost deducted at placement. */
  deliveryFeePaisa: Paisa;
  /** Legacy mirror for installed apps. */
  paymentStatus: OrderPaymentStatusValue;
  allowedActions: OrderAction[];
  /** Office only. */
  distributor?: DistributorRef;
  /**
   * [Inc 2] The customer's confirmation, for the owning shop and the office on every order answer
   * (`GET /orders`, `?tab`, `GET /orders/board`, `GET /orders/:id`): null when there is none (not
   * delivered, or delivered while `confirmation.enabled` was off). Absent for a driver, who never gets
   * anything of the customer's link. Never money. The apps show it only while `features.confirmations`.
   */
  confirmation?: OrderConfirmationSummary | null;
}

/** `POST /orders/quote` (distributor): the cost of the order as it stands, and whether the wallet covers it. */
export interface OrderQuoteResult {
  quote: DeliveryQuote;
  wallet: { balancePaisa: Paisa; enough: boolean; shortByPaisa: Paisa };
}

/** `GET /orders/board` (office). */
export interface OrderBoardDto {
  counts: { needsDriver: number; inProgress: number; doneToday: number; cancelledFailed: number };
  items: OrderDto[];
  nextCursor: string | null;
}

/** `POST /orders/:id/cancel`. */
export interface OrderCancelResult {
  order: OrderDto;
  refundedPaisa: Paisa;
}

/** `POST /orders/:id/assign-driver` (office). */
export interface AssignDriverResult {
  tripId: UUID;
  driverId: UUID;
  originStoreId: UUID;
  reassignedFromTripId?: UUID;
  /**
   * [Inc 2] True when the order joined the driver's PLANNED trip from the same store (it had no load
   * scan yet); false when a new trip was made (API_CONTRACT §9.5).
   */
  appendedToExistingTrip?: boolean;
}
