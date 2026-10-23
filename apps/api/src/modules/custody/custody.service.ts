import { Injectable } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState, Prisma, type CylinderEvent } from '@prisma/client';
import type { CustodyScanInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { canActOnTrip, canSeeCylinder, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { lockTripOrders, stampLoadStarted } from '../orders/order-writes';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { autoStartTrip } from '../trips/trip-writes';

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

interface LockedTrip {
  id: string;
  status: string;
  driver_id: string;
  vehicle_id: string;
  origin_store_id: string;
}

interface LockedCylinder {
  id: string;
  distributor_id: string;
  cylinder_type_id: string;
  state: CylinderState;
  custody_type: CustodyType;
  custody_id: string;
}

const BLOCKED: CylinderState[] = [CylinderState.FAULTY, CylinderState.LOST];

/**
 * Cylinder custody (API_CONTRACT §7.7; ScanService in Inc 2). Every holder change is a scan of the
 * cylinder's QR value, recorded as one event; the destination is always derived on the server.
 * Nothing here moves money: a load scan only marks delivery as started.
 */
@Injectable()
export class CustodyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Legacy `POST /custody/scan` (DRIVER exact), locked down for Inc 1. Checks in the §9.2 order: the
   * trip is the caller's (404) and open (409 SCAN_TRIP_CLOSED), a SCAN_OUT first locking the trip's
   * orders; the order is on the trip (403 ORDER_NOT_ON_YOUR_TRIP); the QR value is known (404); the
   * cylinder locked; its owner (409 SCAN_WRONG_OWNER); the same move again (200 `X-Already-Applied`);
   * FAULTY or LOST blocked for SCAN_OUT and DELIVERED; then the event's own rules. The van is always
   * the trip's van, never the driver's current one.
   */
  async legacyScan(actor: UserActor, body: CustodyScanInput): Promise<LegacyScanResult | IdempotentResponse<LegacyScanResult>> {
    return this.prisma.$transaction(async (tx) => {
      // Locks: orders first, then the trip, then the cylinder (a cancel or a reassignment locks the same orders).
      if (body.eventType === 'SCAN_OUT') await lockTripOrders(tx, body.tripId);
      const trips = await tx.$queryRaw<LockedTrip[]>`
        SELECT id, status, driver_id, vehicle_id, origin_store_id FROM trips WHERE id = ${body.tripId}::uuid FOR UPDATE`;
      const trip = canActOnTrip(actor, trips[0] ? { ...trips[0], driverId: trips[0].driver_id } : null);
      if (trip.status !== 'PLANNED' && trip.status !== 'IN_PROGRESS') throw new AppError('SCAN_TRIP_CLOSED');

      let order: { id: string; distributorId: string; clientId: string } | null = null;
      if (body.orderId) {
        order = await tx.order.findFirst({
          where: { id: body.orderId, tripId: trip.id },
          select: { id: true, distributorId: true, clientId: true },
        });
        if (!order) throw new AppError('ORDER_NOT_ON_YOUR_TRIP');
      }

      const known = await tx.cylinder.findUnique({ where: { qrCode: body.qrCode }, select: { id: true } });
      if (!known) throw new AppError('SCAN_CYLINDER_UNKNOWN');
      const locked = await tx.$queryRaw<LockedCylinder[]>`
        SELECT id, distributor_id, cylinder_type_id, state, custody_type, custody_id
        FROM cylinders WHERE id = ${known.id}::uuid FOR UPDATE`;
      const cylinder = locked[0];

      const owner =
        body.eventType === 'SCAN_OUT' || body.eventType === 'SCAN_IN' ? await this.tripDistributorId(tx, trip) : order?.distributorId ?? null;
      if (!owner || cylinder.distributor_id !== owner) throw new AppError('SCAN_WRONG_OWNER');

      const last = await tx.cylinderEvent.findFirst({
        where: { cylinderId: cylinder.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (
        last &&
        last.eventType === body.eventType &&
        last.tripId === trip.id &&
        (last.orderId ?? null) === (body.orderId ?? null) &&
        last.toCustodyType === cylinder.custody_type &&
        last.toCustodyId === cylinder.custody_id
      ) {
        return alreadyApplied<LegacyScanResult>({
          event: last,
          cylinderId: cylinder.id,
          newState: cylinder.state,
          toType: cylinder.custody_type,
          toId: cylinder.custody_id,
          alreadyRecorded: true,
        });
      }

      if (BLOCKED.includes(cylinder.state) && (body.eventType === 'SCAN_OUT' || body.eventType === 'DELIVERED')) {
        throw new AppError('SCAN_CYLINDER_BLOCKED');
      }

      const move = await this.legacyMove(tx, body, trip, cylinder, order);
      const event = await tx.cylinderEvent.create({
        data: {
          cylinderId: cylinder.id,
          eventType: body.eventType,
          fromCustodyType: cylinder.custody_type,
          fromCustodyId: cylinder.custody_id,
          toCustodyType: move.toType,
          toCustodyId: move.toId,
          actorUserId: actor.userId,
          tripId: trip.id,
          orderId: body.orderId ?? null,
        },
      });
      if (body.lat !== undefined && body.lng !== undefined) {
        await tx.$executeRaw`
          UPDATE cylinder_events SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
          WHERE id = ${event.id}::uuid`;
      }
      await tx.cylinder.update({
        where: { id: cylinder.id },
        data: { custodyType: move.toType, custodyId: move.toId, state: move.newState },
      });
      await this.adjustInventory(tx, {
        distributorId: cylinder.distributor_id,
        cylinderTypeId: cylinder.cylinder_type_id,
        from: { holderType: cylinder.custody_type, holderId: cylinder.custody_id, state: cylinder.state },
        to: { holderType: move.toType, holderId: move.toId, state: move.newState },
      });
      if (body.eventType === 'SCAN_OUT') {
        // The first load scan on the trip: delivery has started for its open orders (refund cut-off).
        await stampLoadStarted(tx, trip.id);
        await autoStartTrip(tx, trip.id);
      }
      return { event, cylinderId: cylinder.id, newState: move.newState, toType: move.toType, toId: move.toId };
    }, LOCKING_TX);
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
          actorUserId: input.actorUserId,
          photoUrl: input.photoUrl,
          tripId: input.tripId,
          orderId: input.orderId,
          transferId: input.transferId,
        },
      });
      await tx.cylinder.update({ where: { id: cylinder.id }, data: { custodyType: input.toCustodyType, custodyId: input.toCustodyId } });
      await this.adjustInventory(tx, {
        distributorId: cylinder.distributorId,
        cylinderTypeId: cylinder.cylinderTypeId,
        from: { holderType: cylinder.custodyType, holderId: cylinder.custodyId, state: cylinder.state },
        to: { holderType: input.toCustodyType, holderId: input.toCustodyId, state: cylinder.state },
      });
      return { event, cylinderId: cylinder.id, newState: cylinder.state, toType: input.toCustodyType, toId: input.toCustodyId };
    });
  }

  // ---------- internals ----------

  /** The rules of each legacy event (§7.7 table) and where the cylinder goes. */
  private async legacyMove(
    tx: Tx,
    body: CustodyScanInput,
    trip: LockedTrip,
    cylinder: LockedCylinder,
    order: { id: string; distributorId: string; clientId: string } | null,
  ): Promise<{ toType: CustodyType; toId: string; newState: CylinderState }> {
    switch (body.eventType) {
      case 'SCAN_OUT': {
        if (cylinder.custody_type !== CustodyType.STORE || cylinder.custody_id !== trip.origin_store_id) {
          const store = await tx.store.findUnique({ where: { id: trip.origin_store_id }, select: { name: true } });
          throw new AppError('SCAN_NOT_AT_STORE', { store: store?.name ?? '' });
        }
        if (cylinder.state !== CylinderState.FULL) throw new AppError('SCAN_NOT_FULL');
        return { toType: CustodyType.VEHICLE, toId: trip.vehicle_id, newState: cylinder.state };
      }
      case 'DELIVERED': {
        if (cylinder.custody_type !== CustodyType.VEHICLE || cylinder.custody_id !== trip.vehicle_id) throw new AppError('SCAN_NOT_ON_YOUR_VAN');
        if (cylinder.state !== CylinderState.FULL) throw new AppError('SCAN_NOT_FULL');
        // A handed-over cylinder stays FULL: it is the customer's full cylinder now.
        return { toType: CustodyType.CLIENT, toId: (order as { clientId: string }).clientId, newState: CylinderState.FULL };
      }
      case 'PICKED_UP_EMPTY': {
        const customer = (order as { id: string; clientId: string });
        if (cylinder.custody_type !== CustodyType.CLIENT || cylinder.custody_id !== customer.clientId) {
          throw new AppError('SCAN_NOT_WITH_THIS_CUSTOMER');
        }
        const given = await tx.cylinderEvent.count({
          where: { cylinderId: cylinder.id, orderId: customer.id, eventType: CylinderEventType.DELIVERED },
        });
        if (given > 0) throw new AppError('SCAN_GIVEN_THIS_VISIT');
        // A damaged or lost cylinder keeps its state; any other comes back EMPTY.
        const newState = BLOCKED.includes(cylinder.state) ? cylinder.state : CylinderState.EMPTY;
        return { toType: CustodyType.VEHICLE, toId: trip.vehicle_id, newState };
      }
      case 'SCAN_IN': {
        if (cylinder.custody_type !== CustodyType.VEHICLE || cylinder.custody_id !== trip.vehicle_id) throw new AppError('SCAN_NOT_ON_YOUR_VAN');
        return { toType: CustodyType.STORE, toId: trip.origin_store_id, newState: cylinder.state };
      }
    }
  }

  /** The distributor whose store the trip starts at (its one store), else the distributor of its orders. */
  private async tripDistributorId(tx: Tx, trip: LockedTrip): Promise<string | null> {
    const store = await tx.distributor.findUnique({ where: { homeStoreId: trip.origin_store_id }, select: { id: true } });
    if (store) return store.id;
    const order = await tx.order.findFirst({ where: { tripId: trip.id }, select: { distributorId: true } });
    return order?.distributorId ?? null;
  }

  /**
   * Keeps the legacy inventory lots in step with each move (the Inc 1 inventory screens read them).
   * Damaged and lost cylinders aren't counted; an origin lot never goes below 0. Each count changes in
   * one guarded statement, never by read-modify-write: drivers loading at one store at the same moment
   * lock only their own trips and cylinders, so a read count could be stale by the time it is written.
   */
  private async adjustInventory(
    tx: Tx,
    p: {
      distributorId: string;
      cylinderTypeId: string;
      from: { holderType: CustodyType; holderId: string; state: CylinderState };
      to: { holderType: CustodyType; holderId: string; state: CylinderState };
    },
  ): Promise<void> {
    if (!BLOCKED.includes(p.from.state)) {
      const key = await this.ensureLot(tx, p.distributorId, p.cylinderTypeId, p.from);
      await tx.inventoryLot.updateMany({ where: { ...key, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
    }
    if (!BLOCKED.includes(p.to.state)) {
      const key = await this.ensureLot(tx, p.distributorId, p.cylinderTypeId, p.to);
      await tx.inventoryLot.updateMany({ where: key, data: { count: { increment: 1 } } });
    }
  }

  /** Makes sure a lot row exists (at 0 when new; a racing insert of the same lot is skipped) and returns its key. */
  private async ensureLot(
    tx: Tx,
    distributorId: string,
    cylinderTypeId: string,
    holder: { holderType: CustodyType; holderId: string; state: CylinderState },
  ): Promise<Prisma.InventoryLotInventory_uniqueCompoundUniqueInput> {
    const key: Prisma.InventoryLotInventory_uniqueCompoundUniqueInput = {
      holderType: holder.holderType,
      holderId: holder.holderId,
      distributorId,
      cylinderTypeId,
      state: holder.state,
    };
    await tx.inventoryLot.createMany({ data: [{ ...key, count: 0 }], skipDuplicates: true });
    return key;
  }
}
