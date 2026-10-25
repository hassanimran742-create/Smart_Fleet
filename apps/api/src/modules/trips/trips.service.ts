import { Injectable } from '@nestjs/common';
import { Prisma, TripStatus, TripStopStatus, TripStopType, UserRole } from '@prisma/client';
import {
  ORDER_LIST_TAB_STATUSES,
  TAKE_BACK_SHORT_REASONS,
  type DriverHomeDto,
  type OrderDto,
  type StopDetailDto,
  type StopFinishResult,
  type StopProgress,
  type TakeBackShortReason,
  type TripAction as SharedTripAction,
  type TripStatusValue,
  type TripStopViewDto,
  type TripVanDto,
  type UnlabelledReturnsResult,
  type VanLeftoverCylinder,
} from '@smartfleet/shared-types';
import { businessDate } from '@smartfleet/shared-utils';
import type { FinishStopInput, TripScanInput, UnlabelledReturnsInput, UpdateTripStatusInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDriverId } from '../../common/auth/own-driver-id';
import { canActOnTrip, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConfirmationService, type IssuedConfirmation } from '../confirmation/confirmation.interface';
import { deliveryProgress, pickupProgress, stopProgress, type ProgressTrip } from '../custody/progress';
import { ScanService, type ScanAnswer } from '../custody/scan.service';
import { vanCounts, vanCylinders, type VanCylinder } from '../custody/van';
import { raiseVanNotEmpty } from '../custody/van-alerts';
import { lockOrder, lockTripOrders, markOrderDeliveredByScans, markTripOrdersOnTheWay, releaseTripOrders } from '../orders/order-writes';
import { ORDER_VIEW_INCLUDE, toOrderDtos } from '../orders/orders.mapper';
import { businessDayOptions, currentBusinessDays } from '../orders/support/business-day';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { SettingsService } from '../settings/settings.service';
import { autoStartTrip, tripHasLoadOrHandover, tripHasScans } from './trip-writes';
import { CLOSED_STOP, isOpenTrip, nextOpenStopId, OPEN_STOP_STATUSES, stopWords, tripSummaries } from './trip-views';

/** Buttons a trip offers its caller (API_CONTRACT §1.6). */
export type TripAction = SharedTripAction;
/** Buttons a stop offers the trip's driver. */
export type StopAction = 'ARRIVE' | 'DEPART';

/**
 * A cylinder on the van as the trip names it (`TRIP_VAN_NOT_EMPTY`, and from Inc 2 `GET /trips/:id`
 * `van.cylinders`). From a run's point of view `vanCylinders` leaves refill cylinders out already.
 */
function leftoverOf(cylinder: VanCylinder): VanLeftoverCylinder {
  return {
    shortCode: cylinder.shortCode,
    sizeLabel: cylinder.sizeLabel,
    state: cylinder.state,
    came: cylinder.came === 'REFILL' ? 'SPARE' : cylinder.came,
  };
}

const OPEN_TRIP: TripStatusValue[] = ['PLANNED', 'IN_PROGRESS'];
const OPEN_STOP: TripStopStatus[] = [TripStopStatus.PENDING, TripStopStatus.ARRIVED];

/** The trip shape the installed driver app reads (`GET /trips/mine`, `/trips/:id`), with safe selects. */
const TRIP_INCLUDE = {
  orders: {
    include: {
      client: { select: { id: true, name: true, phone: true, address: true, area: true } },
      distributor: { select: { id: true, businessName: true, code: true } },
      lines: { include: { cylinderType: true } },
    },
  },
  stops: { orderBy: { seq: 'asc' } },
  originStore: true,
  vehicle: true,
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof TRIP_INCLUDE }>;
type StopRow = TripRow['stops'][number];

/** A stop as the API sends it: the row with its pin decoded (Prisma can't read geometry) and its buttons. */
export type StopView = StopRow & {
  location: { coordinates: [number, number]; lat: number; lng: number } | null;
  allowedActions: StopAction[];
};

/** [Inc 2] A stop of `GET /trips/:id` from Inc 2: the Inc 1 stop plus its words and progress (`TripStopViewDto`). */
export type StopDetailView = StopView & { type: TripStopType; title: string; address: string | null; progress: StopProgress | null };

/** A trip as the API sends it. `allowedActions` is filled on `GET /trips/:id` and on step answers. */
export type TripView = Omit<TripRow, 'stops'> & {
  stops: StopView[];
  driver?: { id: string; name: string; phone: string };
  allowedActions?: TripAction[];
};

/** [Inc 2] `GET /trips/:id` from Inc 2 (`TripDetailDto`): the Inc 1 trip plus each stop's progress and the van. */
export type TripDetailView = Omit<TripView, 'stops' | 'allowedActions'> & {
  stops: StopDetailView[];
  van: TripVanDto | null;
  allowedActions: TripAction[];
};

interface LockedTrip {
  id: string;
  status: TripStatus;
  driver_id: string;
  vehicle_id: string;
  origin_store_id: string;
}

interface LockedStop {
  id: string;
  trip_id: string;
  order_id: string | null;
  stop_type: TripStopType;
  status: TripStopStatus;
  arrived_at: Date | null;
  departed_at: Date | null;
}

/** How a stop finish is asked for: the Inc 2 route, or the installed app's legacy calls (API_CONTRACT §9.10). */
type FinishMode = 'ROUTE' | 'LEGACY_DEPART' | 'LEGACY_TAP';

interface FinishOutcome {
  applied: boolean;
  orderId: string | null;
  issued: IssuedConfirmation | null;
}

/** A short take-back as the visit keeps it (`trip_stops.notes`), in codes. */
interface TakeBackShortNote {
  reasonCode: TakeBackShortReason;
  note: string | null;
  expected: number;
  taken: number;
  /** Set when the installed 0.1.0 app finished the visit: it can't say why. */
  oldApp?: true;
}

/**
 * Trips and their stops (API_CONTRACT §7.7, §8.3, §9.3, §9.8). Only the trip's driver moves a trip and
 * its stops; the office may abort a trip only before anything happened on it. From Inc 2 a run moves
 * on scans: the store stop finishes when everything is loaded, a visit when its hand-overs match the
 * order, and the trip when every stop is closed and the van is empty. Nothing here moves money.
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly scans: ScanService,
    private readonly settings: SettingsService,
    private readonly alerts: AlertsService,
    private readonly confirmations: ConfirmationService,
  ) {}

  // ---------- reads ----------

  /** `GET /trips/mine` (DRIVER exact): a bare array, newest first, as the installed app reads it. */
  async forDriver(driverId: string): Promise<TripView[]> {
    const trips = await this.prisma.trip.findMany({
      where: { driverId },
      include: TRIP_INCLUDE,
      orderBy: [{ plannedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return this.withStops(trips, null);
  }

  /**
   * `GET /trips/:id`: the trip's driver or the office (404 for anyone else). From Inc 2 the existing
   * shape plus each stop's `type`, `title`, `address` and `progress`, the van and the trip's buttons.
   */
  async byId(caller: PolicyCaller, id: string): Promise<TripDetailView> {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: { ...TRIP_INCLUDE, driver: { select: { id: true, user: { select: { name: true, phone: true } } } } },
    });
    if (!trip || (caller.role !== UserRole.SUPER_ADMIN && !(caller.role === UserRole.DRIVER && caller.driverId === trip.driverId))) {
      throw new AppError('NOT_FOUND');
    }
    const { driver, ...rest } = trip;
    const [view] = await this.withStops([rest], caller);
    const stops = await this.detailStops(this.prisma, rest, view.stops);
    const [counts, onVan] = await Promise.all([
      vanCounts(this.prisma, rest.vehicleId),
      vanCylinders(this.prisma, rest.vehicleId, { perspectiveTripId: rest.id }),
    ]);
    const van: TripVanDto = { ...counts, cylinders: onVan.map(leftoverOf) };
    return {
      ...view,
      stops,
      van,
      driver: { id: driver.id, name: driver.user.name, phone: driver.user.phone },
      allowedActions: await this.tripActions(caller, rest, counts.total),
    };
  }

  /** `GET /trips/:tripId/stops/:stopId` (the trip's driver): the stop, its order (null at the store) and its progress. */
  async stopDetail(actor: UserActor, tripId: string, stopId: string): Promise<StopDetailDto> {
    const driverId = ownDriverId(actor);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: TRIP_INCLUDE });
    if (!trip || trip.driverId !== driverId) throw new AppError('NOT_FOUND');
    const row = trip.stops.find((stop) => stop.id === stopId);
    if (!row) throw new AppError('NOT_FOUND');
    const [decorated] = await this.decorateStops([row], (s) => this.stopActions(actor, trip.status, s));
    const [stop] = await this.detailStops(this.prisma, trip, [decorated]);
    const order = row.orderId && row.stopType === TripStopType.DELIVERY ? await this.orderView(actor, row.orderId) : null;
    return { stop: stop as unknown as TripStopViewDto, order, progress: stop.progress as StopProgress };
  }

  /**
   * `GET /driver/home` (DRIVER exact): the Today screen in one request. The active trip is the newest
   * run in progress; the next ones are the other open runs, in progress first, then planned, oldest first.
   */
  async driverHome(actor: UserActor): Promise<DriverHomeDto> {
    const driverId = ownDriverId(actor);
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { isOnline: true, currentVehicle: { select: { id: true, plateNo: true } } },
    });
    if (!driver) throw new AppError('PERMISSION_DENIED');
    const [options, today] = await Promise.all([businessDayOptions(this.settings), currentBusinessDays(this.settings)]);
    const [open, doneToday, van] = await Promise.all([
      this.prisma.trip.findMany({
        where: { driverId, status: { in: [TripStatus.IN_PROGRESS, TripStatus.PLANNED] } },
        orderBy: [{ plannedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, status: true, startedAt: true },
      }),
      this.prisma.trip.count({ where: { driverId, status: TripStatus.COMPLETED, completedAt: { gte: today.start, lt: today.end } } }),
      vanCounts(this.prisma, driver.currentVehicle?.id),
    ]);
    const running = open
      .filter((trip) => trip.status === TripStatus.IN_PROGRESS)
      .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
    const active = running[0] ?? null;
    const next = [...running.slice(1), ...open.filter((trip) => trip.status === TripStatus.PLANNED)];
    const summaries = await tripSummaries(this.prisma, open.map((trip) => trip.id));
    return {
      businessDate: businessDate(new Date(), options),
      onDuty: driver.isOnline,
      vehicle: driver.currentVehicle ? { id: driver.currentVehicle.id, plateNo: driver.currentVehicle.plateNo } : null,
      van,
      activeTrip: active ? summaries.get(active.id) ?? null : null,
      nextTrips: next.map((trip) => summaries.get(trip.id)).filter((summary): summary is NonNullable<typeof summary> => !!summary),
      doneToday,
    };
  }

  // ---------- Inc 2 driver steps ----------

  /** `POST /trips/:tripId/scans` (the trip's driver): LOAD, HANDOVER or TAKE_BACK at one of its stops. */
  scan(actor: UserActor, tripId: string, body: TripScanInput): Promise<ScanAnswer> {
    return this.scans.driverScan(actor, {
      action: body.action,
      tripId,
      stopId: body.stopId.toLowerCase(),
      scanId: body.scanId.toLowerCase(),
      code: body.code,
      entryMethod: body.entryMethod,
      returnState: body.returnState,
      lat: body.lat,
      lng: body.lng,
    });
  }

  /**
   * `PUT /trips/:tripId/stops/:stopId/unlabelled-returns` (the trip's driver): replaces the visit's whole
   * list of unlabelled or other-brand returns, so a resend changes nothing; a count of 0 keeps no row.
   * Only at an open DELIVERY stop of an open trip; the first PUT at a PENDING stop sets `arrivedAt`.
   * These count as taken back but never get a holder (ADR-13).
   */
  async unlabelledReturns(actor: UserActor, tripId: string, stopId: string, body: UnlabelledReturnsInput): Promise<UnlabelledReturnsResult> {
    const driverId = ownDriverId(actor);
    return this.prisma.$transaction(async (tx) => {
      const found = await this.ownStop(tx, driverId, tripId, stopId);
      if (found.stop.order_id) await lockOrder(tx, found.stop.order_id);
      const trip = await this.lockTrip(tx, found.trip.id);
      const stop = await this.lockStopRow(tx, found.stop.id);
      const progressTrip = this.progressTrip(trip);
      const refuse = async (code: 'SCAN_TRIP_CLOSED' | 'SCAN_STOP_CLOSED' | 'SCAN_EVENT_NOT_ALLOWED', details: Record<string, unknown> = {}) => {
        const progress = await stopProgress(tx, progressTrip, this.progressStop(stop));
        return new (AppError as unknown as new (c: string, d: Record<string, unknown>) => AppError)(code, { ...details, ...(progress ? { progress } : {}) });
      };
      if (!isOpenTrip(trip.status)) throw await refuse('SCAN_TRIP_CLOSED');
      if (!OPEN_STOP.includes(stop.status)) throw await refuse('SCAN_STOP_CLOSED', { currentStatus: stop.status });
      if (stop.stop_type !== TripStopType.DELIVERY || !stop.order_id) throw await refuse('SCAN_EVENT_NOT_ALLOWED');
      const typeIds = [...new Set(body.items.map((item) => item.cylinderTypeId.toLowerCase()))];
      const known = typeIds.length ? await tx.cylinderType.count({ where: { id: { in: typeIds } } }) : 0;
      if (known !== typeIds.length) throw new AppError('NOT_FOUND', { field: 'cylinderTypeId' });

      await tx.stopUnlabelledReturn.deleteMany({ where: { tripStopId: stop.id } });
      const rows = body.items.filter((item) => item.count > 0);
      if (rows.length) {
        await tx.stopUnlabelledReturn.createMany({
          data: rows.map((item) => ({
            tripStopId: stop.id,
            orderId: stop.order_id as string,
            cylinderTypeId: item.cylinderTypeId.toLowerCase(),
            state: item.state,
            count: item.count,
            recordedByUserId: actor.userId,
          })),
        });
      }
      await tx.$executeRaw`
        UPDATE trip_stops SET status = 'ARRIVED', arrived_at = COALESCE(arrived_at, (now() AT TIME ZONE 'UTC'))
        WHERE id = ${stop.id}::uuid AND status = 'PENDING'`;
      await autoStartTrip(tx, trip.id);
      const progress = await deliveryProgress(tx, progressTrip, { ...this.progressStop(stop), status: TripStopStatus.ARRIVED });
      return { progress };
    }, LOCKING_TX);
  }

  /**
   * `POST /trips/:tripId/stops/:stopId/finish` (the trip's driver). STORE_PICKUP ("Done loading"): every
   * size loaded at least as needed (409 LOAD_INCOMPLETE), then the stop departs and the trip's ASSIGNED
   * orders go on the way. DELIVERY ("Finish visit"): the hand-overs equal the order (409
   * DELIVERY_SCANS_INCOMPLETE) and a short take-back needs a reason (409 TAKE_BACK_SHORT); then the
   * order is DELIVERED (SCANNED), the stop DONE and, while `confirmation.enabled`, the confirmation issued
   * in the same transaction. A repeat on a DONE stop answers 200 `X-Already-Applied`. No money.
   */
  async finishStop(
    actor: UserActor,
    tripId: string,
    stopId: string,
    body: FinishStopInput,
  ): Promise<StopFinishResult | IdempotentResponse<StopFinishResult>> {
    const driverId = ownDriverId(actor);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const found = await this.ownStop(tx, driverId, tripId, stopId);
      return this.finishStopTx(tx, actor, found.trip.id, found.stop, body.takeBackShort ?? null, 'ROUTE');
    }, LOCKING_TX);
    void this.confirmations.sendIssued(outcome.issued);
    const result: StopFinishResult = {
      order: outcome.orderId ? await this.orderView(actor, outcome.orderId) : null,
      nextStopId: await nextOpenStopId(this.prisma, tripId, stopId),
    };
    return outcome.applied ? result : alreadyApplied(result);
  }

  /**
   * `POST /trips/:tripId/finish` ("Finish trip", the trip's driver). Every stop closed (409
   * TRIP_STOPS_OPEN) and the van empty (409 TRIP_VAN_NOT_EMPTY `{count, cylinders, leftoversAllowed}`).
   * With `trip.allowFinishWithLeftovers` on and a `leftoverReason`, the trip completes with the cylinders
   * still on the van and a VAN_NOT_EMPTY alert. A repeat on a COMPLETED trip is 200 `X-Already-Applied`;
   * an ABORTED trip is 409 TRIP_INVALID_TRANSITION. No money.
   */
  async finishTrip(actor: UserActor, tripId: string, body: { leftoverReason?: string }): Promise<TripDetailView | IdempotentResponse<TripDetailView>> {
    const driverId = ownDriverId(actor);
    const applied = await this.prisma.$transaction((tx) => this.finishTripTx(tx, driverId, tripId, body.leftoverReason ?? null), LOCKING_TX);
    const view = await this.byId(actor, tripId);
    return applied ? view : alreadyApplied(view);
  }

  // ---------- Inc 1 trip and stop steps (legacy routes, mapped onto Inc 2 in §9.10) ----------

  /**
   * `PATCH /trips/:id/status`. The driver: PLANNED → IN_PROGRESS; COMPLETED maps to "Finish trip" (§9.10,
   * with `reason` as the leftover reason). The office: → ABORTED with a reason, only while nothing
   * happened on the trip; its orders go back to needing a driver (audited `trip.abort`, no money). A
   * repeat of the trip's status by a caller who may make it answers 200 `X-Already-Applied`.
   */
  async setStatus(actor: UserActor, id: string, body: UpdateTripStatusInput): Promise<TripView | IdempotentResponse<TripView>> {
    const office = actor.role === UserRole.SUPER_ADMIN;
    if (!office && body.status === 'COMPLETED') {
      const driverId = ownDriverId(actor);
      if (body.reason !== undefined && body.reason.length < 5) {
        throw new AppError('VALIDATION_FAILED', {
          fields: [{ path: 'reason', code: 'TOO_SHORT', message: validationMessage('TOO_SHORT', { min: 5 }), params: { min: 5 } }],
        });
      }
      const applied = await this.prisma.$transaction(async (tx) => {
        const trip = await this.lockTrip(tx, id);
        canActOnTrip(actor, { driverId: trip.driver_id });
        return this.finishTripTx(tx, driverId, id, body.reason ?? null);
      }, LOCKING_TX);
      const view = await this.byId(actor, id);
      return applied ? view : alreadyApplied(view);
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (office && body.status === 'ABORTED') await lockTripOrders(tx, id);
      const trip = await this.lockTrip(tx, id);
      if (!office) canActOnTrip(actor, { driverId: trip.driver_id });
      const mayMake = office ? body.status === 'ABORTED' : body.status === 'IN_PROGRESS';
      if (trip.status === body.status) {
        if (mayMake) return 'already' as const;
        throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
      }
      if (!office && body.status === 'IN_PROGRESS' && trip.status === TripStatus.PLANNED) {
        await autoStartTrip(tx, id);
        return 'changed' as const;
      }
      if (office && body.status === 'ABORTED' && OPEN_TRIP.includes(trip.status)) {
        if (!(await this.untouched(tx, id))) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
        await this.officeAbort(tx, actor, trip, body.reason as string);
        return 'changed' as const;
      }
      throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
    }, LOCKING_TX);
    const view = await this.byId(actor, id);
    return outcome === 'already' ? alreadyApplied(view) : view;
  }

  /**
   * `PATCH /trips/stops/:stopId/arrive` (the trip's driver). Sets `arrivedAt` once and the stop
   * ARRIVED; the first arrive starts a PLANNED trip (the trip only). A repeat: 200 `X-Already-Applied`.
   */
  async arrive(actor: UserActor, stopId: string): Promise<StopView | IdempotentResponse<StopView>> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { trip, stop } = await this.lockStop(tx, actor, stopId, false);
      if (stop.arrived_at) return 'already' as const;
      if (stop.status !== TripStopStatus.PENDING) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: stop.status });
      await tx.$executeRaw`
        UPDATE trip_stops SET arrived_at = (now() AT TIME ZONE 'UTC'), status = 'ARRIVED' WHERE id = ${stopId}::uuid`;
      await autoStartTrip(tx, trip.id);
      return 'changed' as const;
    }, LOCKING_TX);
    const view = await this.stopView(actor, stopId);
    return outcome === 'already' ? alreadyApplied(view) : view;
  }

  /**
   * `PATCH /trips/stops/:stopId/depart` (the installed app's "Done loading" and "Done"), mapped to the
   * stop finish (§9.10): the store stop needs everything loaded, a visit its hand-overs. The old app
   * can't say why fewer came back, so its visit finish records a short take-back as OTHER. A repeat on a
   * DONE stop: 200 `X-Already-Applied`.
   */
  async depart(actor: UserActor, stopId: string): Promise<StopView | IdempotentResponse<StopView>> {
    const driverId = ownDriverId(actor);
    const found = await this.prisma.tripStop.findUnique({ where: { id: stopId }, select: { tripId: true } });
    if (!found) throw new AppError('NOT_FOUND');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const own = await this.ownStop(tx, driverId, found.tripId, stopId);
      return this.finishStopTx(tx, actor, own.trip.id, own.stop, null, 'LEGACY_DEPART');
    }, LOCKING_TX);
    void this.confirmations.sendIssued(outcome.issued);
    const view = await this.stopView(actor, stopId);
    return outcome.applied ? view : alreadyApplied(view);
  }

  /**
   * The installed app's Delivered tap (`PATCH /orders/:id/status DELIVERED`, §9.10), inside the order's
   * transaction after the orders module locked the order and checked its status: behaves like the visit
   * finish, so the hand-overs must match the order (409 DELIVERY_SCANS_INCOMPLETE). The old app scans the
   * empties after this tap, so a short take-back delivers the order and keeps the visit open; its "Done"
   * (depart) then closes it.
   */
  async legacyDeliveredTap(tx: Tx, actor: UserActor, order: { id: string; tripId: string }): Promise<FinishOutcome> {
    const stop = await tx.tripStop.findFirst({
      where: { tripId: order.tripId, orderId: order.id, stopType: TripStopType.DELIVERY, status: { in: OPEN_STOP } },
      orderBy: { seq: 'asc' },
      select: { id: true },
    });
    if (!stop) throw new AppError('ORDER_INVALID_TRANSITION', { from: 'IN_TRANSIT', to: 'DELIVERED', currentStatus: 'IN_TRANSIT' });
    // Read, not locked: the finish locks the trip, then the stop, as every scan does.
    const rows = await tx.$queryRaw<LockedStop[]>`
      SELECT id, trip_id, order_id, stop_type, status, arrived_at, departed_at FROM trip_stops WHERE id = ${stop.id}::uuid`;
    return this.finishStopTx(tx, actor, order.tripId, rows[0], null, 'LEGACY_TAP');
  }

  // ---------- used by orders, inside the order's transaction ----------

  /**
   * A new trip for one order (ADR-12): PLANNED, a STORE_PICKUP stop at the distributor's store
   * (seq 0, `store_id` set), then the order's DELIVERY stop (seq 1).
   */
  async createForOrder(
    tx: Tx,
    p: { driverId: string; vehicleId: string; store: { id: string; lat: number; lng: number }; orderId: string; destination: { lat: number; lng: number } },
  ): Promise<string> {
    const trip = await tx.trip.create({
      data: { driverId: p.driverId, vehicleId: p.vehicleId, originStoreId: p.store.id, status: TripStatus.PLANNED },
      select: { id: true },
    });
    await tx.$executeRaw`
      INSERT INTO trip_stops (id, trip_id, seq, stop_type, store_id, status, location)
      VALUES (gen_random_uuid(), ${trip.id}::uuid, 0, 'STORE_PICKUP', ${p.store.id}::uuid, 'PENDING',
              ST_SetSRID(ST_MakePoint(${p.store.lng}, ${p.store.lat}), 4326))`;
    await tx.$executeRaw`
      INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, status, location)
      VALUES (gen_random_uuid(), ${trip.id}::uuid, ${p.orderId}::uuid, 1, 'DELIVERY', 'PENDING',
              ST_SetSRID(ST_MakePoint(${p.destination.lng}, ${p.destination.lat}), 4326))`;
    return trip.id;
  }

  /**
   * [Inc 2] assign-driver v2 (API_CONTRACT §9.5): the driver's PLANNED trip from the same store on the
   * same van that has no load scan, which a new order may join (the newest such trip), locked. Null
   * when there is none, so a new trip is made. Each run carries one distributor's orders: one store.
   */
  async appendableTrip(tx: Tx, p: { driverId: string; vehicleId: string; storeId: string }): Promise<string | null> {
    const trips = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM trips
      WHERE driver_id = ${p.driverId}::uuid AND vehicle_id = ${p.vehicleId}::uuid AND origin_store_id = ${p.storeId}::uuid
        AND status = 'PLANNED'
      ORDER BY planned_at DESC, id DESC
      FOR UPDATE`;
    for (const trip of trips) {
      if (await tripHasScans(tx, trip.id)) continue;
      const loading = await tx.order.count({ where: { tripId: trip.id, loadStartedAt: { not: null } } });
      if (loading === 0) return trip.id;
    }
    return null;
  }

  /** [Inc 2] Appends an order's DELIVERY stop (the next seq) to a trip found by {@link appendableTrip}. */
  async appendOrder(tx: Tx, tripId: string, orderId: string, destination: { lat: number; lng: number }): Promise<void> {
    const last = await tx.tripStop.aggregate({ where: { tripId }, _max: { seq: true } });
    const seq = (last._max.seq ?? 0) + 1;
    await tx.$executeRaw`
      INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, status, location)
      VALUES (gen_random_uuid(), ${tripId}::uuid, ${orderId}::uuid, ${seq}, 'DELIVERY', 'PENDING',
              ST_SetSRID(ST_MakePoint(${destination.lng}, ${destination.lat}), 4326))`;
  }

  /** Closes an order's open DELIVERY stop on a trip: CANCELLED (cancel, reassign), FAILED, or DONE (office delivery). */
  async closeOrderStop(tx: Tx, tripId: string, orderId: string, status: 'CANCELLED' | 'FAILED' | 'DONE'): Promise<void> {
    // The caller holds the order; the trip comes before its stops, as in arrive and depart, so a cancel
    // racing the driver's arrive at this stop waits instead of deadlocking.
    await this.lockTrip(tx, tripId);
    if (status === 'CANCELLED') {
      await tx.$executeRaw`
        UPDATE trip_stops SET status = 'CANCELLED', cancelled_at = (now() AT TIME ZONE 'UTC')
        WHERE trip_id = ${tripId}::uuid AND order_id = ${orderId}::uuid AND stop_type = 'DELIVERY' AND status IN ('PENDING','ARRIVED')`;
    } else if (status === 'FAILED') {
      await tx.$executeRaw`
        UPDATE trip_stops SET status = 'FAILED', completed_at = (now() AT TIME ZONE 'UTC')
        WHERE trip_id = ${tripId}::uuid AND order_id = ${orderId}::uuid AND stop_type = 'DELIVERY' AND status IN ('PENDING','ARRIVED')`;
    } else {
      await tx.$executeRaw`
        UPDATE trip_stops
        SET status = 'DONE', completed_at = (now() AT TIME ZONE 'UTC'), arrived_at = COALESCE(arrived_at, (now() AT TIME ZONE 'UTC')),
            departed_at = COALESCE(departed_at, (now() AT TIME ZONE 'UTC'))
        WHERE trip_id = ${tripId}::uuid AND order_id = ${orderId}::uuid AND stop_type = 'DELIVERY' AND status IN ('PENDING','ARRIVED')`;
    }
  }

  /** The order's current DELIVERY stop on a trip (the open one, else the newest), locked; null when there is none. */
  async lockOrderStop(tx: Tx, tripId: string, orderId: string): Promise<{ id: string; status: TripStopStatus } | null> {
    const stops = await tx.tripStop.findMany({
      where: { tripId, orderId, stopType: TripStopType.DELIVERY },
      orderBy: { seq: 'asc' },
      select: { id: true, status: true },
    });
    const stop = stops.find((s) => OPEN_STOP.includes(s.status)) ?? stops[stops.length - 1];
    if (!stop) return null;
    const row = await this.lockStopRow(tx, stop.id);
    return { id: row.id, status: row.status };
  }

  /**
   * Aborts an open trip left with no other open order and no load scan (§7.6 cancel step 6, §8.3: the
   * system abort when its last open order is cancelled or reassigned; the `order.*` audit row covers
   * it). A hand-back (SCAN_IN) of empties from an earlier run doesn't keep it open. Its open stops are
   * cancelled. True when it aborted the trip.
   */
  async abortIfIdle(tx: Tx, tripId: string, exceptOrderId?: string): Promise<boolean> {
    const trip = await this.lockTrip(tx, tripId);
    if (!OPEN_TRIP.includes(trip.status)) return false;
    const others = await tx.order.count({
      where: {
        tripId,
        status: { in: [...ORDER_LIST_TAB_STATUSES.active] },
        ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
      },
    });
    if (others > 0 || (await tripHasLoadOrHandover(tx, tripId))) return false;
    await this.closeTrip(tx, tripId);
    return true;
  }

  // ---------- finishing ----------

  /** The stop finish of §9.3, shared by the Inc 2 route and the legacy depart and Delivered tap. */
  private async finishStopTx(
    tx: Tx,
    actor: UserActor,
    tripId: string,
    found: LockedStop,
    takeBackShort: FinishStopInput['takeBackShort'] | null,
    mode: FinishMode,
  ): Promise<FinishOutcome> {
    if (found.stop_type === TripStopType.STORE_PICKUP) {
      await lockTripOrders(tx, tripId);
      const trip = await this.lockTrip(tx, tripId);
      const stop = await this.lockStopRow(tx, found.id);
      if (stop.status === TripStopStatus.DONE) return { applied: false, orderId: null, issued: null };
      if (!OPEN_STOP.includes(stop.status)) throw new AppError('SCAN_STOP_CLOSED', { currentStatus: stop.status });
      if (!isOpenTrip(trip.status)) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
      const loads = await pickupProgress(tx, this.progressTrip(trip));
      if (!loads.complete) throw new AppError('LOAD_INCOMPLETE', { total: loads.neededCount, done: loads.doneCount, lines: loads.lines });
      await this.closeStop(tx, stop.id, null);
      await autoStartTrip(tx, trip.id);
      await markTripOrdersOnTheWay(tx, trip.id);
      return { applied: true, orderId: null, issued: null };
    }

    if (found.stop_type !== TripStopType.DELIVERY || !found.order_id) {
      // A RETURN_DROPOFF stop has nothing to check: it just closes.
      const trip = await this.lockTrip(tx, tripId);
      const stop = await this.lockStopRow(tx, found.id);
      if (stop.status === TripStopStatus.DONE) return { applied: false, orderId: null, issued: null };
      if (!OPEN_STOP.includes(stop.status)) throw new AppError('SCAN_STOP_CLOSED', { currentStatus: stop.status });
      if (!isOpenTrip(trip.status)) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
      await this.closeStop(tx, stop.id, null);
      return { applied: true, orderId: null, issued: null };
    }

    const orderId = found.order_id;
    await lockOrder(tx, orderId);
    const trip = await this.lockTrip(tx, tripId);
    const stop = await this.lockStopRow(tx, found.id);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, deliveredAt: true, deliveryMethod: true } });
    if (stop.status === TripStopStatus.DONE) {
      // The office's manual delivery is another kind of action than the visit finish (§4.3): 409, not a repeat.
      if (order.status === 'DELIVERED' && order.deliveryMethod === 'MANUAL') {
        throw new AppError('ORDER_INVALID_TRANSITION', { from: 'DELIVERED', to: 'DELIVERED', currentStatus: 'DELIVERED' });
      }
      return { applied: false, orderId, issued: null };
    }
    if (!OPEN_STOP.includes(stop.status)) throw new AppError('SCAN_STOP_CLOSED', { currentStatus: stop.status });
    if (!isOpenTrip(trip.status)) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
    if (order.status !== 'ASSIGNED' && order.status !== 'IN_TRANSIT' && order.status !== 'DELIVERED') {
      throw new AppError('ORDER_INVALID_TRANSITION', { from: order.status, to: 'DELIVERED', currentStatus: order.status });
    }

    const visit = await deliveryProgress(tx, this.progressTrip(trip), this.progressStop(stop));
    if (!visit.give.complete) {
      throw new AppError('DELIVERY_SCANS_INCOMPLETE', {
        missing: visit.give.lines.filter((line) => line.done < line.needed).map((line) => ({ sizeLabel: line.sizeLabel, needed: line.needed, given: line.done })),
      });
    }
    let shortNote: TakeBackShortNote | null = null;
    let keepOpen = false;
    if (visit.takeBack.count < visit.takeBack.expected) {
      const expected = visit.takeBack.expected;
      const taken = visit.takeBack.count;
      if (takeBackShort) shortNote = { reasonCode: takeBackShort.reasonCode, note: takeBackShort.note ?? null, expected, taken };
      else if (mode === 'LEGACY_DEPART') shortNote = { reasonCode: 'OTHER', note: null, expected, taken, oldApp: true };
      else if (mode === 'LEGACY_TAP') keepOpen = true;
      else throw new AppError('TAKE_BACK_SHORT', { expected, taken });
    }

    let issued: IssuedConfirmation | null = null;
    let changedOrder = false;
    if (order.status !== 'DELIVERED') {
      const deliveredAt = await markOrderDeliveredByScans(tx, orderId, actor.userId);
      if (!deliveredAt) throw new AppError('CONFLICT_STALE_STATE');
      changedOrder = true;
      issued = await this.confirmations.issueForDeliveredOrder(tx, { orderId, stopId: stop.id, deliveredAt });
    }
    if (!keepOpen) await this.closeStop(tx, stop.id, shortNote);
    await autoStartTrip(tx, trip.id);
    return { applied: changedOrder || !keepOpen, orderId, issued };
  }

  /** "Finish trip" (§9.3), under the trip lock. True when it completed the trip; false for a repeat. */
  private async finishTripTx(tx: Tx, driverId: string, tripId: string, leftoverReason: string | null): Promise<boolean> {
    const trip = await this.lockTrip(tx, tripId);
    if (trip.driver_id !== driverId) throw new AppError('NOT_FOUND');
    if (trip.status === TripStatus.COMPLETED) return false;
    if (trip.status === TripStatus.ABORTED) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
    const open = await tx.tripStop.count({ where: { tripId, status: { in: OPEN_STOP_STATUSES } } });
    if (open > 0) throw new AppError('TRIP_STOPS_OPEN');

    const onVan = await vanCylinders(tx, trip.vehicle_id, { perspectiveTripId: trip.id });
    let reason: string | null = null;
    if (onVan.length > 0) {
      const allowed = await this.settings.get('trip.allowFinishWithLeftovers');
      if (!allowed || !leftoverReason) {
        throw new AppError('TRIP_VAN_NOT_EMPTY', {
          count: onVan.length,
          cylinders: onVan.map(leftoverOf),
          leftoversAllowed: allowed,
        });
      }
      reason = leftoverReason;
    }
    await tx.$executeRaw`
      UPDATE trips
      SET status = 'COMPLETED', completed_at = (now() AT TIME ZONE 'UTC'),
          started_at = COALESCE(started_at, (now() AT TIME ZONE 'UTC')), leftover_reason = ${reason}
      WHERE id = ${tripId}::uuid AND status IN ('PLANNED','IN_PROGRESS')`;
    if (reason) {
      const van = await tx.vehicle.findUnique({ where: { id: trip.vehicle_id }, select: { plateNo: true } });
      await raiseVanNotEmpty(this.alerts, tx, {
        vehicleId: trip.vehicle_id,
        plateNo: van?.plateNo ?? '',
        count: onVan.length,
        tripId,
        leftoverReason: reason,
      });
    }
    return true;
  }

  /** A stop is finished: DONE with its times set once (and the short take-back kept on it). */
  private async closeStop(tx: Tx, stopId: string, shortNote: TakeBackShortNote | null): Promise<void> {
    if (shortNote) {
      await tx.$executeRaw`
        UPDATE trip_stops
        SET status = 'DONE', departed_at = COALESCE(departed_at, (now() AT TIME ZONE 'UTC')),
            arrived_at = COALESCE(arrived_at, (now() AT TIME ZONE 'UTC')), completed_at = (now() AT TIME ZONE 'UTC'),
            notes = ${JSON.stringify({ takeBackShort: shortNote })}
        WHERE id = ${stopId}::uuid`;
      return;
    }
    await tx.$executeRaw`
      UPDATE trip_stops
      SET status = 'DONE', departed_at = COALESCE(departed_at, (now() AT TIME ZONE 'UTC')),
          arrived_at = COALESCE(arrived_at, (now() AT TIME ZONE 'UTC')), completed_at = (now() AT TIME ZONE 'UTC')
      WHERE id = ${stopId}::uuid`;
  }

  // ---------- internals ----------

  private async lockTrip(tx: Tx, id: string): Promise<LockedTrip> {
    const rows = await tx.$queryRaw<LockedTrip[]>`
      SELECT id, status, driver_id, vehicle_id, origin_store_id FROM trips WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return rows[0];
  }

  private async lockStopRow(tx: Tx, stopId: string): Promise<LockedStop> {
    const rows = await tx.$queryRaw<LockedStop[]>`
      SELECT id, trip_id, order_id, stop_type, status, arrived_at, departed_at FROM trip_stops WHERE id = ${stopId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return rows[0];
  }

  /** The caller's trip and one of its stops (unlocked), else 404 (the same for any unknown id). */
  private async ownStop(tx: Tx, driverId: string, tripId: string, stopId: string): Promise<{ trip: { id: string }; stop: LockedStop }> {
    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { id: true, driverId: true } });
    if (!trip || trip.driverId !== driverId) throw new AppError('NOT_FOUND');
    const rows = await tx.$queryRaw<LockedStop[]>`
      SELECT id, trip_id, order_id, stop_type, status, arrived_at, departed_at FROM trip_stops WHERE id = ${stopId}::uuid`;
    const stop = rows[0];
    if (!stop || stop.trip_id !== trip.id) throw new AppError('NOT_FOUND');
    return { trip, stop };
  }

  /** Locks a stop's trip (and, for a store-stop depart, the trip's orders first), then the stop. */
  private async lockStop(tx: Tx, actor: UserActor, stopId: string, departing: boolean): Promise<{ trip: LockedTrip; stop: LockedStop }> {
    const found = await tx.tripStop.findUnique({ where: { id: stopId }, select: { tripId: true, stopType: true } });
    if (!found) throw new AppError('NOT_FOUND');
    if (departing && found.stopType === TripStopType.STORE_PICKUP) await lockTripOrders(tx, found.tripId);
    const trip = await this.lockTrip(tx, found.tripId);
    canActOnTrip(actor, { driverId: trip.driver_id });
    const stop = await this.lockStopRow(tx, stopId);
    if (!OPEN_TRIP.includes(trip.status)) throw new AppError('TRIP_INVALID_TRANSITION', { currentStatus: trip.status });
    return { trip, stop };
  }

  private progressTrip(trip: LockedTrip): ProgressTrip {
    return { id: trip.id, vehicleId: trip.vehicle_id, status: trip.status };
  }

  private progressStop(stop: LockedStop) {
    return { id: stop.id, type: stop.stop_type, status: stop.status, orderId: stop.order_id };
  }

  /** Nothing happened on the trip: no scan, no stop arrived or departed, and every order still waiting to load. */
  private async untouched(tx: Tx, tripId: string): Promise<boolean> {
    if (await tripHasScans(tx, tripId)) return false;
    const touchedStops = await tx.tripStop.count({ where: { tripId, OR: [{ arrivedAt: { not: null } }, { departedAt: { not: null } }] } });
    if (touchedStops > 0) return false;
    const busy = await tx.order.count({
      where: { tripId, OR: [{ status: { notIn: ['ASSIGNED', 'CANCELLED'] } }, { status: 'ASSIGNED', loadStartedAt: { not: null } }] },
    });
    return busy === 0;
  }

  private async officeAbort(tx: Tx, actor: UserActor, trip: LockedTrip, reason: string): Promise<void> {
    const orderIds = await releaseTripOrders(tx, trip.id);
    await this.closeTrip(tx, trip.id);
    const [driver, owner] = await Promise.all([
      tx.driver.findUnique({ where: { id: trip.driver_id }, select: { user: { select: { name: true } } } }),
      tx.distributor.findUnique({ where: { homeStoreId: trip.origin_store_id }, select: { id: true } }),
    ]);
    await this.audit.record(
      {
        action: 'trip.abort',
        actor,
        resourceType: 'trip',
        resourceId: trip.id,
        distributorId: owner?.id ?? null,
        reason,
        diff: { orderIds, count: orderIds.length, driver: driver?.user.name ?? '' },
      },
      tx,
    );
  }

  private async closeTrip(tx: Tx, tripId: string): Promise<void> {
    await tx.$executeRaw`UPDATE trips SET status = 'ABORTED' WHERE id = ${tripId}::uuid`;
    await tx.$executeRaw`
      UPDATE trip_stops SET status = 'CANCELLED', cancelled_at = (now() AT TIME ZONE 'UTC')
      WHERE trip_id = ${tripId}::uuid AND status IN ('PENDING','ARRIVED')`;
  }

  /**
   * The trip's buttons (§1.6). The office: ABORT while nothing happened on it. The driver: START while
   * PLANNED; COMPLETE once every stop is closed and the van is empty (or leftovers are allowed).
   */
  private async tripActions(caller: PolicyCaller, trip: TripRow, onVan: number): Promise<TripAction[]> {
    if (caller.role === UserRole.SUPER_ADMIN) {
      if (!OPEN_TRIP.includes(trip.status)) return [];
      return (await this.untouchedReadOnly(trip)) ? ['ABORT'] : [];
    }
    if (trip.status === TripStatus.PLANNED) return ['START'];
    if (trip.status === TripStatus.IN_PROGRESS) {
      const stopsOpen = trip.stops.some((stop) => !CLOSED_STOP.includes(stop.status));
      if (stopsOpen) return [];
      if (onVan > 0 && !(await this.settings.get('trip.allowFinishWithLeftovers'))) return [];
      return ['COMPLETE'];
    }
    return [];
  }

  private async untouchedReadOnly(trip: TripRow): Promise<boolean> {
    const scans = await this.prisma.cylinderEvent.count({ where: { tripId: trip.id } });
    if (scans > 0) return false;
    if (trip.stops.some((stop) => stop.arrivedAt || stop.departedAt)) return false;
    return trip.orders.every((order) => order.status === 'CANCELLED' || (order.status === 'ASSIGNED' && !order.loadStartedAt));
  }

  private stopActions(caller: PolicyCaller | null, tripStatus: TripStatus, stop: { status: TripStopStatus }): StopAction[] {
    if (!caller || caller.role !== UserRole.DRIVER || !OPEN_TRIP.includes(tripStatus)) return [];
    if (stop.status === TripStopStatus.PENDING) return ['ARRIVE'];
    if (stop.status === TripStopStatus.ARRIVED) return ['DEPART'];
    return [];
  }

  private async stopView(actor: UserActor, stopId: string): Promise<StopView> {
    const stop = await this.prisma.tripStop.findUniqueOrThrow({ where: { id: stopId }, include: { trip: { select: { status: true } } } });
    const { trip, ...row } = stop;
    const [view] = await this.decorateStops([row], (s) => this.stopActions(actor, trip.status, s));
    return view;
  }

  /** [Inc 2] Each stop's words and progress, on top of its Inc 1 view. */
  private async detailStops(db: Tx | PrismaService, trip: { id: string; vehicleId: string; status: TripStatus }, stops: StopView[]): Promise<StopDetailView[]> {
    const words = await stopWords(db, stops.map((stop) => stop.id));
    const progressTrip: ProgressTrip = { id: trip.id, vehicleId: trip.vehicleId, status: trip.status };
    const out: StopDetailView[] = [];
    for (const stop of stops) {
      const progress = await stopProgress(db, progressTrip, { id: stop.id, type: stop.stopType, status: stop.status, orderId: stop.orderId });
      out.push({ ...stop, type: stop.stopType, title: words.get(stop.id)?.title ?? '', address: words.get(stop.id)?.address ?? null, progress });
    }
    return out;
  }

  /** An order as its DTO for this caller (the stop detail and finish answers). */
  private async orderView(caller: PolicyCaller, orderId: string): Promise<OrderDto> {
    const row = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_VIEW_INCLUDE });
    const rule = await this.settings.get('orders.deliveryStartedAt');
    return (await toOrderDtos(this.prisma, [row], caller, rule))[0];
  }

  /** Replaces each stop's raw geometry with a readable pin and adds its buttons. */
  private async withStops(trips: TripRow[], caller: PolicyCaller | null): Promise<TripView[]> {
    const statusByTrip = new Map(trips.map((trip) => [trip.id, trip.status]));
    const views = await this.decorateStops(
      trips.flatMap((trip) => trip.stops),
      (stop) => this.stopActions(caller, statusByTrip.get(stop.tripId) ?? TripStatus.ABORTED, stop),
    );
    const byId = new Map(views.map((view) => [view.id, view]));
    return trips.map((trip) => ({
      ...trip,
      stops: trip.stops.map((stop) => byId.get(stop.id)).filter((view): view is StopView => view !== undefined),
    }));
  }

  private async decorateStops(stops: StopRow[], actions: (stop: StopRow) => StopAction[]): Promise<StopView[]> {
    if (stops.length === 0) return [];
    const coords = await this.prisma.$queryRaw<Array<{ id: string; lat: number | null; lng: number | null }>>`
      SELECT id, ST_Y(location) AS lat, ST_X(location) AS lng FROM trip_stops WHERE id = ANY(${stops.map((stop) => stop.id)}::uuid[])`;
    const byId = new Map(coords.map((row) => [row.id, row]));
    return stops.map((stop) => {
      const pin = byId.get(stop.id);
      const location =
        pin && pin.lat !== null && pin.lng !== null
          ? { coordinates: [pin.lng, pin.lat] as [number, number], lat: pin.lat, lng: pin.lng }
          : null;
      return { ...stop, location, allowedActions: actions(stop) };
    });
  }
}

/** True for a value of {@link TakeBackShortReason}. */
export function isTakeBackShortReason(value: unknown): value is TakeBackShortReason {
  return typeof value === 'string' && (TAKE_BACK_SHORT_REASONS as readonly string[]).includes(value);
}
