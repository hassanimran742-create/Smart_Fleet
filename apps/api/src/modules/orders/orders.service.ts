import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DeliveryMethod, DriverAvailability, OrderStatus, Prisma, TripStatus, UserRole, UserStatus } from '@prisma/client';
import {
  ORDER_LIST_TAB_STATUSES,
  type AssignDriverResult,
  type OrderBoardDto,
  type OrderCancelReason,
  type OrderDto,
  type OrderQuoteResult,
  type Page,
  type DeliveryFailureReason,
} from '@smartfleet/shared-types';
import { deriveOrderStage, normalizePkPhone } from '@smartfleet/shared-utils';
import {
  failOrderSchema,
  officeCancelOrderSchema,
  officeFailOrderSchema,
  type AssignDriverInput,
  type CreateOrderInput,
  type ManualDeliveryV2Input,
  type OrderBoardQuery,
  type OrdersQuery,
  type UpdateOrderStatusInput,
} from '@smartfleet/shared-validation';
import { Queue } from 'bullmq';
import { actorUserId, type Actor, type UserActor } from '../../common/auth/actor';
import { canSeeClient, canSeeOrder, type PolicyCaller } from '../../common/auth/policies';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, assertSameRequest, IdempotentResponse, replayed } from '../../common/idempotency/idempotency';
import { decodeCursor, invalidCursor, toPage } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConfirmationService } from '../confirmation/confirmation.interface';
import { orderVisit } from '../custody/order-visit';
import { pickupCounts } from '../custody/progress';
import { ScanService } from '../custody/scan.service';
import { toDeliveryQuote, type FeeQuote } from '../pricing/delivery-fee.strategy';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { lockTripRow, tripHasLoadOrHandover } from '../trips/trip-writes';
import { TripsService } from '../trips/trips.service';
import { WalletService } from '../wallet/wallet.service';
import { boardTabAscending, boardTabWhere, CANCELLED_FAILED_DAYS_BEFORE, listTabWhere } from './order-tabs';
import { lockOrder, markOrderDeliveredManually } from './order-writes';
import { loadOrdersForPolicy, OrdersFeePolicy, isDeliveryStarted } from './orders-fee.policy';
import { ORDER_VIEW_INCLUDE, orderShortCode, toOrderDtos, type OrderViewRow } from './orders.mapper';
import { currentBusinessDays } from './support/business-day';
import { LOCKING_TX, type Db, type Tx } from './support/tx';

/** `POST /orders/:id/cancel` once the body is checked for the caller (shop or office rules). */
export interface CancelOrderCommand {
  reasonCode: OrderCancelReason;
  note?: string;
  /** Digit string: the refund the person saw. */
  confirmRefundPaisa?: string;
}

/** `POST /orders/:id/fail` once the body is checked for the caller. */
export interface FailOrderCommand {
  reasonCode: DeliveryFailureReason;
  note?: string;
  lat?: number;
  lng?: number;
}

export interface OrderCancelResponse {
  order: OrderDto;
  refundedPaisa: string;
}

/** The legacy tracking answer (orders.service.ts:92-124 kept this shape). */
export interface OrderTracking {
  orderId: string;
  status: OrderStatus;
  paymentStatus: string;
  deliveryFeePaisa: string;
  destination: { lat: number; lng: number } | null;
  driverLocation: { lat: number; lng: number } | null;
  driver: { id: string; name: string; phone: string; vehiclePlate: string | null } | null;
  tripId: string | null;
}

const OPEN: OrderStatus[] = [...ORDER_LIST_TAB_STATUSES.active];
const WITH_DRIVER: OrderStatus[] = [OrderStatus.ASSIGNED, OrderStatus.IN_TRANSIT];
const OPEN_TRIP: TripStatus[] = [TripStatus.PLANNED, TripStatus.IN_PROGRESS];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_ALL_LIMIT = 200;
const BARE_LIST_LIMIT = 100;
/** How long `POST /orders` waits for the auto-dispatch enqueue before answering without it. */
const DISPATCH_ENQUEUE_TIMEOUT_MS = 1_500;

interface PreparedOrder {
  distributor: { id: string; code: string | null; homeStoreId: string };
  point: { lat: number; lng: number };
}

function pinKey(point: { lat: number; lng: number } | null): string | null {
  return point ? `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}` : null;
}

function linesKey(lines: ReadonlyArray<{ cylinderTypeId: string; fullCount: number; expectedReturnCount: number }>): string {
  return JSON.stringify(
    [...lines]
      .map((line) => ({ cylinderTypeId: line.cylinderTypeId.toLowerCase(), fullCount: line.fullCount, expectedReturnCount: line.expectedReturnCount }))
      .sort((a, b) => a.cylinderTypeId.localeCompare(b.cylinderTypeId)),
  );
}

/**
 * Orders (API_CONTRACT §7.6, §8.1). Placing an order deducts its cost in the same transaction
 * (OrdersFeePolicy → WalletService); a cancel before delivery has started returns it once; nothing at
 * the door moves money. Every transition locks the order row first, so of two racing actions the
 * second always sees the first's result, and a repeat answers as the first did.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly trips: TripsService,
    private readonly feePolicy: OrdersFeePolicy,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
    private readonly scans: ScanService,
    private readonly confirmations: ConfirmationService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
  ) {}

  // ---------- place and quote ----------

  /**
   * `POST /orders` (DISTRIBUTOR exact, Idempotency-Key). The key is looked up first, so a retry gets
   * the first order even if it would now be refused. Then rules 1–7 of §7.6: an active distributor
   * with a store; the caller's customer and address; at most `orders.maxCylindersPerOrder` cylinders;
   * the quote (422); `quotedTotalPaisa` (409 PRICING_QUOTE_CHANGED); one transaction that numbers the
   * order, inserts it with its own copy of the cost, deducts the cost (409
   * WALLET_INSUFFICIENT_BALANCE, nothing created) and audits `order.create`; auto-dispatch only when on.
   */
  async create(actor: UserActor, body: CreateOrderInput, key: string | undefined): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    const distributorId = ownDistributorId(actor);
    if (key) {
      const existing = await this.findByKey(distributorId, key);
      if (existing) return replayed(await this.replay(actor, existing, body));
    }

    const prepared = await this.prepare(actor, body);
    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(async (tx) => {
        const quote = await this.pricing.quoteOrder(distributorId, prepared.point, body.lines, tx);
        if (body.quotedTotalPaisa !== undefined && BigInt(body.quotedTotalPaisa) !== quote.totalPaisa) {
          throw new AppError('PRICING_QUOTE_CHANGED', { totalPaisa: quote.totalPaisa.toString(), quote: toDeliveryQuote(quote) });
        }
        return this.insertOrder(tx, actor, prepared, body, quote, key);
      }, LOCKING_TX);
    } catch (error) {
      if (key && isUniqueViolation(error, 'orders_distributor_id_client_request_id_key')) {
        const first = await this.findByKey(distributorId, key);
        if (first) return replayed(await this.replay(actor, first, body));
      }
      throw error;
    }

    if (await this.settings.get('dispatch.autoAssign.enabled')) await this.enqueueDispatch(orderId);
    return this.view(actor, orderId);
  }

  /**
   * Queues auto-dispatch for an order already placed and charged, without ever holding up the answer
   * (§2.2: Redis being down never fails a request). BullMQ waits for Redis to come back instead of
   * failing, so the wait is capped; an enqueue that doesn't make it only means the office assigns the
   * order by hand (§7.6 rule 7).
   */
  private async enqueueDispatch(orderId: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const added = this.dispatchQueue.add('dispatch-order', { orderId });
      const timedOut = new Promise<'TIMED_OUT'>((resolve) => {
        timer = setTimeout(() => resolve('TIMED_OUT'), DISPATCH_ENQUEUE_TIMEOUT_MS);
      });
      if ((await Promise.race([added, timedOut])) === 'TIMED_OUT') {
        this.logger.warn(`auto-dispatch for order ${orderId} is still waiting for Redis after ${DISPATCH_ENQUEUE_TIMEOUT_MS} ms; answering without it`);
        added.catch((error: Error) => this.logger.warn(`auto-dispatch could not be queued for order ${orderId}: ${error.message}`));
      }
    } catch (error) {
      this.logger.warn(`auto-dispatch could not be queued for order ${orderId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `POST /orders/quote` (DISTRIBUTOR exact): the create path's rules 1–4 with no writes, and whether
   * the balance covers the cost. `quotedTotalPaisa` is ignored.
   */
  async quote(actor: UserActor, body: CreateOrderInput): Promise<OrderQuoteResult> {
    const distributorId = ownDistributorId(actor);
    const prepared = await this.prepare(actor, body);
    const quote = await this.pricing.quoteOrder(distributorId, prepared.point, body.lines);
    const wallet = await this.wallet.summary(distributorId);
    const balance = BigInt(wallet.balancePaisa);
    const enough = balance >= quote.totalPaisa;
    return {
      quote: toDeliveryQuote(quote),
      wallet: { balancePaisa: balance.toString(), enough, shortByPaisa: enough ? '0' : (quote.totalPaisa - balance).toString() },
    };
  }

  // ---------- reads ----------

  /** `GET /orders` (DISTRIBUTOR exact): the newest 100 as a bare array; with `tab`, a cursor page. */
  async list(actor: UserActor, query: OrdersQuery): Promise<OrderDto[] | Page<OrderDto>> {
    const distributorId = ownDistributorId(actor);
    if (!query.tab) {
      const rows = await this.prisma.order.findMany({
        where: { distributorId },
        include: ORDER_VIEW_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: BARE_LIST_LIMIT,
      });
      return this.views(actor, rows);
    }
    return this.page(actor, { AND: [{ distributorId }, listTabWhere(query.tab)] }, query.limit, query.cursor, false);
  }

  /** `GET /orders/:id` (`canSeeOrder`: the office, the owner, the driver of the order's trip). */
  async byId(caller: PolicyCaller, id: string): Promise<OrderDto> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: ORDER_VIEW_INCLUDE });
    canSeeOrder(caller, row ? { distributorId: row.distributorId, trip: row.trip ? { driverId: row.trip.driverId } : null } : null);
    const [dto] = await this.views(caller, [row as OrderViewRow]);
    // [Inc 2] The visit by cylinder number, for the shop's and the office's order detail (never a driver's).
    if (caller.role === UserRole.DRIVER) return dto;
    return { ...dto, visit: await orderVisit(this.prisma, id) };
  }

  /**
   * `GET /orders/:id/tracking`: the owning distributor or the office; the shape is unchanged. The
   * distributor gets the driver's position only while the order is on the way on an open trip (the TRACK
   * rule, §1.6): once it is delivered, cancelled or failed, or before it leaves, `driverLocation` is null,
   * so a finished order never shows where its driver is now (he may be at another distributor's
   * customer). The office sees every driver anyway (`GET /drivers`).
   */
  async tracking(caller: PolicyCaller, id: string): Promise<OrderTracking> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        distributorId: true,
        status: true,
        paymentStatus: true,
        deliveryFeePaisa: true,
        loadStartedAt: true,
        onTheWayAt: true,
        tripId: true,
        trip: {
          select: {
            driverId: true,
            status: true,
            vehicle: { select: { plateNo: true } },
            driver: { select: { id: true, user: { select: { name: true, phone: true } } } },
          },
        },
      },
    });
    const office = caller.role === UserRole.SUPER_ADMIN;
    const owner = caller.role === UserRole.DISTRIBUTOR && !!caller.distributorId && caller.distributorId === order?.distributorId;
    if (!order || !(office || owner)) throw new AppError('NOT_FOUND');
    const onTheWay =
      deriveOrderStage({ status: order.status, loadStartedAt: order.loadStartedAt, onTheWayAt: order.onTheWayAt }) === 'ON_THE_WAY' &&
      !!order.trip &&
      OPEN_TRIP.includes(order.trip.status);
    let driverLocation: { lat: number; lng: number } | null = null;
    if (order.trip?.driverId && (office || onTheWay)) {
      const rows = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(current_location) AS lat, ST_X(current_location) AS lng
        FROM drivers WHERE id = ${order.trip.driverId}::uuid AND current_location IS NOT NULL`;
      if (rows[0]) driverLocation = { lat: rows[0].lat, lng: rows[0].lng };
    }
    const destination = await this.pinOf(this.prisma, id);
    return {
      orderId: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      deliveryFeePaisa: order.deliveryFeePaisa.toString(),
      destination,
      driverLocation,
      driver: order.trip
        ? {
            id: order.trip.driver.id,
            name: order.trip.driver.user.name,
            phone: order.trip.driver.user.phone,
            vehiclePlate: order.trip.vehicle?.plateNo ?? null,
          }
        : null,
      tripId: order.tripId,
    };
  }

  /**
   * `GET /orders/board` (office): one tab of orders and the size of each tab (with `distributorId`
   * applied and `q` ignored). `q` matches the order number (AG-0142), the customer's name or phone
   * (typed or stored form) and the delivery label.
   */
  async board(caller: PolicyCaller, query: OrderBoardQuery): Promise<OrderBoardDto> {
    const [today, week] = await Promise.all([
      currentBusinessDays(this.settings, 0),
      currentBusinessDays(this.settings, CANCELLED_FAILED_DAYS_BEFORE),
    ]);
    const scope: Prisma.OrderWhereInput = query.distributorId ? { distributorId: query.distributorId } : {};
    const count = (tab: 'needs-driver' | 'in-progress' | 'done-today' | 'cancelled-failed') =>
      this.prisma.order.count({ where: { AND: [scope, boardTabWhere(tab, today, week)] } });
    const [needsDriver, inProgress, doneToday, cancelledFailed, page] = await Promise.all([
      count('needs-driver'),
      count('in-progress'),
      count('done-today'),
      count('cancelled-failed'),
      this.page(
        caller,
        { AND: [scope, boardTabWhere(query.tab, today, week), this.searchWhere(query.q)] },
        query.limit,
        query.cursor,
        boardTabAscending(query.tab),
      ),
    ]);
    return { counts: { needsDriver, inProgress, doneToday, cancelledFailed }, items: page.items, nextCursor: page.nextCursor };
  }

  /** `GET /orders/all` (office): the legacy array, kept for one release. */
  listAll(status?: string) {
    const known = (Object.values(OrderStatus) as string[]).includes(status ?? '') ? (status as OrderStatus) : undefined;
    return this.prisma.order.findMany({
      where: known ? { status: known } : undefined,
      include: {
        lines: true,
        client: { select: { id: true, name: true, phone: true, area: true, address: true } },
        distributor: { select: { id: true, businessName: true, code: true } },
        trip: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LEGACY_ALL_LIMIT,
    });
  }

  // ---------- transitions ----------

  /**
   * `POST /orders/:id/cancel` (the owning distributor or the office). Under the order lock: already
   * CANCELLED answers as the first cancel did (`X-Already-Applied`); DELIVERED or FAILED is 409
   * ORDER_NOT_CANCELLABLE; a started hand-over 409 ORDER_HANDOVER_STARTED; then the fee policy (terms,
   * `confirmRefundPaisa`, the one reversal), the guarded update, the stop and an idle trip closed, and
   * the `order.cancel` audit row `{ refunded, refundPaisa, startedRule }`.
   */
  async cancel(actor: UserActor, id: string, command: CancelOrderCommand): Promise<OrderCancelResponse | IdempotentResponse<OrderCancelResponse>> {
    const owned = await this.seeOrder(actor, id);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { status: true, feeStatus: true, deliveryFeePaisa: true, tripId: true, orderNo: true, distributor: { select: { code: true } } },
      });
      if (order.status === OrderStatus.CANCELLED) {
        return { applied: false, refundedPaisa: order.feeStatus === 'REVERSED' ? order.deliveryFeePaisa : 0n };
      }
      if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.FAILED) {
        throw new AppError('ORDER_NOT_CANCELLABLE', { currentStatus: order.status });
      }
      // The terms read the trip's stops and scans: lock the trip first, so each arrive, depart or scan
      // is either fully seen or waits for this cancel.
      if (order.tripId) await lockTripRow(tx, order.tripId);
      const view = (await loadOrdersForPolicy(tx, [id])).get(id);
      if (!view) throw new AppError('NOT_FOUND');
      if (view.handoverStarted) throw new AppError('ORDER_HANDOVER_STARTED');
      const money = await this.feePolicy.cancel(tx, view, {
        actor,
        reasonCode: command.reasonCode,
        note: command.note,
        confirmRefundPaisa: command.confirmRefundPaisa === undefined ? undefined : BigInt(command.confirmRefundPaisa),
      });
      const updated = await tx.order.updateMany({
        where: { id, status: { in: OPEN } },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledByUserId: actorUserId(actor),
          cancelReasonCode: command.reasonCode,
          cancellationReason: command.note ?? null,
        },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      if (order.tripId) {
        await this.trips.closeOrderStop(tx, order.tripId, id, 'CANCELLED');
        await this.trips.abortIfIdle(tx, order.tripId, id);
      }
      await this.audit.record(
        {
          action: 'order.cancel',
          actor,
          resourceType: 'order',
          resourceId: id,
          distributorId: owned.distributorId,
          reason: command.note ?? command.reasonCode,
          diff: {
            no: orderShortCode(order.distributor.code, order.orderNo),
            reasonCode: command.reasonCode,
            ...(command.note ? { note: command.note } : {}),
            refunded: money.refunded,
            refundPaisa: money.refundPaisa.toString(),
            startedRule: money.startedRule,
          },
        },
        tx,
      );
      return { applied: true, refundedPaisa: money.refundPaisa };
    }, LOCKING_TX);
    const result = { order: await this.view(actor, id), refundedPaisa: outcome.refundedPaisa.toString() };
    return outcome.applied ? result : alreadyApplied(result);
  }

  /**
   * `POST /orders/:id/fail` (the trip's driver or the office). Under the order lock: already FAILED
   * answers `X-Already-Applied`; DELIVERED or CANCELLED is 409 ORDER_INVALID_TRANSITION; a started
   * hand-over 409 ORDER_HANDOVER_STARTED; an order not yet started (no driver, or before the cut-off)
   * 409 ORDER_NOT_STARTED_USE_CANCEL. The stop becomes FAILED. No money.
   */
  async fail(actor: UserActor, id: string, command: FailOrderCommand): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    const owned = await this.seeOrder(actor, id);
    const rule = await this.feePolicy.deliveryStartedRule();
    const applied = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForDriverOrOffice(tx, actor, id);
      if (order.status === OrderStatus.FAILED) return false;
      if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) {
        throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.FAILED, currentStatus: order.status });
      }
      if (order.tripId) await lockTripRow(tx, order.tripId);
      const view = (await loadOrdersForPolicy(tx, [id])).get(id);
      if (!view) throw new AppError('NOT_FOUND');
      if (view.handoverStarted) throw new AppError('ORDER_HANDOVER_STARTED');
      if (!WITH_DRIVER.includes(order.status) || !isDeliveryStarted(view, rule)) throw new AppError('ORDER_NOT_STARTED_USE_CANCEL');
      const updated = await tx.order.updateMany({
        where: { id, status: { in: WITH_DRIVER } },
        data: { status: OrderStatus.FAILED, failedAt: new Date(), failureReasonCode: command.reasonCode, failureNote: command.note ?? null },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      if (order.tripId) await this.trips.closeOrderStop(tx, order.tripId, id, 'FAILED');
      await this.audit.record(
        {
          action: 'order.fail',
          actor,
          resourceType: 'order',
          resourceId: id,
          distributorId: owned.distributorId,
          reason: command.note ?? command.reasonCode,
          diff: {
            no: orderShortCode(order.code, order.orderNo),
            reasonCode: command.reasonCode,
            ...(command.note ? { note: command.note } : {}),
            ...(command.lat !== undefined && command.lng !== undefined ? { lat: command.lat, lng: command.lng } : {}),
          },
        },
        tx,
      );
      return true;
    }, LOCKING_TX);
    const view = await this.view(actor, id);
    return applied ? view : alreadyApplied(view);
  }

  /**
   * The driver's Delivered tap (`PATCH /orders/:id/status` DELIVERED, the installed 0.1.0 app). From
   * Inc 2 it behaves like the visit finish (API_CONTRACT §9.10): own trip only, and the hand-over scans
   * must match the order (409 DELIVERY_SCANS_INCOMPLETE); the order becomes DELIVERED by SCANNED, once.
   * A repeat answers `X-Already-Applied`; an order the office delivered is 409. No money.
   */
  async driverDelivered(actor: UserActor, id: string): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    await this.seeOrder(actor, id);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForDriverOrOffice(tx, actor, id);
      if (order.status === OrderStatus.DELIVERED) {
        if (order.deliveryMethod !== DeliveryMethod.MANUAL) return { applied: false, issued: null };
        throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.DELIVERED, currentStatus: order.status });
      }
      if (!WITH_DRIVER.includes(order.status) || !order.tripId || !order.tripStatus || !OPEN_TRIP.includes(order.tripStatus)) {
        throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.DELIVERED, currentStatus: order.status });
      }
      const finish = await this.trips.legacyDeliveredTap(tx, actor, { id, tripId: order.tripId });
      return { applied: true, issued: finish.issued };
    }, LOCKING_TX);
    void this.confirmations.sendIssued(outcome.issued);
    const view = await this.view(actor, id);
    return outcome.applied ? view : alreadyApplied(view);
  }

  /** The driver's own ASSIGNED → IN_TRANSIT (`PATCH /orders/:id/status`), setting `onTheWayAt`. */
  async driverOnTheWay(actor: UserActor, id: string): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    await this.seeOrder(actor, id);
    const applied = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForDriverOrOffice(tx, actor, id);
      if (order.status === OrderStatus.IN_TRANSIT) return false;
      if (order.status !== OrderStatus.ASSIGNED) {
        throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.IN_TRANSIT, currentStatus: order.status });
      }
      await tx.$executeRaw`
        UPDATE orders SET status = 'IN_TRANSIT', on_the_way_at = COALESCE(on_the_way_at, (now() AT TIME ZONE 'UTC')), updated_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${id}::uuid AND status = 'ASSIGNED'`;
      return true;
    }, LOCKING_TX);
    const view = await this.view(actor, id);
    return applied ? view : alreadyApplied(view);
  }

  /** The office's PENDING → CONFIRMED (`PATCH /orders/:id/status`): allowed, never offered in the UI. */
  async confirm(actor: UserActor, id: string): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    await this.seeOrder(actor, id);
    const applied = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.order.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (order.status === OrderStatus.CONFIRMED) return false;
      if (order.status !== OrderStatus.PENDING) {
        throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.CONFIRMED, currentStatus: order.status });
      }
      await tx.order.updateMany({ where: { id, status: OrderStatus.PENDING }, data: { status: OrderStatus.CONFIRMED } });
      return true;
    }, LOCKING_TX);
    const view = await this.view(actor, id);
    return applied ? view : alreadyApplied(view);
  }

  /**
   * `PATCH /orders/:id/status` (legacy; the installed driver app and the old office screens), with the
   * from-state rules of §7.6: the driver's IN_TRANSIT and DELIVERED (own trip), FAILED as `/fail`, the
   * office's CANCELLED as `/cancel` and PENDING → CONFIRMED; the office's DELIVERED is 400
   * ORDER_USE_MANUAL_DELIVERY; anything else 409 ORDER_INVALID_TRANSITION.
   */
  async updateStatus(actor: UserActor, id: string, body: UpdateOrderStatusInput): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    const office = actor.role === UserRole.SUPER_ADMIN;
    switch (body.status) {
      case 'DELIVERED':
        if (!office) return this.driverDelivered(actor, id);
        await this.seeOrder(actor, id);
        throw new AppError('ORDER_USE_MANUAL_DELIVERY');
      case 'FAILED': {
        const fail = { reasonCode: body.reasonCode ?? 'OTHER', note: body.reason };
        const command = new ZodBody(office ? officeFailOrderSchema : failOrderSchema).transform(fail);
        return this.fail(actor, id, command);
      }
      case 'CANCELLED': {
        if (!office) return this.refuseTransition(actor, id, body.status);
        const command = new ZodBody(officeCancelOrderSchema).transform({ reasonCode: body.reasonCode ?? 'OTHER', note: body.reason });
        const result = await this.cancel(actor, id, command);
        return result instanceof IdempotentResponse ? alreadyApplied(result.body.order) : result.order;
      }
      case 'IN_TRANSIT':
        return office ? this.refuseTransition(actor, id, body.status) : this.driverOnTheWay(actor, id);
      case 'CONFIRMED':
        return office ? this.confirm(actor, id) : this.refuseTransition(actor, id, body.status);
      default:
        return this.refuseTransition(actor, id, body.status);
    }
  }

  /** 409 ORDER_INVALID_TRANSITION `{ from, to }` for a status change the table doesn't allow. */
  private async refuseTransition(actor: UserActor, id: string, to: string): Promise<never> {
    const order = await this.seeOrder(actor, id);
    throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to, currentStatus: order.status });
  }

  /**
   * `POST /orders/:id/assign-driver` (office). Rules in order (§7.6): lock the order; PENDING,
   * CONFIRMED or ASSIGNED (409 ORDER_NOT_ASSIGNABLE), and the same driver again changes nothing (200
   * `X-Already-Applied`); the driver ACTIVE and AVAILABLE (409 ASSIGN_DRIVER_NOT_AVAILABLE) with a van
   * (409 ASSIGN_DRIVER_NO_VEHICLE); the origin is the home store; a loaded order can't change driver
   * (409 ASSIGN_ORDER_LOADED), else its old stop is cancelled and an idle old trip aborted; then a new
   * trip from the home store. Audited `order.assign` or `order.reassign`. No money.
   */
  async assignDriver(actor: Actor, id: string, body: AssignDriverInput): Promise<AssignDriverResult | IdempotentResponse<AssignDriverResult>> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, id))) throw new AppError('NOT_FOUND');
      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          distributorId: true,
          orderNo: true,
          tripId: true,
          loadStartedAt: true,
          distributor: { select: { code: true, homeStoreId: true } },
          trip: {
            select: {
              id: true,
              status: true,
              driverId: true,
              originStoreId: true,
              vehicle: { select: { plateNo: true } },
              driver: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });
      if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CONFIRMED && order.status !== OrderStatus.ASSIGNED) {
        throw new AppError('ORDER_NOT_ASSIGNABLE', { currentStatus: order.status });
      }
      if (order.status === OrderStatus.ASSIGNED && order.trip && OPEN_TRIP.includes(order.trip.status) && order.trip.driverId === body.driverId) {
        return { applied: false, result: { tripId: order.trip.id, driverId: body.driverId, originStoreId: order.trip.originStoreId } };
      }

      const driver = await tx.driver.findUnique({
        where: { id: body.driverId },
        select: { id: true, availability: true, currentVehicleId: true, user: { select: { name: true, status: true } } },
      });
      if (!driver) throw new AppError('NOT_FOUND', { field: 'driverId' });
      if (driver.user.status !== UserStatus.ACTIVE || driver.availability !== DriverAvailability.AVAILABLE) {
        throw new AppError('ASSIGN_DRIVER_NOT_AVAILABLE', { driver: driver.user.name });
      }
      if (!driver.currentVehicleId) throw new AppError('ASSIGN_DRIVER_NO_VEHICLE', { driver: driver.user.name });

      const homeStoreId = order.distributor.homeStoreId;
      if (!homeStoreId) throw new AppError('DISTRIBUTOR_NO_STORE');
      const store = await this.storePin(tx, homeStoreId);

      let fromTripId: string | null = null;
      if (order.tripId && order.trip) {
        await lockTripRow(tx, order.tripId);
        // A hand-back (SCAN_IN) of an earlier run's empties loads nothing: it doesn't block (§7.6 rule 4).
        if (order.loadStartedAt || (await tripHasLoadOrHandover(tx, order.tripId))) {
          throw new AppError('ASSIGN_ORDER_LOADED', { plateNo: order.trip.vehicle.plateNo });
        }
        await this.trips.closeOrderStop(tx, order.tripId, id, 'CANCELLED');
        await this.trips.abortIfIdle(tx, order.tripId, id);
        fromTripId = order.tripId;
      }

      const destination = await this.pinOf(tx, id);
      if (!destination) throw new AppError('NOT_FOUND');
      // [Inc 2] assign-driver v2 (§9.5): join the driver's PLANNED trip from the same store while it has
      // no load scan; otherwise a new trip.
      const joinTripId = await this.trips.appendableTrip(tx, { driverId: driver.id, vehicleId: driver.currentVehicleId, storeId: homeStoreId });
      let tripId: string;
      if (joinTripId) {
        await this.trips.appendOrder(tx, joinTripId, id, destination);
        tripId = joinTripId;
      } else {
        tripId = await this.trips.createForOrder(tx, {
          driverId: driver.id,
          vehicleId: driver.currentVehicleId,
          store,
          orderId: id,
          destination,
        });
      }
      await tx.order.update({
        where: { id },
        data: { status: OrderStatus.ASSIGNED, tripId, assignedAt: new Date(), originStoreId: homeStoreId },
      });
      const no = orderShortCode(order.distributor.code, order.orderNo);
      const appended = joinTripId !== null;
      await this.audit.record(
        {
          action: fromTripId ? 'order.reassign' : 'order.assign',
          actor,
          resourceType: 'order',
          resourceId: id,
          distributorId: order.distributorId,
          reason: body.reason ?? null,
          diff: fromTripId
            ? { no, from: order.trip?.driver.user.name ?? '', to: driver.user.name, fromTripId, toTripId: tripId, driverId: driver.id, appended }
            : { no, driver: driver.user.name, tripId, driverId: driver.id, appended },
        },
        tx,
      );
      const result: AssignDriverResult = { tripId, driverId: driver.id, originStoreId: homeStoreId, appendedToExistingTrip: appended };
      if (fromTripId) result.reassignedFromTripId = fromTripId;
      return { applied: true, result };
    }, LOCKING_TX);
    return outcome.applied ? outcome.result : alreadyApplied(outcome.result);
  }

  /**
   * `POST /orders/:id/manual-delivery` v2 (office, the forgotten-IN path; API_CONTRACT §9.5) `{ reason,
   * cylinders, takenBack? }`. Checks in order: the body (400); the status: ASSIGNED or IN_TRANSIT, a
   * repeat of this office delivery 200 `X-Already-Applied`, anything else (a driver's delivery included)
   * 409 ORDER_INVALID_TRANSITION; every code resolves (404 SCAN_CYLINDER_UNKNOWN `{code}`); the named
   * cylinders must fit the order exactly (409 MANUAL_DELIVERY_CYLINDERS_MISMATCH), else nothing moves.
   * Then one transaction: the cylinders move (source MANUAL), the visit is DONE, the order DELIVERED by
   * MANUAL, one `order.manual_delivery` audit row plus one `custody.manual_event` row per cylinder moved,
   * and the customer confirmation when `confirmation.enabled`. No money.
   */
  async manualDelivery(actor: UserActor, id: string, body: ManualDeliveryV2Input): Promise<OrderDto | IdempotentResponse<OrderDto>> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, id))) throw new AppError('NOT_FOUND');
      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          deliveryMethod: true,
          tripId: true,
          distributorId: true,
          clientId: true,
          orderNo: true,
          distributor: { select: { code: true, homeStoreId: true } },
          lines: { select: { cylinderTypeId: true, fullCount: true } },
          trip: { select: { id: true, vehicleId: true } },
        },
      });
      if (order.status === OrderStatus.DELIVERED && order.deliveryMethod === DeliveryMethod.MANUAL) return { applied: false, issued: null };
      if (!WITH_DRIVER.includes(order.status) || !order.trip) {
        throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.DELIVERED, currentStatus: order.status });
      }
      // Orders, then the trip, then the visit, then the cylinders (the scans lock in the same order).
      await lockTripRow(tx, order.trip.id);
      const stop = await this.trips.lockOrderStop(tx, order.trip.id, id);
      if (!stop) throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: OrderStatus.DELIVERED, currentStatus: order.status });
      const moves = await this.scans.officeManualDelivery(tx, actor, {
        order: { id, clientId: order.clientId, distributorId: order.distributorId, lines: order.lines },
        distributor: { id: order.distributorId, code: order.distributor.code, homeStoreId: order.distributor.homeStoreId },
        trip: { id: order.trip.id, vehicleId: order.trip.vehicleId },
        stopId: stop.id,
        reason: body.reason,
        cylinders: body.cylinders,
        takenBack: body.takenBack ?? [],
      });
      const deliveredAt = await markOrderDeliveredManually(tx, id, actor.userId, body.reason);
      if (!deliveredAt) throw new AppError('CONFLICT_STALE_STATE');
      await this.trips.closeOrderStop(tx, order.trip.id, id, 'DONE');
      const no = orderShortCode(order.distributor.code, order.orderNo);
      await this.audit.record(
        {
          action: 'order.manual_delivery',
          actor,
          resourceType: 'order',
          resourceId: id,
          distributorId: order.distributorId,
          reason: body.reason,
          diff: {
            no,
            cylinders: body.cylinders.map((c) => c.code),
            takenBack: (body.takenBack ?? []).map((c) => ({ code: c.code, returnState: c.returnState })),
          },
        },
        tx,
      );
      for (const move of moves) {
        await this.audit.record(
          {
            action: 'custody.manual_event',
            actor,
            resourceType: 'cylinder',
            resourceId: move.cylinderId,
            distributorId: order.distributorId,
            reason: body.reason,
            diff: { eventId: move.eventId, from: move.from, to: move.to, orderId: id, no, code: move.code, direction: move.direction },
          },
          tx,
        );
      }
      const issued = await this.confirmations.issueForDeliveredOrder(tx, { orderId: id, stopId: stop.id, deliveredAt });
      return { applied: true, issued };
    }, LOCKING_TX);
    void this.confirmations.sendIssued(outcome.issued);
    const view = await this.view(actor, id);
    return outcome.applied ? view : alreadyApplied(view);
  }

  // ---------- internals ----------

  /** Rules 1–3 of §7.6 (no writes), shared by create and quote. */
  private async prepare(actor: UserActor, body: CreateOrderInput): Promise<PreparedOrder> {
    const distributorId = ownDistributorId(actor);
    const distributor = await this.prisma.distributor.findUnique({
      where: { id: distributorId },
      select: { id: true, code: true, status: true, homeStoreId: true },
    });
    if (!distributor) throw new AppError('NOT_FOUND');
    if (distributor.status !== 'ACTIVE') throw new AppError('DISTRIBUTOR_NOT_ACTIVE');
    if (!distributor.homeStoreId) throw new AppError('DISTRIBUTOR_NO_STORE');

    const client = canSeeClient(
      actor,
      await this.prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true, distributorId: true } }),
      { access: 'write' },
    );
    let point: { lat: number; lng: number };
    if (body.addressId) {
      const pins = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(location) AS lat, ST_X(location) AS lng
        FROM client_addresses WHERE id = ${body.addressId}::uuid AND client_id = ${client.id}::uuid`;
      if (!pins[0]) throw new AppError('CLIENT_ADDRESS_NOT_FOUND');
      point = pins[0];
    } else {
      point = body.deliveryLocation as { lat: number; lng: number };
    }

    const max = await this.settings.get('orders.maxCylindersPerOrder');
    const total = body.lines.reduce((sum, line) => sum + line.fullCount, 0);
    if (total > max) throw new AppError('ORDER_TOO_MANY_CYLINDERS', { max });
    return { distributor: { id: distributor.id, code: distributor.code, homeStoreId: distributor.homeStoreId }, point };
  }

  /** Rule 6 of §7.6, inside the order's transaction (DATA_MODEL §3.6 "Place an order"). */
  private async insertOrder(
    tx: Tx,
    actor: UserActor,
    prepared: PreparedOrder,
    body: CreateOrderInput,
    quote: FeeQuote,
    key: string | undefined,
  ): Promise<string> {
    const distributorId = prepared.distributor.id;
    // Numbering locks the distributor row for the rest of the transaction.
    const numbered = await tx.$queryRaw<Array<{ no: number }>>`
      UPDATE distributors SET next_order_no = next_order_no + 1, updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id = ${distributorId}::uuid
      RETURNING next_order_no - 1 AS no`;
    const orderNo = Number(numbered[0].no);
    const charged = quote.totalPaisa > 0n;
    const feeDetails = JSON.stringify({
      zoneId: quote.zone.id,
      zoneName: quote.zone.name,
      priceId: quote.price.id,
      priceUpdatedAt: quote.price.updatedAt.toISOString(),
    });
    // timestamp(3) columns hold UTC (DATA_MODEL §5.4): ISO strings with "Z", read as UTC whatever the session zone.
    const windowStart = body.scheduledWindowStart ? new Date(body.scheduledWindowStart).toISOString() : null;
    const windowEnd = body.scheduledWindowEnd ? new Date(body.scheduledWindowEnd).toISOString() : null;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO orders (
        id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id, origin_store_id,
        order_no, client_request_id, status, payment_status, delivery_fee_paisa, fee_status, fee_strategy,
        fee_base_paisa, fee_quoted_at, fee_details, scheduled_window_start, scheduled_window_end, created_at, updated_at)
      VALUES (
        gen_random_uuid(), ${distributorId}::uuid, ${body.clientId}::uuid,
        ST_SetSRID(ST_MakePoint(${prepared.point.lng}, ${prepared.point.lat}), 4326),
        ${body.deliveryLabel}, ${quote.zone.id}::uuid, ${prepared.distributor.homeStoreId}::uuid,
        ${orderNo}, ${key ?? null}::uuid, 'PENDING',
        ${charged ? 'PAID_VIA_LEDGER' : 'UNPAID'}::"OrderPaymentStatus", ${quote.totalPaisa},
        ${charged ? 'DEDUCTED' : 'NONE'}::"OrderFeeStatus", ${quote.strategy}::"FeeStrategy",
        ${quote.basePaisa}, (now() AT TIME ZONE 'UTC'), ${feeDetails}::jsonb,
        (${windowStart}::timestamptz AT TIME ZONE 'UTC'), (${windowEnd}::timestamptz AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      RETURNING id`;
    const orderId = rows[0].id;
    const perSize = new Map(quote.lines.map((line) => [line.cylinderTypeId, line]));
    await tx.orderLine.createMany({
      data: body.lines.map((line) => {
        const priced = perSize.get(line.cylinderTypeId);
        return {
          orderId,
          cylinderTypeId: line.cylinderTypeId,
          fullCount: line.fullCount,
          expectedReturnCount: line.expectedReturnCount,
          feePerCylinderPaisa: priced?.perCylinderPaisa ?? 0n,
          feePaisa: priced?.subtotalPaisa ?? 0n,
        };
      }),
    });
    await this.feePolicy.onCreated(tx, { id: orderId, distributorId }, quote, actor);
    await this.audit.record(
      {
        action: 'order.create',
        actor,
        resourceType: 'order',
        resourceId: orderId,
        distributorId,
        diff: {
          no: orderShortCode(prepared.distributor.code, orderNo),
          orderNo,
          totalPaisa: quote.totalPaisa.toString(),
          zone: quote.zone.name,
          lines: body.lines.map((line) => ({ cylinderTypeId: line.cylinderTypeId, fullCount: line.fullCount, expectedReturnCount: line.expectedReturnCount })),
          ...(body.note ? { note: body.note } : {}),
        },
      },
      tx,
    );
    return orderId;
  }

  private findByKey(distributorId: string, key: string) {
    return this.prisma.order.findUnique({
      where: { distributorId_clientRequestId: { distributorId, clientRequestId: key } },
      select: { id: true, clientId: true },
    });
  }

  /**
   * A retried `POST /orders`: the key fields must match the first request (§4.2: the customer, the
   * delivery point to 6 decimals, the lines as a set), else 409 IDEMPOTENCY_CONFLICT.
   */
  private async replay(actor: UserActor, existing: { id: string; clientId: string }, body: CreateOrderInput): Promise<OrderDto> {
    const [storedPin, storedLines] = await Promise.all([
      this.pinOf(this.prisma, existing.id),
      this.prisma.orderLine.findMany({ where: { orderId: existing.id }, select: { cylinderTypeId: true, fullCount: true, expectedReturnCount: true } }),
    ]);
    let incomingPin: { lat: number; lng: number } | null = body.deliveryLocation ?? null;
    if (body.addressId) {
      const pins = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(location) AS lat, ST_X(location) AS lng
        FROM client_addresses WHERE id = ${body.addressId}::uuid AND client_id = ${body.clientId}::uuid`;
      incomingPin = pins[0] ?? null;
    }
    assertSameRequest(
      { clientId: existing.clientId.toLowerCase(), point: pinKey(storedPin), lines: linesKey(storedLines) },
      { clientId: body.clientId.toLowerCase(), point: pinKey(incomingPin), lines: linesKey(body.lines) },
      ['clientId', 'point', 'lines'],
    );
    return this.view(actor, existing.id);
  }

  /** The order's owner, the office or the driver of its trip may act on it; anyone else gets 404. */
  private async seeOrder(caller: PolicyCaller, id: string): Promise<{ distributorId: string; status: OrderStatus }> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { distributorId: true, status: true, trip: { select: { driverId: true } } },
    });
    return canSeeOrder(caller, order);
  }

  /**
   * Locks the order, then re-reads it; a driver must still be the driver of its trip (a reassignment
   * may have happened since the first check), else 404.
   */
  private async lockForDriverOrOffice(tx: Tx, caller: PolicyCaller, id: string) {
    if (!(await lockOrder(tx, id))) throw new AppError('NOT_FOUND');
    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        deliveryMethod: true,
        tripId: true,
        orderNo: true,
        distributor: { select: { code: true } },
        trip: { select: { driverId: true, status: true } },
      },
    });
    if (caller.role === UserRole.DRIVER && (!caller.driverId || order.trip?.driverId !== caller.driverId)) {
      throw new AppError('NOT_FOUND');
    }
    return {
      status: order.status,
      deliveryMethod: order.deliveryMethod,
      tripId: order.tripId,
      tripStatus: order.trip?.status ?? null,
      orderNo: order.orderNo,
      code: order.distributor.code,
    };
  }

  private async view(caller: PolicyCaller, id: string): Promise<OrderDto> {
    const row = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: ORDER_VIEW_INCLUDE });
    return (await this.views(caller, [row]))[0];
  }

  /**
   * The OrderDtos of `rows`. From Inc 2 each carries the customer's `confirmation` summary for the
   * owning shop and the office, read with one query per list (API_CONTRACT §9.7; null when there is
   * none, as for an order delivered while `confirmation.enabled` was off). A driver never gets it: the
   * driver never receives anything of the customer's link (CUSTOMER_PAGE §1, CNF-040).
   */
  private async views(caller: PolicyCaller, rows: OrderViewRow[]): Promise<OrderDto[]> {
    const rule = await this.feePolicy.deliveryStartedRule();
    const dtos = await toOrderDtos(this.prisma, rows, caller, rule);
    if (caller.role === UserRole.DRIVER || dtos.length === 0) return dtos;
    const loadingTrips = dtos.filter((dto) => dto.stage === 'LOADING' && dto.trip).map((dto) => (dto.trip as { id: string }).id);
    const [summaries, loads] = await Promise.all([
      this.confirmations.summariesFor(dtos.map((dto) => dto.id)),
      pickupCounts(this.prisma, loadingTrips),
    ]);
    return dtos.map((dto) => ({
      ...dto,
      confirmation: summaries.get(dto.id) ?? null,
      // [Inc 2] "Loading · 3 of 5 loaded": the trip's load so far, only while the order is loading.
      load: dto.stage === 'LOADING' && dto.trip ? (loads.get(dto.trip.id) ?? null) : null,
    }));
  }

  /** A cursor page of orders sorted by `createdAt`, then id (ascending for the needs-driver tab). */
  private async page(caller: PolicyCaller, where: Prisma.OrderWhereInput, limit: number, cursor: string | undefined, ascending: boolean): Promise<Page<OrderDto>> {
    const after = decodeCursor(cursor, 2);
    const conditions: Prisma.OrderWhereInput[] = [where];
    if (after) {
      const [at, id] = after;
      const atDate = new Date(String(at));
      if (Number.isNaN(atDate.getTime()) || typeof id !== 'string' || !UUID.test(id)) throw invalidCursor();
      conditions.push(
        ascending
          ? { OR: [{ createdAt: { gt: atDate } }, { createdAt: atDate, id: { gt: id } }] }
          : { OR: [{ createdAt: { lt: atDate } }, { createdAt: atDate, id: { lt: id } }] },
      );
    }
    const direction = ascending ? 'asc' : 'desc';
    const rows = await this.prisma.order.findMany({
      where: { AND: conditions },
      include: ORDER_VIEW_INCLUDE,
      orderBy: [{ createdAt: direction }, { id: direction }],
      take: limit + 1,
    });
    const items = await this.views(caller, rows);
    return toPage(items, limit, (dto) => [dto.createdAt, dto.id]);
  }

  /** The office search `q`: the order number, the customer's name or phone, or the delivery label. */
  private searchWhere(q: string | undefined): Prisma.OrderWhereInput {
    const text = q?.trim();
    if (!text) return {};
    const or: Prisma.OrderWhereInput[] = [
      { client: { name: { contains: text, mode: 'insensitive' } } },
      { deliveryAddressLabel: { contains: text, mode: 'insensitive' } },
    ];
    const shortCode = /^([A-Za-z][A-Za-z0-9]{1,5})-0*(\d{1,9})$/.exec(text);
    if (shortCode) or.push({ distributor: { code: shortCode[1].toUpperCase() }, orderNo: Number(shortCode[2]) });
    if (/^[+\d\s().-]+$/.test(text)) {
      const phone = normalizePkPhone(text);
      if (phone) or.push({ client: { phone } });
      const digits = text.replace(/\D/g, '').replace(/^0+/, '');
      if (digits.length >= 4) or.push({ client: { phone: { contains: digits } } });
      if (/^\d{1,6}$/.test(text)) or.push({ orderNo: Number(text) });
    }
    return { OR: or };
  }

  private async pinOf(db: Db, orderId: string): Promise<{ lat: number; lng: number } | null> {
    const rows = await db.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(delivery_address) AS lat, ST_X(delivery_address) AS lng FROM orders WHERE id = ${orderId}::uuid`;
    return rows[0] ?? null;
  }

  private async storePin(db: Db, storeId: string): Promise<{ id: string; lat: number; lng: number }> {
    const rows = await db.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
      SELECT id, ST_Y(location) AS lat, ST_X(location) AS lng FROM stores WHERE id = ${storeId}::uuid`;
    if (!rows[0]) throw new AppError('DISTRIBUTOR_NO_STORE');
    return rows[0];
  }
}
