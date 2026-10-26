import { Injectable } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState, TripStatus, TripStopStatus, TripStopType, type CylinderEvent } from '@prisma/client';
import type { CustodyScanInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDriverId } from '../../common/auth/own-driver-id';
import { canActOnTrip, canSeeCylinder, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { adjustInventoryLots } from './inventory-lots';
import { ScanService, type DriverScanAction } from './scan.service';

/** The answer of the legacy scan route; installed apps read `newState` and `toType`. */
export interface LegacyScanResult {
  event: CylinderEvent;
  cylinderId: string;
  newState: CylinderState;
  toType: CustodyType;
  toId: string;
  /** Present on a repeat of a move already recorded. */
  alreadyRecorded?: true;
}

/**
 * @deprecated The pre-pilot scan input. Only the switched-off transfers module still builds it; the
 * driver's legacy route uses {@link CustodyService.legacyScan}.
 */
export interface ScanInput {
  qrCode: string;
  eventType: CylinderEventType;
  actorUserId: string;
  toCustodyType?: CustodyType;
  toCustodyId?: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
  tripId?: string;
  orderId?: string;
  transferId?: string;
}

const OPEN_TRIP: TripStatus[] = [TripStatus.PLANNED, TripStatus.IN_PROGRESS];

/**
 * Cylinder custody (API_CONTRACT §7.7, §9.10). From Inc 2 the installed app's legacy scan route
 * delegates to the {@link ScanService}: its holder rules, its locks and its answers. Nothing here
 * moves money.
 */
@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scans: ScanService,
  ) {}

  /**
   * Legacy `POST /custody/scan` (DRIVER exact, the installed 0.1.0 app), mapped onto the Inc 2 scan
   * service (§9.10): SCAN_OUT is a LOAD at the trip's STORE_PICKUP stop (after "Done loading" it gives
   * 409 SCAN_STOP_CLOSED); DELIVERED is a HANDOVER and PICKED_UP_EMPTY a TAKE_BACK with returnState
   * EMPTY, at the order's DELIVERY stop on that trip; SCAN_IN is 403 SCAN_USE_STORE_RECEIVE (the store
   * scans returns in). The body has no scan id, so a repeat is found by the same-move test only (200
   * `X-Already-Applied` with `alreadyRecorded: true`). Checks before the delegation, in order: the trip
   * is the caller's (404) and open (409 SCAN_TRIP_CLOSED); the order is on the trip (403).
   */
  async legacyScan(actor: UserActor, body: CustodyScanInput): Promise<LegacyScanResult | IdempotentResponse<LegacyScanResult>> {
    ownDriverId(actor);
    const trip = canActOnTrip(
      actor,
      await this.prisma.trip.findUnique({ where: { id: body.tripId }, select: { id: true, driverId: true, status: true } }),
    );
    if (body.eventType === 'SCAN_IN') throw new AppError('SCAN_USE_STORE_RECEIVE');
    if (!OPEN_TRIP.includes(trip.status)) throw new AppError('SCAN_TRIP_CLOSED');
    if (body.orderId) {
      const onTrip = await this.prisma.order.findFirst({ where: { id: body.orderId, tripId: trip.id }, select: { id: true } });
      if (!onTrip) throw new AppError('ORDER_NOT_ON_YOUR_TRIP');
    }

    let action: DriverScanAction;
    let stopId: string;
    if (body.eventType === 'SCAN_OUT') {
      action = 'LOAD';
      const pickup = await this.prisma.tripStop.findFirst({
        where: { tripId: trip.id, stopType: TripStopType.STORE_PICKUP },
        orderBy: { seq: 'asc' },
        select: { id: true },
      });
      if (!pickup) throw new AppError('SCAN_EVENT_NOT_ALLOWED');
      stopId = pickup.id;
    } else {
      action = body.eventType === 'DELIVERED' ? 'HANDOVER' : 'TAKE_BACK';
      // The schema requires orderId for these two.
      const stops = await this.prisma.tripStop.findMany({
        where: { tripId: trip.id, orderId: body.orderId as string, stopType: TripStopType.DELIVERY },
        orderBy: { seq: 'asc' },
        select: { id: true, status: true },
      });
      const stop = stops.find((s) => s.status === TripStopStatus.PENDING || s.status === TripStopStatus.ARRIVED) ?? stops[stops.length - 1];
      if (!stop) throw new AppError('ORDER_NOT_ON_YOUR_TRIP');
      stopId = stop.id;
    }

    const answer = await this.scans.driverScan(actor, {
      action,
      tripId: trip.id,
      stopId,
      scanId: null,
      code: body.qrCode,
      entryMethod: 'QR',
      returnState: action === 'TAKE_BACK' ? 'EMPTY' : undefined,
      lat: body.lat,
      lng: body.lng,
    });
    const cylinder = await this.prisma.cylinder.findUniqueOrThrow({
      where: { id: answer.result.cylinder.id },
      select: { id: true, state: true, custodyType: true, custodyId: true },
    });
    const event = answer.event ?? (await this.prisma.cylinderEvent.findFirstOrThrow({ where: { cylinderId: cylinder.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    const result: LegacyScanResult = {
      event,
      cylinderId: cylinder.id,
      newState: cylinder.state,
      toType: cylinder.custodyType,
      toId: cylinder.custodyId,
    };
    return answer.kind === 'RECORDED' ? result : alreadyApplied({ ...result, alreadyRecorded: true as const });
  }

  /** `GET /custody/cylinders/:id/history`: the office or the owning distributor (404 otherwise). */
  async history(caller: PolicyCaller, cylinderId: string): Promise<CylinderEvent[]> {
    canSeeCylinder(caller, await this.prisma.cylinder.findUnique({ where: { id: cylinderId }, select: { distributorId: true } }));
    return this.prisma.cylinderEvent.findMany({
      where: { cylinderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * @deprecated The pre-pilot free scan. Only the switched-off transfers module calls it (its writes
   * answer 403 FEATURE_DISABLED while `features.transfers` is off); no driver route reaches it.
   */
  async scan(input: ScanInput) {
    return this.prisma.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findUnique({ where: { qrCode: input.qrCode } });
      if (!cylinder) throw new AppError('SCAN_CYLINDER_UNKNOWN');
      if (!input.toCustodyType || !input.toCustodyId) throw new AppError('SCAN_EVENT_NOT_ALLOWED');
      const event = await tx.cylinderEvent.create({
        data: {
          cylinderId: cylinder.id,
          eventType: input.eventType,
          fromCustodyType: cylinder.custodyType,
          fromCustodyId: cylinder.custodyId,
          toCustodyType: input.toCustodyType,
          toCustodyId: input.toCustodyId,
          fromState: cylinder.state,
          toState: cylinder.state,
          actorUserId: input.actorUserId,
          photoUrl: input.photoUrl,
          tripId: input.tripId,
          orderId: input.orderId,
          transferId: input.transferId,
        },
      });
      await tx.cylinder.update({
        where: { id: cylinder.id },
        data: { custodyType: input.toCustodyType, custodyId: input.toCustodyId, lastEventId: event.id },
      });
      await adjustInventoryLots(tx, {
        distributorId: cylinder.distributorId,
        cylinderTypeId: cylinder.cylinderTypeId,
        from: { holderType: cylinder.custodyType, holderId: cylinder.custodyId, state: cylinder.state },
        to: { holderType: input.toCustodyType, holderId: input.toCustodyId, state: cylinder.state },
      });
      return { event, cylinderId: cylinder.id, newState: cylinder.state, toType: input.toCustodyType, toId: input.toCustodyId };
    });
  }
}
