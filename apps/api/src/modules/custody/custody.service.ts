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

      const toType = input.toCustodyType ?? this.inferToType(input.eventType, fromType);
      const toId =
        input.toCustodyId ??
        this.inferToId(input.eventType, fromType, fromId, input);

      const allowed = ALLOWED_TRANSITIONS[input.eventType] ?? [];
      const transitionOk = allowed.some(([f, t]) => f === fromType && t === toType);
      if (!transitionOk) {
        throw new BadRequestException(
          `Illegal transition ${fromType} → ${toType} for event ${input.eventType}`,
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

  private inferToId(
    eventType: CylinderEventType,
    fromType: CustodyType,
    fromId: string,
    input: ScanInput,
  ): string {
    // Caller usually supplies toCustodyId. Fallbacks:
    if (input.toCustodyId) return input.toCustodyId;
    if (eventType === 'MARK_FAULTY' || eventType === 'MARK_LOST') return fromId;
    if (eventType === 'PICKED_UP_EMPTY' && input.tripId) return input.tripId; // surrogate: caller should pass vehicleId
    throw new BadRequestException('toCustodyId required for this event');
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
    // -1 from origin
    if (p.from.state !== CylinderState.FAULTY && p.from.state !== CylinderState.LOST) {
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
        update: { count: { decrement: 1 } },
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
