import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CustodyType,
  CylinderEventType,
  CylinderState,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface ScanInput {
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

const ALLOWED_TRANSITIONS: Record<CylinderEventType, Array<[CustodyType, CustodyType]>> = {
  SCAN_IN:                 [['DISTRIBUTOR', 'STORE'], ['VEHICLE', 'STORE']],
  SCAN_OUT:                [['STORE', 'VEHICLE']],
  DELIVERED:               [['VEHICLE', 'CLIENT']],
  PICKED_UP_EMPTY:         [['CLIENT', 'VEHICLE']],
  RETURNED_TO_DISTRIBUTOR: [['STORE', 'DISTRIBUTOR']],
  TRANSFER:                [['STORE', 'STORE']],
  MARK_FAULTY:             [['STORE', 'STORE'], ['VEHICLE', 'VEHICLE'], ['CLIENT', 'CLIENT'], ['DISTRIBUTOR', 'DISTRIBUTOR']],
  MARK_LOST:               [['STORE', 'STORE'], ['VEHICLE', 'VEHICLE'], ['CLIENT', 'CLIENT'], ['DISTRIBUTOR', 'DISTRIBUTOR']],
};

const STATE_AFTER: Partial<Record<CylinderEventType, CylinderState>> = {
  DELIVERED: CylinderState.EMPTY, // becomes empty once installed at client (assumption: cylinder is consumed)
  PICKED_UP_EMPTY: CylinderState.EMPTY,
  RETURNED_TO_DISTRIBUTOR: CylinderState.FULL, // refilled at distributor plant
  MARK_FAULTY: CylinderState.FAULTY,
  MARK_LOST: CylinderState.LOST,
};

@Injectable()
export class CustodyService {
  constructor(private prisma: PrismaService) {}

  async scan(input: ScanInput) {
    return this.prisma.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findUnique({ where: { qrCode: input.qrCode } });
      if (!cylinder) throw new NotFoundException(`Cylinder not found: ${input.qrCode}`);

      const fromType = cylinder.custodyType;
      const fromId = cylinder.custodyId;

      // Resolve the destination automatically using driver / order context, so
      // the mobile app only has to pass {qrCode, eventType, tripId, orderId}.
      // Order matters — for events that imply the driver's vehicle, we need
      // the driver's currentVehicleId, so look the driver up once up front.
      const driver = await tx.driver.findFirst({
        where: { userId: input.actorUserId },
        select: { id: true, currentVehicleId: true, user: { select: { id: true } } },
      });

      const toType = input.toCustodyType ?? this.inferToType(input.eventType, fromType);
      const toId =
        input.toCustodyId ??
        (await this.resolveToId({
          tx,
          eventType: input.eventType,
          fromType,
          fromId,
          cylinder,
          driver,
          tripId: input.tripId,
          orderId: input.orderId,
        }));

      const allowed = ALLOWED_TRANSITIONS[input.eventType] ?? [];
      const transitionOk = allowed.some(([f, t]) => f === fromType && t === toType);
      if (!transitionOk) {
        throw new BadRequestException(
          `Illegal transition ${fromType} → ${toType} for event ${input.eventType}. ` +
          `Cylinder is currently at ${fromType}; this event expects it to start somewhere else.`,
        );
      }

      // Enforce distributor-A cannot deliver distributor-B cylinder
      if (input.eventType === 'DELIVERED' && input.orderId) {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: { distributorId: true },
        });
        if (order && order.distributorId !== cylinder.distributorId) {
          throw new BadRequestException(
            'Cylinder owner mismatch — cannot deliver this distributor’s order with another distributor’s cylinder.',
          );
        }
      }

      const event = await tx.cylinderEvent.create({
        data: {
          cylinderId: cylinder.id,
          eventType: input.eventType,
          fromCustodyType: fromType,
          fromCustodyId: fromId,
          toCustodyType: toType,
          toCustodyId: toId,
          actorUserId: input.actorUserId,
          photoUrl: input.photoUrl,
          tripId: input.tripId,
          orderId: input.orderId,
          transferId: input.transferId,
        },
      });

      if (input.lat != null && input.lng != null) {
        await tx.$executeRaw`
          UPDATE cylinder_events
          SET location = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)
          WHERE id = ${event.id}::uuid
        `;
      }

      const newState = STATE_AFTER[input.eventType] ?? cylinder.state;

      await tx.cylinder.update({
        where: { id: cylinder.id },
        data: { custodyType: toType, custodyId: toId, state: newState },
      });

      // Inventory math
      await this.adjustInventory(tx, {
        distributorId: cylinder.distributorId,
        cylinderTypeId: cylinder.cylinderTypeId,
        from: { holderType: fromType, holderId: fromId, state: cylinder.state },
        to: { holderType: toType, holderId: toId, state: newState },
      });

      return { event, cylinderId: cylinder.id, newState, toType, toId };
    });
  }

  private inferToType(eventType: CylinderEventType, from: CustodyType): CustodyType {
    const map: Record<CylinderEventType, CustodyType> = {
      SCAN_IN: 'STORE',
      SCAN_OUT: 'VEHICLE',
      DELIVERED: 'CLIENT',
      PICKED_UP_EMPTY: 'VEHICLE',
      RETURNED_TO_DISTRIBUTOR: 'DISTRIBUTOR',
      TRANSFER: 'STORE',
      MARK_FAULTY: from,
      MARK_LOST: from,
    };
    return map[eventType];
  }

  /**
   * Resolve the destination custody id for the most common scans without
   * the mobile app having to pass it. Strategy by event:
   *
   *   SCAN_OUT (STORE → VEHICLE)              → driver's currentVehicleId
   *   DELIVERED (VEHICLE → CLIENT)            → order.clientId
   *   PICKED_UP_EMPTY (CLIENT → VEHICLE)      → driver's currentVehicleId
   *   RETURNED_TO_DISTRIBUTOR (STORE → DIST)  → cylinder.distributorId
   *   SCAN_IN (* → STORE)                     → trip.originStoreId (if any)
   *   TRANSFER (STORE → STORE)                → caller must pass it
   *   MARK_FAULTY / MARK_LOST                 → same as fromId
   *
   * Throws a clear, operator-actionable error if it can't figure it out.
   */
  private async resolveToId(p: {
    tx: any;
    eventType: CylinderEventType;
    fromType: CustodyType;
    fromId: string;
    cylinder: { distributorId: string };
    driver: { id: string; currentVehicleId: string | null } | null;
    tripId?: string;
    orderId?: string;
  }): Promise<string> {
    const { tx, eventType, fromId, cylinder, driver, tripId, orderId } = p;

    if (eventType === 'MARK_FAULTY' || eventType === 'MARK_LOST') return fromId;

    if (eventType === 'SCAN_OUT' || eventType === 'PICKED_UP_EMPTY') {
      if (!driver) {
        throw new BadRequestException('Only drivers can perform vehicle-bound scans.');
      }
      if (!driver.currentVehicleId) {
        throw new BadRequestException(
          'Driver has no vehicle assigned. Ask admin to assign one in Vehicles → Assign drivers.',
        );
      }
      return driver.currentVehicleId;
    }

    if (eventType === 'DELIVERED') {
      if (!orderId) {
        throw new BadRequestException(
          'Delivery scan requires an orderId so we know which client receives the cylinder. Open the delivery from My Trips and tap "Mark delivered" instead of opening Scan directly.',
        );
      }
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { clientId: true } });
      if (!order?.clientId) {
        throw new BadRequestException('Order has no client — cannot resolve delivery destination.');
      }
      return order.clientId;
    }

    if (eventType === 'RETURNED_TO_DISTRIBUTOR') {
      // Cylinder always knows its owning distributor.
      return cylinder.distributorId;
    }

    if (eventType === 'SCAN_IN') {
      // Use the trip's origin store, the only deterministic "where" we have
      // without an explicit picker on the driver app.
      if (tripId) {
        const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { originStoreId: true } });
        if (trip?.originStoreId) return trip.originStoreId;
      }
      throw new BadRequestException(
        'SCAN_IN needs a tripId so we can resolve which store this is coming back to.',
      );
    }

    // TRANSFER + anything new — require explicit destination.
    throw new BadRequestException(
      `Could not figure out where the cylinder is going for ${eventType}. Pass toCustodyId explicitly.`,
    );
  }

  private async adjustInventory(
    tx: any,
    p: {
      distributorId: string;
      cylinderTypeId: string;
      from: { holderType: CustodyType; holderId: string; state: CylinderState };
      to: { holderType: CustodyType; holderId: string; state: CylinderState };
    },
  ) {
    // -1 from origin. Guard against going negative — if the origin lot is
    // missing or already 0 (e.g. legacy data registered before inventory
    // seeding), clamp at 0 instead of drifting negative.
    if (p.from.state !== CylinderState.FAULTY && p.from.state !== CylinderState.LOST) {
      const existing = await tx.inventoryLot.findUnique({
        where: {
          inventory_unique: {
            holderType: p.from.holderType,
            holderId: p.from.holderId,
            distributorId: p.distributorId,
            cylinderTypeId: p.cylinderTypeId,
            state: p.from.state,
          },
        },
      });
      const nextFrom = Math.max(0, (existing?.count ?? 0) - 1);
      await tx.inventoryLot.upsert({
        where: {
          inventory_unique: {
            holderType: p.from.holderType,
            holderId: p.from.holderId,
            distributorId: p.distributorId,
            cylinderTypeId: p.cylinderTypeId,
            state: p.from.state,
          },
        },
        update: { count: nextFrom },
        create: {
          holderType: p.from.holderType,
          holderId: p.from.holderId,
          distributorId: p.distributorId,
          cylinderTypeId: p.cylinderTypeId,
          state: p.from.state,
          count: 0,
        },
      });
    }
    // +1 to destination
    if (p.to.state !== CylinderState.FAULTY && p.to.state !== CylinderState.LOST) {
      await tx.inventoryLot.upsert({
        where: {
          inventory_unique: {
            holderType: p.to.holderType,
            holderId: p.to.holderId,
            distributorId: p.distributorId,
            cylinderTypeId: p.cylinderTypeId,
            state: p.to.state,
          },
        },
        update: { count: { increment: 1 } },
        create: {
          holderType: p.to.holderType,
          holderId: p.to.holderId,
          distributorId: p.distributorId,
          cylinderTypeId: p.cylinderTypeId,
          state: p.to.state,
          count: 1,
        },
      });
    }
  }

  history(cylinderId: string) {
    return this.prisma.cylinderEvent.findMany({
      where: { cylinderId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
