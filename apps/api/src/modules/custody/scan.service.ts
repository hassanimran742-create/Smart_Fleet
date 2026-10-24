import { Injectable } from '@nestjs/common';
import {
  CustodyType,
  CylinderEventSource,
  CylinderEventType,
  CylinderState,
  StopCylinderDirection,
  TripStatus,
  TripStopStatus,
  TripStopType,
  type CylinderEvent,
} from '@prisma/client';
import type {
  ErrorCode,
  ManualDeliveryProblemReason,
  ReturnState,
  ScanAction,
  ScanResult,
  SizeCount,
  StopProgress,
  StoreScanResult,
} from '@smartfleet/shared-types';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId, ownDriverId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { finishRefillReceive, planRefillReceive } from '../filling-orders/refill-receive';
import { lockOrder, lockTripOrders, stampLoadStarted } from '../orders/order-writes';
import { currentBusinessDays } from '../orders/support/business-day';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { SettingsService } from '../settings/settings.service';
import { autoStartTrip } from '../trips/trip-writes';
import { cylinderShortCode, resolveQrOrNumber, resolveScanCode, type EntryMethod } from './cylinder-codes';
import { holderLabel, scannedCylinder, sizeLabels } from './holders';
import { adjustInventoryLots } from './inventory-lots';
import { pickupProgress, stopProgress, type ProgressStop, type ProgressTrip } from './progress';
import { responsibleDriver } from './responsible';

/** The moves a driver scans at a stop (API_CONTRACT §9.3). */
export type DriverScanAction = 'LOAD' | 'HANDOVER' | 'TAKE_BACK';

/** `POST /trips/:tripId/scans` once the body is checked (the legacy route sends `scanId: null`). */
export interface DriverScanCommand {
  action: DriverScanAction;
  tripId: string;
  stopId: string;
  /** The app's scan id. Null for the legacy `POST /custody/scan`, whose repeats are found by the same-move test only. */
  scanId: string | null;
  code: string;
  entryMethod: EntryMethod;
  /** TAKE_BACK only: the state the driver tapped. */
  returnState?: ReturnState;
  lat?: number;
  lng?: number;
}

/** `POST /store/scans` once the body is checked: the shop's RECEIVE. */
export interface StoreScanCommand {
  scanId: string;
  code: string;
  entryMethod: EntryMethod;
}

/**
 * How a scan was answered: RECORDED (201, a new move), REPLAY (200 `Idempotent-Replay`: the same scan id
 * again) or ALREADY (200 `X-Already-Applied`: the same move under a new scan id). The last two write nothing.
 */
export type ScanAnswerKind = 'RECORDED' | 'REPLAY' | 'ALREADY';

export interface ScanAnswer<T extends ScanResult = ScanResult> {
  kind: ScanAnswerKind;
  result: T;
  /** The recorded move (new, or the original one a repeat points at); null when there is none. */
  event: CylinderEvent | null;
}

/** The route answer of a scan: 201 body, or a 200 with its header. */
export function scanResponse<T>(answer: { kind: ScanAnswerKind; result: T }): T | IdempotentResponse<T> {
  if (answer.kind === 'REPLAY') return replayed(answer.result);
  if (answer.kind === 'ALREADY') return alreadyApplied(answer.result);
  return answer.result;
}

/** A cylinder named by the office's manual delivery v2, as sent. */
export interface ManualCode {
  code: string;
}

/** One cylinder an office manual delivery moved (for its `custody.manual_event` audit row). */
export interface ManualMove {
  cylinderId: string;
  code: string;
  eventId: string;
  from: { type: CustodyType; id: string; label: string };
  to: { type: CustodyType; id: string; label: string };
  direction: 'GIVEN' | 'TAKEN_BACK';
}

interface RunTrip {
  id: string;
  status: TripStatus;
  driver_id: string;
  vehicle_id: string;
  origin_store_id: string;
}

interface RunStop {
  id: string;
  trip_id: string;
  order_id: string | null;
  stop_type: TripStopType;
  status: TripStopStatus;
}

interface RunDistributor {
  id: string;
  code: string;
  homeStoreId: string;
  storeName: string;
}

interface RunOrder {
  id: string;
  clientId: string;
  distributorId: string;
  lines: { cylinderTypeId: string; fullCount: number }[];
}

interface RunContext {
  trip: RunTrip;
  stop: RunStop;
  distributor: RunDistributor;
  order: RunOrder | null;
}

interface LockedCylinder {
  id: string;
  distributor_id: string;
  cylinder_type_id: string;
  state: CylinderState;
  custody_type: CustodyType;
  custody_id: string;
  last_event_id: string | null;
  qr_code: string;
  short_no: number | null;
}

interface PlannedMove {
  eventType: CylinderEventType;
  to: { type: CustodyType; id: string };
  newState: CylinderState;
  stopRow?: { direction: StopCylinderDirection; orderId: string; returnState: CylinderState | null };
  orderId: string | null;
}

const BLOCKED: CylinderState[] = [CylinderState.FAULTY, CylinderState.LOST];
const OPEN_TRIP: TripStatus[] = [TripStatus.PLANNED, TripStatus.IN_PROGRESS];
const OPEN_STOP: TripStopStatus[] = [TripStopStatus.PENDING, TripStopStatus.ARRIVED];
const SCAN_ID_KEY = 'cylinder_events_actor_user_id_client_scan_id_key';

/** The action a recorded event stands for (§5.9: each action is one event code). */
export function actionOfEvent(event: Pick<CylinderEvent, 'eventType' | 'source' | 'tripId'> & { fillingOrderId?: string | null }): ScanAction | null {
  switch (event.eventType) {
    case CylinderEventType.SCAN_OUT:
      // [Inc 3] A refill pickup is a SCAN_OUT with the refill and no trip.
      return event.fillingOrderId && !event.tripId ? 'REFILL_PICKUP' : 'LOAD';
    case CylinderEventType.FILLED:
      return 'REFILL_FILL';
    case CylinderEventType.DELIVERED:
      return event.source === CylinderEventSource.MANUAL ? 'OFFICE_MANUAL_DELIVERY' : 'HANDOVER';
    case CylinderEventType.PICKED_UP_EMPTY:
      return event.source === CylinderEventSource.MANUAL ? 'OFFICE_MANUAL_DELIVERY' : 'TAKE_BACK';
    case CylinderEventType.SCAN_IN:
      return 'STORE_RECEIVE';
    case CylinderEventType.REGISTERED:
      return 'REGISTER';
    default:
      return null;
  }
}

/**
 * The scan service (API_CONTRACT §5.9, §9.2): every holder change is one move, recorded as one
 * `cylinder_events` row, and every cylinder has exactly one holder (a store, a van or a customer). The
 * destination is always derived here, never taken from a body. Each scan runs the §9.2 steps in their
 * order, in one transaction, locking rows orders first, then the trip, then the stop, then the
 * cylinder. Nothing here moves money: the first LOAD only marks delivery as started.
 */
@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------- driver scans: LOAD, HANDOVER, TAKE_BACK ----------

  /**
   * `POST /trips/:tripId/scans` and the legacy `POST /custody/scan`: the trip's driver at one of its
   * stops. A twin request with the same scan id that commits first is answered as its replay.
   */
  async driverScan(actor: UserActor, cmd: DriverScanCommand): Promise<ScanAnswer> {
    const driverId = ownDriverId(actor);
    const run = () => this.prisma.$transaction((tx) => this.driverScanTx(tx, actor, driverId, cmd), LOCKING_TX);
    try {
      return await run();
    } catch (error) {
      if (cmd.scanId && isUniqueViolation(error, SCAN_ID_KEY)) return run();
      throw error;
    }
  }

  private async driverScanTx(tx: Tx, actor: UserActor, driverId: string, cmd: DriverScanCommand): Promise<ScanAnswer> {
    // 1. Context and ownership: the trip is the caller's and the stop is one of its stops (404).
    const ctx = await this.loadRun(tx, driverId, cmd.tripId, cmd.stopId);

    // 2. A resend with the same scan id returns the recorded scan, whatever the rules say now.
    if (cmd.scanId) {
      const resend = await this.driverResend(tx, actor, cmd, ctx);
      if (resend) return resend;
    }

    // 3. Locks (orders, then the trip, then the stop), then the trip, the stop and the action's fit.
    if (cmd.action === 'LOAD') await lockTripOrders(tx, ctx.trip.id);
    else if (ctx.stop.order_id) await lockOrder(tx, ctx.stop.order_id);
    ctx.trip = await this.lockTrip(tx, ctx.trip.id);
    ctx.stop = await this.lockStop(tx, ctx.stop.id);
    if (!OPEN_TRIP.includes(ctx.trip.status)) throw await this.refusal(tx, ctx, 'SCAN_TRIP_CLOSED');
    if (!OPEN_STOP.includes(ctx.stop.status)) throw await this.refusal(tx, ctx, 'SCAN_STOP_CLOSED', { currentStatus: ctx.stop.status });
    const fits = cmd.action === 'LOAD' ? ctx.stop.stop_type === TripStopType.STORE_PICKUP : ctx.stop.stop_type === TripStopType.DELIVERY && !!ctx.order;
    if (!fits) throw await this.refusal(tx, ctx, 'SCAN_EVENT_NOT_ALLOWED');

    // 4. A typed number while typing is switched off, before any lookup.
    await this.assertTypedAllowed(cmd.entryMethod);

    // 5. Resolve the code: QR exactly, whoever owns it; a typed number within the run's distributor.
    const cylinderId = await resolveScanCode(tx, { code: cmd.code, entryMethod: cmd.entryMethod, distributor: ctx.distributor });
    if (!cylinderId) throw await this.refusal(tx, ctx, 'SCAN_CYLINDER_UNKNOWN');

    // 6. Lock the cylinder. A twin with the same scan id may have committed while this one waited.
    const cylinder = await this.lockCylinder(tx, cylinderId);
    if (cmd.scanId) {
      const resend = await this.driverResend(tx, actor, cmd, ctx);
      if (resend) return resend;
    }

    // 7. Owner: the run's distributor.
    if (cylinder.distributor_id !== ctx.distributor.id) throw await this.refusal(tx, ctx, 'SCAN_WRONG_OWNER');

    // 8. The same move again under a new scan id: answered, nothing written.
    const repeat = await this.sameDriverMove(tx, cmd.action, ctx, cylinder);
    if (repeat) return this.driverAnswer(tx, 'ALREADY', ctx, cylinder.id, repeat, cmd.action);

    // 9. Damaged or lost: never loaded or handed over (taken back as they are).
    if (BLOCKED.includes(cylinder.state) && cmd.action !== 'TAKE_BACK') throw await this.refusal(tx, ctx, 'SCAN_CYLINDER_BLOCKED');

    // 10. The action's own rules.
    const move = await this.driverRules(tx, cmd, ctx, cylinder);

    // 11. Write the move, the stop row and the stop's and trip's first-scan stamps.
    const event = await this.writeMove(tx, {
      cylinder,
      move,
      actorUserId: actor.userId,
      source: cmd.entryMethod === 'TYPED' ? CylinderEventSource.TYPED : CylinderEventSource.SCAN,
      reason: null,
      clientScanId: cmd.scanId,
      tripId: ctx.trip.id,
      tripStopId: ctx.stop.id,
      lat: cmd.lat,
      lng: cmd.lng,
    });
    await tx.$executeRaw`
      UPDATE trip_stops SET status = 'ARRIVED', arrived_at = COALESCE(arrived_at, (now() AT TIME ZONE 'UTC'))
      WHERE id = ${ctx.stop.id}::uuid AND status = 'PENDING'`;
    ctx.stop = { ...ctx.stop, status: ctx.stop.status === TripStopStatus.PENDING ? TripStopStatus.ARRIVED : ctx.stop.status };
    await autoStartTrip(tx, ctx.trip.id);
    // The first LOAD stamps load_started_at on every open order of the trip (under the step 3 locks).
    if (cmd.action === 'LOAD') await stampLoadStarted(tx, ctx.trip.id);
    if (cmd.entryMethod === 'TYPED') await this.auditTyped(tx, actor, cylinder, ctx.distributor.code, cmd.code, cmd.action, event.id, ctx.trip.id);
    return this.driverAnswer(tx, 'RECORDED', ctx, cylinder.id, event, cmd.action);
  }

  /** §9.2 step 2 for a driver scan: the recorded scan, or 409 SCAN_ID_REUSED for another cylinder, action or stop. */
  private async driverResend(tx: Tx, actor: UserActor, cmd: DriverScanCommand, ctx: RunContext): Promise<ScanAnswer | null> {
    const prior = await this.priorScan(tx, actor.userId, cmd.scanId as string);
    if (!prior) return null;
    const named = await resolveScanCode(tx, { code: cmd.code, entryMethod: cmd.entryMethod, distributor: ctx.distributor });
    if (named !== prior.cylinderId || actionOfEvent(prior) !== cmd.action || prior.tripStopId !== ctx.stop.id) {
      throw await this.refusal(tx, ctx, 'SCAN_ID_REUSED');
    }
    return this.driverAnswer(tx, 'REPLAY', ctx, prior.cylinderId, prior, cmd.action);
  }

  /** §9.2 step 8 for a driver scan: the move this scan would make is already recorded. Returns its event. */
  private async sameDriverMove(tx: Tx, action: DriverScanAction, ctx: RunContext, cylinder: LockedCylinder): Promise<CylinderEvent | null> {
    if (action === 'LOAD') {
      if (cylinder.custody_type !== CustodyType.VEHICLE || cylinder.custody_id !== ctx.trip.vehicle_id || !cylinder.last_event_id) return null;
      const last = await tx.cylinderEvent.findUnique({ where: { id: cylinder.last_event_id } });
      return last && last.eventType === CylinderEventType.SCAN_OUT && last.tripId === ctx.trip.id ? last : null;
    }
    const direction = action === 'HANDOVER' ? StopCylinderDirection.GIVEN : StopCylinderDirection.TAKEN_BACK;
    const row = await tx.stopCylinder.findUnique({
      where: { tripStopId_cylinderId: { tripStopId: ctx.stop.id, cylinderId: cylinder.id } },
      select: { direction: true, event: true },
    });
    return row && row.direction === direction ? row.event : null;
  }

  /** §9.2 step 10: each driver action's own rules, in the order its row lists them. */
  private async driverRules(tx: Tx, cmd: DriverScanCommand, ctx: RunContext, cylinder: LockedCylinder): Promise<PlannedMove> {
    switch (cmd.action) {
      case 'LOAD': {
        if (cylinder.custody_type !== CustodyType.STORE || cylinder.custody_id !== ctx.trip.origin_store_id) {
          throw await this.refusal(tx, ctx, 'SCAN_NOT_AT_STORE', { store: ctx.distributor.storeName });
        }
        if (cylinder.state !== CylinderState.FULL) throw await this.refusal(tx, ctx, 'SCAN_NOT_FULL');
        const loads = await pickupProgress(tx, this.progressTrip(ctx));
        const line = loads.lines.find((l) => l.cylinderTypeId === cylinder.cylinder_type_id);
        if (!line || line.done >= line.needed) throw await this.refusal(tx, ctx, 'SCAN_LOAD_NOT_NEEDED');
        return { eventType: CylinderEventType.SCAN_OUT, to: { type: CustodyType.VEHICLE, id: ctx.trip.vehicle_id }, newState: cylinder.state, orderId: null };
      }
      case 'HANDOVER': {
        const order = ctx.order as RunOrder;
        const onTripVan = cylinder.custody_type === CustodyType.VEHICLE && cylinder.custody_id === ctx.trip.vehicle_id;
        const last = cylinder.last_event_id ? await tx.cylinderEvent.findUnique({ where: { id: cylinder.last_event_id } }) : null;
        // A taken-back cylinder goes to the store first: never straight to another customer.
        if (onTripVan && last?.eventType === CylinderEventType.PICKED_UP_EMPTY) throw await this.refusal(tx, ctx, 'SCAN_TAKEN_BACK_NOT_UNLOADED');
        // No IN, no OUT: only a cylinder loaded on this run, still on this run's van.
        if (!onTripVan || !last || last.eventType !== CylinderEventType.SCAN_OUT || last.tripId !== ctx.trip.id) {
          throw await this.refusal(tx, ctx, 'SCAN_NOT_ON_YOUR_VAN');
        }
        if (cylinder.state !== CylinderState.FULL) throw await this.refusal(tx, ctx, 'SCAN_NOT_FULL');
        const sizeLabel = (await sizeLabels(tx, [cylinder.cylinder_type_id])).get(cylinder.cylinder_type_id)?.label ?? '';
        const line = order.lines.find((l) => l.cylinderTypeId === cylinder.cylinder_type_id);
        if (!line) throw await this.refusal(tx, ctx, 'SCAN_SIZE_NOT_IN_ORDER', { sizeLabel });
        const given = await tx.stopCylinder.count({
          where: { tripStopId: ctx.stop.id, direction: StopCylinderDirection.GIVEN, cylinderTypeId: cylinder.cylinder_type_id },
        });
        if (given >= line.fullCount) throw await this.refusal(tx, ctx, 'SCAN_COUNT_REACHED', { needed: line.fullCount, sizeLabel });
        // A handed-over cylinder stays FULL: it is the customer's full cylinder now.
        return {
          eventType: CylinderEventType.DELIVERED,
          to: { type: CustodyType.CLIENT, id: order.clientId },
          newState: CylinderState.FULL,
          orderId: order.id,
          stopRow: { direction: StopCylinderDirection.GIVEN, orderId: order.id, returnState: null },
        };
      }
      case 'TAKE_BACK': {
        const order = ctx.order as RunOrder;
        if (cylinder.custody_type !== CustodyType.CLIENT || cylinder.custody_id !== order.clientId) {
          throw await this.refusal(tx, ctx, 'SCAN_NOT_WITH_THIS_CUSTOMER');
        }
        const givenHere = await tx.stopCylinder.findUnique({
          where: { tripStopId_cylinderId: { tripStopId: ctx.stop.id, cylinderId: cylinder.id } },
          select: { direction: true },
        });
        if (givenHere?.direction === StopCylinderDirection.GIVEN) throw await this.refusal(tx, ctx, 'SCAN_GIVEN_THIS_VISIT');
        const tapped = (cmd.returnState ?? 'EMPTY') as CylinderState;
        return {
          eventType: CylinderEventType.PICKED_UP_EMPTY,
          to: { type: CustodyType.VEHICLE, id: ctx.trip.vehicle_id },
          // The tap becomes the state; a damaged or lost cylinder keeps its own.
          newState: BLOCKED.includes(cylinder.state) ? cylinder.state : tapped,
          orderId: order.id,
          stopRow: { direction: StopCylinderDirection.TAKEN_BACK, orderId: order.id, returnState: tapped },
        };
      }
    }
  }

  private async driverAnswer(
    tx: Tx,
    kind: ScanAnswerKind,
    ctx: RunContext,
    cylinderId: string,
    event: CylinderEvent | null,
    action: ScanAction,
  ): Promise<ScanAnswer> {
    const [cylinder, progress] = await Promise.all([scannedCylinder(tx, cylinderId), this.progressOf(tx, ctx)]);
    return {
      kind,
      event,
      result: {
        result: kind === 'RECORDED' ? 'RECORDED' : 'ALREADY_RECORDED',
        scan: { scanId: event?.clientScanId ?? null, action, at: (event?.createdAt ?? new Date()).toISOString() },
        cylinder,
        stop: { id: ctx.stop.id, type: ctx.stop.stop_type, progress: progress as StopProgress },
      },
    };
  }

  // ---------- the store's receive: STORE_RECEIVE ----------

  /**
   * `POST /store/scans` (the distributor's shop app): VEHICLE (any van) → the caller's one store, state
   * unchanged (FAULTY and LOST included). No body field can name a store (ADR-13). [Inc 3] A cylinder on an
   * open refill line comes back for its refill (API_CONTRACT §10.1): the receive carries the refill, the
   * cylinder is FULL when its line was filled, the line is RETURNED, and the last one back completes the
   * refill in this transaction (refill-receive.ts; audit `refill.complete`, SYSTEM). No money.
   */
  async storeScan(actor: UserActor, cmd: StoreScanCommand): Promise<ScanAnswer<StoreScanResult>> {
    const distributorId = ownDistributorId(actor);
    const run = () => this.prisma.$transaction((tx) => this.storeScanTx(tx, actor, distributorId, cmd), LOCKING_TX);
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error, SCAN_ID_KEY)) return run();
      throw error;
    }
  }

  private async storeScanTx(tx: Tx, actor: UserActor, distributorId: string, cmd: StoreScanCommand): Promise<ScanAnswer<StoreScanResult>> {
    // 1. The caller's own store.
    const distributor = await this.distributorOf(tx, distributorId);

    // 2. A resend.
    const resend = await this.storeResend(tx, actor, cmd, distributor);
    if (resend) return resend;

    // 4. A typed number while typing is off.
    await this.assertTypedAllowed(cmd.entryMethod);

    // 5. Resolve: QR exactly, or a typed number within the caller's cylinders.
    const cylinderId = await resolveScanCode(tx, { code: cmd.code, entryMethod: cmd.entryMethod, distributor });
    if (!cylinderId) throw new AppError('SCAN_CYLINDER_UNKNOWN');

    // 6. Lock it (two phones receiving one cylinder: the second finds it in the store).
    const cylinder = await this.lockCylinder(tx, cylinderId);
    const twin = await this.storeResend(tx, actor, cmd, distributor);
    if (twin) return twin;

    // 7. Only the owner receives its cylinders.
    if (cylinder.distributor_id !== distributor.id) throw new AppError('SCAN_WRONG_OWNER');

    // 8. Already in the caller's store: a soft answer.
    if (cylinder.custody_type === CustodyType.STORE && cylinder.custody_id === distributor.homeStoreId) {
      const last = cylinder.last_event_id ? await tx.cylinderEvent.findUnique({ where: { id: cylinder.last_event_id } }) : null;
      return this.storeAnswer(tx, 'ALREADY', distributor, cylinder.id, last && last.eventType === CylinderEventType.SCAN_IN ? last : null, last);
    }

    // 10. Only a cylinder on a van comes back through the store's scan.
    if (cylinder.custody_type !== CustodyType.VEHICLE) throw new AppError('SCAN_NOT_ON_A_VAN');

    // [Inc 3] A cylinder on an open refill line comes back for its refill (locks the refill row).
    const refill = await planRefillReceive(tx, cylinder);

    // 11. Write it: the state stays as it is, except a filled refill cylinder, which comes back FULL.
    const event = await this.writeMove(tx, {
      cylinder,
      move: {
        eventType: CylinderEventType.SCAN_IN,
        to: { type: CustodyType.STORE, id: distributor.homeStoreId },
        newState: refill?.toState ?? cylinder.state,
        orderId: null,
      },
      actorUserId: actor.userId,
      source: cmd.entryMethod === 'TYPED' ? CylinderEventSource.TYPED : CylinderEventSource.SCAN,
      reason: null,
      clientScanId: cmd.scanId,
      tripId: null,
      tripStopId: null,
      fillingOrderId: refill?.fillingOrderId ?? null,
    });
    if (refill) await finishRefillReceive(tx, this.audit, refill, { eventId: event.id, receivedByUserId: actor.userId, at: event.createdAt });
    if (cmd.entryMethod === 'TYPED') await this.auditTyped(tx, actor, cylinder, distributor.code, cmd.code, 'STORE_RECEIVE', event.id, null);
    return this.storeAnswer(tx, 'RECORDED', distributor, cylinder.id, event, event);
  }

  private async storeResend(tx: Tx, actor: UserActor, cmd: StoreScanCommand, distributor: RunDistributor): Promise<ScanAnswer<StoreScanResult> | null> {
    const prior = await this.priorScan(tx, actor.userId, cmd.scanId);
    if (!prior) return null;
    const named = await resolveScanCode(tx, { code: cmd.code, entryMethod: cmd.entryMethod, distributor });
    if (named !== prior.cylinderId || actionOfEvent(prior) !== 'STORE_RECEIVE') throw new AppError('SCAN_ID_REUSED');
    return this.storeAnswer(tx, 'REPLAY', distributor, prior.cylinderId, prior, prior);
  }

  /**
   * The store's scan answer: the cylinder as it is now, the van it came off (`fromVan`, from the receive
   * event: its plate and the driver who brought it), and what the store received today.
   */
  private async storeAnswer(
    tx: Tx,
    kind: ScanAnswerKind,
    distributor: RunDistributor,
    cylinderId: string,
    receive: CylinderEvent | null,
    shown: CylinderEvent | null,
  ): Promise<ScanAnswer<StoreScanResult>> {
    const [cylinder, fromVan, receivedToday] = await Promise.all([
      scannedCylinder(tx, cylinderId),
      receive ? this.fromVanOf(tx, receive) : Promise.resolve(null),
      this.receivedToday(tx, distributor),
    ]);
    return {
      kind,
      event: receive,
      result: {
        result: kind === 'RECORDED' ? 'RECORDED' : 'ALREADY_RECORDED',
        scan: { scanId: receive?.clientScanId ?? null, action: 'STORE_RECEIVE', at: (shown?.createdAt ?? new Date()).toISOString() },
        cylinder,
        stop: null,
        fromVan,
        receivedToday,
      },
    };
  }

  /** The van a receive came off and the driver who brought it: the driver of the newest move onto that van before it. */
  private async fromVanOf(tx: Tx, receive: CylinderEvent): Promise<StoreScanResult['fromVan']> {
    if (receive.fromCustodyType !== CustodyType.VEHICLE || !receive.fromCustodyId) return null;
    const van = await tx.vehicle.findUnique({ where: { id: receive.fromCustodyId }, select: { plateNo: true } });
    if (!van) return null;
    const onto = await tx.cylinderEvent.findFirst({
      where: {
        cylinderId: receive.cylinderId,
        toCustodyType: CustodyType.VEHICLE,
        toCustodyId: receive.fromCustodyId,
        createdAt: { lte: receive.createdAt },
        id: { not: receive.id },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { tripId: true },
    });
    let driver: { id: string; name: string } | null = null;
    if (onto?.tripId) {
      const trip = await tx.trip.findUnique({ where: { id: onto.tripId }, select: { driver: { select: { id: true, user: { select: { name: true } } } } } });
      if (trip) driver = { id: trip.driver.id, name: trip.driver.user.name };
    }
    if (!driver) {
      const current = await tx.driver.findFirst({ where: { currentVehicleId: receive.fromCustodyId }, select: { id: true, user: { select: { name: true } } } });
      if (current) driver = { id: current.id, name: current.user.name };
    }
    return { plateNo: van.plateNo, driver };
  }

  /** The receives into the caller's store in the current business day, by size. */
  private async receivedToday(tx: Tx, distributor: RunDistributor): Promise<StoreScanResult['receivedToday']> {
    const today = await currentBusinessDays(this.settings);
    const events = await tx.cylinderEvent.findMany({
      where: {
        eventType: CylinderEventType.SCAN_IN,
        toCustodyType: CustodyType.STORE,
        toCustodyId: distributor.homeStoreId,
        createdAt: { gte: today.start, lt: today.end },
        cylinder: { distributorId: distributor.id },
      },
      select: { cylinder: { select: { cylinderTypeId: true } } },
    });
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.cylinder.cylinderTypeId, (counts.get(event.cylinder.cylinderTypeId) ?? 0) + 1);
    const sizes = await sizeLabels(tx, [...counts.keys()]);
    const bySize: SizeCount[] = [...counts.entries()]
      .map(([typeId, count]) => ({ cylinderTypeId: typeId, sizeLabel: sizes.get(typeId)?.label ?? '', count }))
      .sort((a, b) => (sizes.get(a.cylinderTypeId)?.weightKg ?? 0) - (sizes.get(b.cylinderTypeId)?.weightKg ?? 0));
    return { count: events.length, bySize };
  }

  // ---------- the office's manual delivery v2: OFFICE_MANUAL_DELIVERY ----------

  /**
   * `POST /orders/:id/manual-delivery` v2 (API_CONTRACT §9.5), inside the order's transaction after its
   * status checks: every code resolves (404 SCAN_CYLINDER_UNKNOWN `{code}`), the cylinders are locked in
   * id order, then everything must fit, else 409 MANUAL_DELIVERY_CYLINDERS_MISMATCH `{problems, sizes}`
   * and nothing moves. Each delivered cylinder goes to the customer (DELIVERED, source MANUAL, a GIVEN
   * row), each taken-back one onto the order's trip van (PICKED_UP_EMPTY, source MANUAL, a TAKEN_BACK
   * row). A cylinder the driver already gave or took back on this visit counts as named and doesn't move
   * again. No money.
   */
  async officeManualDelivery(
    tx: Tx,
    actor: UserActor,
    p: {
      order: RunOrder;
      distributor: { id: string; code: string; homeStoreId: string };
      trip: { id: string; vehicleId: string };
      stopId: string;
      reason: string;
      cylinders: ManualCode[];
      takenBack: (ManualCode & { returnState: ReturnState })[];
    },
  ): Promise<ManualMove[]> {
    const context = { id: p.distributor.id, code: p.distributor.code };
    const named: Array<{ code: string; cylinderId: string; list: 'GIVEN' | 'TAKEN_BACK'; returnState: ReturnState | null }> = [];
    for (const item of p.cylinders) {
      const cylinderId = await resolveQrOrNumber(tx, item.code, context);
      if (!cylinderId) throw new AppError('SCAN_CYLINDER_UNKNOWN', { code: item.code });
      named.push({ code: item.code, cylinderId, list: 'GIVEN', returnState: null });
    }
    for (const item of p.takenBack) {
      const cylinderId = await resolveQrOrNumber(tx, item.code, context);
      if (!cylinderId) throw new AppError('SCAN_CYLINDER_UNKNOWN', { code: item.code });
      named.push({ code: item.code, cylinderId, list: 'TAKEN_BACK', returnState: item.returnState });
    }

    const ids = [...new Set(named.map((n) => n.cylinderId))].sort();
    const locked = new Map<string, LockedCylinder>();
    for (const id of ids) locked.set(id, await this.lockCylinder(tx, id));
    const stopRows = await tx.stopCylinder.findMany({ where: { tripStopId: p.stopId }, select: { cylinderId: true, direction: true } });
    const onThisVisit = new Map(stopRows.map((row) => [row.cylinderId, row.direction]));

    const problems: Array<{ code: string; reason: ManualDeliveryProblemReason; holderType?: 'VEHICLE' | 'CLIENT' }> = [];
    const seen = new Set<string>();
    const deliverable: typeof named = [];
    const returnable: typeof named = [];
    const namedBySize = new Map<string, number>();
    for (const item of named) {
      const cylinder = locked.get(item.cylinderId) as LockedCylinder;
      if (seen.has(item.cylinderId)) {
        problems.push({ code: item.code, reason: 'LISTED_TWICE' });
        continue;
      }
      seen.add(item.cylinderId);
      if (item.list === 'GIVEN') {
        if (p.order.lines.some((l) => l.cylinderTypeId === cylinder.cylinder_type_id)) {
          namedBySize.set(cylinder.cylinder_type_id, (namedBySize.get(cylinder.cylinder_type_id) ?? 0) + 1);
        }
        const problem = await this.manualGiveProblem(tx, cylinder, p, onThisVisit.get(cylinder.id));
        if (problem) problems.push({ code: item.code, ...problem });
        else deliverable.push(item);
      } else {
        const problem = this.manualTakeBackProblem(cylinder, p, onThisVisit.get(cylinder.id));
        if (problem) problems.push({ code: item.code, ...problem });
        else returnable.push(item);
      }
    }
    const sizeWords = await sizeLabels(tx, p.order.lines.map((l) => l.cylinderTypeId));
    const sizes = p.order.lines.map((line) => ({
      cylinderTypeId: line.cylinderTypeId,
      sizeLabel: sizeWords.get(line.cylinderTypeId)?.label ?? '',
      needed: line.fullCount,
      named: namedBySize.get(line.cylinderTypeId) ?? 0,
    }));
    if (problems.length > 0 || sizes.some((size) => size.named !== size.needed)) {
      throw new AppError('MANUAL_DELIVERY_CYLINDERS_MISMATCH', { problems, sizes });
    }

    const moves: ManualMove[] = [];
    for (const item of [...deliverable, ...returnable]) {
      const cylinder = locked.get(item.cylinderId) as LockedCylinder;
      if (onThisVisit.has(cylinder.id)) continue; // the driver already recorded it on this visit
      const give = item.list === 'GIVEN';
      const tapped = (item.returnState ?? 'EMPTY') as CylinderState;
      const move: PlannedMove = give
        ? {
            eventType: CylinderEventType.DELIVERED,
            to: { type: CustodyType.CLIENT, id: p.order.clientId },
            newState: CylinderState.FULL,
            orderId: p.order.id,
            stopRow: { direction: StopCylinderDirection.GIVEN, orderId: p.order.id, returnState: null },
          }
        : {
            eventType: CylinderEventType.PICKED_UP_EMPTY,
            to: { type: CustodyType.VEHICLE, id: p.trip.vehicleId },
            newState: BLOCKED.includes(cylinder.state) ? cylinder.state : tapped,
            orderId: p.order.id,
            stopRow: { direction: StopCylinderDirection.TAKEN_BACK, orderId: p.order.id, returnState: tapped },
          };
      const event = await this.writeMove(tx, {
        cylinder,
        move,
        actorUserId: actor.userId,
        source: CylinderEventSource.MANUAL,
        reason: p.reason,
        clientScanId: null,
        tripId: p.trip.id,
        tripStopId: p.stopId,
      });
      const from = { type: cylinder.custody_type, id: cylinder.custody_id };
      moves.push({
        cylinderId: cylinder.id,
        code: item.code,
        eventId: event.id,
        from: { ...from, label: await holderLabel(tx, from) },
        to: { ...move.to, label: await holderLabel(tx, move.to) },
        direction: give ? 'GIVEN' : 'TAKEN_BACK',
      });
    }
    return moves;
  }

  /** Why a cylinder named as delivered can't go: the §9.5 rules, first that fails. */
  private async manualGiveProblem(
    tx: Tx,
    cylinder: LockedCylinder,
    p: { order: RunOrder; distributor: { homeStoreId: string }; trip: { id: string; vehicleId: string } },
    onThisVisit: StopCylinderDirection | undefined,
  ): Promise<{ reason: ManualDeliveryProblemReason; holderType?: 'VEHICLE' | 'CLIENT' } | null> {
    if (cylinder.distributor_id !== p.order.distributorId) return { reason: 'WRONG_OWNER' };
    if (BLOCKED.includes(cylinder.state)) return { reason: 'BLOCKED' };
    if (cylinder.state !== CylinderState.FULL) return { reason: 'NOT_FULL' };
    if (!p.order.lines.some((l) => l.cylinderTypeId === cylinder.cylinder_type_id)) return { reason: 'WRONG_SIZE' };
    if (onThisVisit === StopCylinderDirection.GIVEN) return null; // given by scan on this visit already
    if (onThisVisit === StopCylinderDirection.TAKEN_BACK) return { reason: 'LISTED_TWICE' };
    if (cylinder.custody_type === CustodyType.STORE && cylinder.custody_id === p.distributor.homeStoreId) return null;
    if (cylinder.custody_type === CustodyType.VEHICLE && cylinder.custody_id === p.trip.vehicleId && cylinder.last_event_id) {
      const last = await tx.cylinderEvent.findUnique({ where: { id: cylinder.last_event_id }, select: { eventType: true, tripId: true } });
      if (last?.eventType === CylinderEventType.SCAN_OUT && last.tripId === p.trip.id) return null;
    }
    if (cylinder.custody_type === CustodyType.CLIENT) return { reason: 'NOT_AVAILABLE', holderType: 'CLIENT' };
    if (cylinder.custody_type === CustodyType.VEHICLE) return { reason: 'NOT_AVAILABLE', holderType: 'VEHICLE' };
    return { reason: 'NOT_AVAILABLE' };
  }

  /** Why a cylinder named as taken back can't come: the owner, and with this order's customer. */
  private manualTakeBackProblem(
    cylinder: LockedCylinder,
    p: { order: RunOrder },
    onThisVisit: StopCylinderDirection | undefined,
  ): { reason: ManualDeliveryProblemReason } | null {
    if (cylinder.distributor_id !== p.order.distributorId) return { reason: 'WRONG_OWNER' };
    if (onThisVisit === StopCylinderDirection.TAKEN_BACK) return null; // taken back by scan on this visit already
    if (onThisVisit === StopCylinderDirection.GIVEN) return { reason: 'LISTED_TWICE' }; // given on this visit: can't come back on it
    if (cylinder.custody_type !== CustodyType.CLIENT || cylinder.custody_id !== p.order.clientId) return { reason: 'NOT_WITH_THIS_CUSTOMER' };
    return null;
  }

  // ---------- registration: REGISTER ----------

  /**
   * Bulk registration (API_CONTRACT §9.5): one REGISTERED event per new cylinder (source REGISTRATION,
   * actor the office user, none → the home store) as its first and last move. Runs in the registration's
   * transaction, right after the cylinders are inserted.
   */
  async registerMoves(tx: Tx, p: { actorUserId: string; storeId: string; cylinderIds: readonly string[] }): Promise<void> {
    if (p.cylinderIds.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO cylinder_events (id, cylinder_id, event_type, source, to_custody_type, to_custody_id, to_state, actor_user_id, created_at)
      SELECT gen_random_uuid(), c.id, 'REGISTERED', 'REGISTRATION', 'STORE', ${p.storeId}::uuid, c.state, ${p.actorUserId}::uuid,
             (now() AT TIME ZONE 'UTC')
      FROM cylinders c WHERE c.id = ANY(${[...p.cylinderIds]}::uuid[])`;
    await tx.$executeRaw`
      UPDATE cylinders c SET last_event_id = e.id
      FROM cylinder_events e
      WHERE e.cylinder_id = c.id AND e.event_type = 'REGISTERED' AND c.id = ANY(${[...p.cylinderIds]}::uuid[])`;
  }

  // ---------- shared pieces ----------

  /** The progress of a run's stop, as it is now in this transaction. */
  async progressFor(tx: Tx, trip: { id: string; vehicleId: string; status: string }, stop: ProgressStop): Promise<StopProgress | null> {
    return stopProgress(tx, trip, stop);
  }

  private progressTrip(ctx: RunContext): ProgressTrip {
    return { id: ctx.trip.id, vehicleId: ctx.trip.vehicle_id, status: ctx.trip.status };
  }

  private progressOf(tx: Tx, ctx: RunContext): Promise<StopProgress | null> {
    return stopProgress(tx, this.progressTrip(ctx), { id: ctx.stop.id, type: ctx.stop.stop_type, status: ctx.stop.status, orderId: ctx.stop.order_id });
  }

  /** A scan refusal with the stop's progress (§9.3: the screen still shows "3 of 5" after one). */
  private async refusal(tx: Tx, ctx: RunContext, code: ErrorCode, details: Record<string, unknown> = {}): Promise<AppError> {
    const progress = await this.progressOf(tx, ctx);
    return new (AppError as unknown as new (code: ErrorCode, details: Record<string, unknown>) => AppError)(code, {
      ...details,
      ...(progress ? { progress } : {}),
    });
  }

  private async assertTypedAllowed(entryMethod: EntryMethod): Promise<void> {
    if (entryMethod === 'TYPED' && !(await this.settings.get('custody.typedEntry.enabled'))) throw new AppError('FEATURE_DISABLED');
  }

  private priorScan(tx: Tx, actorUserId: string, scanId: string): Promise<CylinderEvent | null> {
    return tx.cylinderEvent.findUnique({ where: { actorUserId_clientScanId: { actorUserId, clientScanId: scanId } } });
  }

  /** Step 1 of a driver scan: the caller's trip and one of its stops, else 404 (the same for any unknown id). */
  private async loadRun(tx: Tx, driverId: string, tripId: string, stopId: string): Promise<RunContext> {
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      select: { id: true, status: true, driverId: true, vehicleId: true, originStoreId: true },
    });
    if (!trip || trip.driverId !== driverId) throw new AppError('NOT_FOUND');
    const stop = await tx.tripStop.findUnique({ where: { id: stopId }, select: { id: true, tripId: true, orderId: true, stopType: true, status: true } });
    if (!stop || stop.tripId !== trip.id) throw new AppError('NOT_FOUND');
    const distributor = await this.runDistributor(tx, trip.id, trip.originStoreId);
    let order: RunOrder | null = null;
    if (stop.stopType === TripStopType.DELIVERY && stop.orderId) {
      const row = await tx.order.findUnique({
        where: { id: stop.orderId },
        select: { id: true, clientId: true, distributorId: true, lines: { select: { cylinderTypeId: true, fullCount: true } } },
      });
      if (row) order = { id: row.id, clientId: row.clientId, distributorId: row.distributorId, lines: row.lines };
    }
    return {
      trip: { id: trip.id, status: trip.status, driver_id: trip.driverId, vehicle_id: trip.vehicleId, origin_store_id: trip.originStoreId },
      stop: { id: stop.id, trip_id: stop.tripId, order_id: stop.orderId, stop_type: stop.stopType, status: stop.status },
      distributor,
      order,
    };
  }

  /** The run's distributor: the one whose store the trip starts at (each run carries one distributor's orders). */
  private async runDistributor(tx: Tx, tripId: string, storeId: string): Promise<RunDistributor> {
    const owner = await tx.distributor.findUnique({ where: { homeStoreId: storeId }, select: { id: true } });
    const id = owner?.id ?? (await tx.order.findFirst({ where: { tripId }, select: { distributorId: true } }))?.distributorId;
    if (!id) throw new AppError('NOT_FOUND');
    return this.distributorOf(tx, id);
  }

  private async distributorOf(tx: Tx, distributorId: string): Promise<RunDistributor> {
    const row = await tx.distributor.findUnique({
      where: { id: distributorId },
      select: { id: true, code: true, homeStoreId: true, homeStore: { select: { name: true } } },
    });
    if (!row) throw new AppError('PERMISSION_DENIED');
    return { id: row.id, code: row.code, homeStoreId: row.homeStoreId, storeName: row.homeStore.name };
  }

  private async lockTrip(tx: Tx, tripId: string): Promise<RunTrip> {
    const rows = await tx.$queryRaw<RunTrip[]>`
      SELECT id, status, driver_id, vehicle_id, origin_store_id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return rows[0];
  }

  private async lockStop(tx: Tx, stopId: string): Promise<RunStop> {
    const rows = await tx.$queryRaw<RunStop[]>`
      SELECT id, trip_id, order_id, stop_type, status FROM trip_stops WHERE id = ${stopId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return rows[0];
  }

  private async lockCylinder(tx: Tx, cylinderId: string): Promise<LockedCylinder> {
    const rows = await tx.$queryRaw<LockedCylinder[]>`
      SELECT id, distributor_id, cylinder_type_id, state, custody_type, custody_id, last_event_id, qr_code, short_no
      FROM cylinders WHERE id = ${cylinderId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('SCAN_CYLINDER_UNKNOWN');
    return rows[0];
  }

  /**
   * §9.2 step 11: the event (actor, trip, stop, order, source, states, reason, lat/lng), the cylinder's
   * new holder, state and `last_event_id`, the visit's list row, and the legacy inventory lots.
   */
  private async writeMove(
    tx: Tx,
    p: {
      cylinder: LockedCylinder;
      move: PlannedMove;
      actorUserId: string;
      source: CylinderEventSource;
      reason: string | null;
      clientScanId: string | null;
      tripId: string | null;
      tripStopId: string | null;
      /** [Inc 3] The refill of the store's receive of a refill cylinder. */
      fillingOrderId?: string | null;
      lat?: number;
      lng?: number;
    },
  ): Promise<CylinderEvent> {
    const { cylinder, move } = p;
    const event = await tx.cylinderEvent.create({
      data: {
        cylinderId: cylinder.id,
        eventType: move.eventType,
        source: p.source,
        fromCustodyType: cylinder.custody_type,
        fromCustodyId: cylinder.custody_id,
        toCustodyType: move.to.type,
        toCustodyId: move.to.id,
        fromState: cylinder.state,
        toState: move.newState,
        reason: p.reason,
        actorUserId: p.actorUserId,
        clientScanId: p.clientScanId,
        tripId: p.tripId,
        tripStopId: p.tripStopId,
        orderId: move.orderId,
        fillingOrderId: p.fillingOrderId ?? null,
      },
    });
    if (p.lat !== undefined && p.lng !== undefined) {
      await tx.$executeRaw`
        UPDATE cylinder_events SET location = ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326) WHERE id = ${event.id}::uuid`;
    }
    await tx.cylinder.update({
      where: { id: cylinder.id },
      data: { custodyType: move.to.type, custodyId: move.to.id, state: move.newState, lastEventId: event.id },
    });
    if (move.stopRow && p.tripStopId) {
      await tx.stopCylinder.create({
        data: {
          tripStopId: p.tripStopId,
          orderId: move.stopRow.orderId,
          cylinderId: cylinder.id,
          cylinderTypeId: cylinder.cylinder_type_id,
          direction: move.stopRow.direction,
          returnState: move.stopRow.returnState,
          eventId: event.id,
        },
      });
    }
    await adjustInventoryLots(tx, {
      distributorId: cylinder.distributor_id,
      cylinderTypeId: cylinder.cylinder_type_id,
      from: { holderType: cylinder.custody_type, holderId: cylinder.custody_id, state: cylinder.state },
      to: { holderType: move.to.type, holderId: move.to.id, state: move.newState },
    });
    return event;
  }

  /** A typed number writes `custody.typed_entry` (Appendix B) with the move; refusals and repeats write none. */
  private async auditTyped(
    tx: Tx,
    actor: UserActor,
    cylinder: LockedCylinder,
    distributorCode: string,
    typed: string,
    action: ScanAction,
    eventId: string,
    tripId: string | null,
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'custody.typed_entry',
        actor,
        resourceType: 'cylinder',
        resourceId: cylinder.id,
        distributorId: cylinder.distributor_id,
        diff: {
          typed,
          shortCode: cylinderShortCode(distributorCode, cylinder.short_no),
          action,
          eventId,
          ...(tripId ? { tripId } : {}),
        },
      },
      tx,
    );
  }

  /** The responsible driver now (API_CONTRACT §9.2), for readers outside this service. */
  responsible(tx: Tx, cylinderId: string) {
    return responsibleDriver(tx, cylinderId);
  }
}
