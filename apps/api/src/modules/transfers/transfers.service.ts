import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyType, CylinderEventType, TransferStatus } from '@prisma/client';
import { CustodyService } from '../custody/custody.service';

@Injectable()
export class TransfersService {
  constructor(
    private prisma: PrismaService,
    private custody: CustodyService,
  ) {}

  list() {
    return this.prisma.transfer.findMany({
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      include: {
        fromStore: true,
        toStore: true,
        vehicle: true,
        driver: { include: { user: true } },
        lines: true,
      },
    });
  }

  // Stock summary for a "from store": full + empty counts grouped by distributor × cylinder type.
  // Drives the roll-plan UI so the operator can see what's available before scheduling a transfer.
  async stockSummary(storeId: string) {
    const rows: Array<{
      distributor_id: string;
      distributor_name: string;
      cylinder_type_id: string;
      cylinder_type_code: string;
      cylinder_type_name: string;
      state: 'FULL' | 'EMPTY';
      count: number;
    }> = await this.prisma.$queryRaw`
      SELECT d.id AS distributor_id, d.business_name AS distributor_name,
             ct.id AS cylinder_type_id, ct.code AS cylinder_type_code, ct.name AS cylinder_type_name,
             il.state AS state,
             SUM(il.count)::int AS count
      FROM inventory_lots il
      JOIN distributors d ON d.id = il.distributor_id
      JOIN cylinder_types ct ON ct.id = il.cylinder_type_id
      WHERE il.holder_type = 'STORE'
        AND il.holder_id = ${storeId}::uuid
        AND il.count > 0
      GROUP BY d.id, d.business_name, ct.id, ct.code, ct.name, il.state
      ORDER BY d.business_name, ct.name, il.state
    `;
    return rows;
  }

  create(input: {
    fromStoreId: string;
    toStoreId: string;
    cylinderIds: string[];
    vehicleId?: string;
    driverId?: string;
    scheduledFor?: string;
    notes?: string;
    requestedBy: string;
  }) {
    return this.prisma.transfer.create({
      data: {
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
        notes: input.notes,
        requestedBy: input.requestedBy,
        status: TransferStatus.REQUESTED,
        lines: { create: input.cylinderIds.map((cid) => ({ cylinderId: cid })) },
      },
      include: {
        lines: true,
        fromStore: true,
        toStore: true,
        driver: { include: { user: true } },
      },
    });
  }

  setStatus(id: string, status: TransferStatus) {
    return this.prisma.transfer.update({
      where: { id },
      data: {
        status,
        completedAt: status === TransferStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  // Driver app: scheduled/in-flight transfers assigned to the signed-in driver.
  listForDriver(driverId: string) {
    return this.prisma.transfer.findMany({
      where: {
        driverId,
        status: { in: [TransferStatus.REQUESTED, TransferStatus.IN_TRANSIT] },
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
      include: {
        fromStore: true,
        toStore: true,
        lines: {
          include: {
            cylinder: {
              include: { cylinderType: true },
            },
          },
        },
      },
    });
  }

  // Full detail for one transfer — used by the driver detail/scan screen so
  // it can show pickup/dropoff progress per cylinder.
  // Driver-app scan: combines validation + chain-of-custody update.
  // - PICKUP: cylinder must be at fromStore, moves STORE → VEHICLE via SCAN_OUT.
  // - DROPOFF: cylinder must be on the driver's vehicle, moves VEHICLE → STORE via SCAN_IN.
  // Also auto-advances the Transfer status (REQUESTED → IN_TRANSIT on first pickup,
  // IN_TRANSIT → COMPLETED when every line has reached the destination store).
  async scanForDriver(input: {
    transferId: string;
    qrCode: string;
    phase: 'PICKUP' | 'DROPOFF';
    actorUserId: string;
    driverId: string;
    lat?: number;
    lng?: number;
  }) {
    const t = await this.byId(input.transferId);
    if (t.driverId !== input.driverId) {
      throw new BadRequestException('This transfer is not assigned to you.');
    }
    if (t.status === TransferStatus.CANCELLED || t.status === TransferStatus.COMPLETED) {
      throw new BadRequestException(`Transfer is already ${t.status}.`);
    }

    // Resolve the driver's current vehicle — required to know where cylinders go on pickup.
    const driver = await this.prisma.driver.findUnique({
      where: { id: input.driverId },
      select: { currentVehicleId: true, user: { select: { name: true } } },
    });
    const vehicleId = t.vehicleId ?? driver?.currentVehicleId ?? null;
    if (!vehicleId) {
      throw new BadRequestException(
        'No vehicle linked to this transfer or driver. Ask admin to assign one on the Vehicles page.',
      );
    }

    // Confirm scanned QR is one of this transfer's cylinders.
    const cylinder = await this.prisma.cylinder.findUnique({ where: { qrCode: input.qrCode } });
    if (!cylinder) throw new NotFoundException(`Cylinder not found for QR: ${input.qrCode}`);
    const line = t.lines.find((l) => l.cylinderId === cylinder.id);
    if (!line) {
      throw new BadRequestException(
        'That cylinder is not part of this transfer — double-check the QR or pick the right transfer.',
      );
    }

    let eventType: CylinderEventType;
    let toCustodyType: CustodyType;
    let toCustodyId: string;

    if (input.phase === 'PICKUP') {
      if (cylinder.custodyType === 'VEHICLE' && cylinder.custodyId === vehicleId) {
        throw new BadRequestException('Already picked up — scan it at the destination store next.');
      }
      if (cylinder.custodyType !== 'STORE' || cylinder.custodyId !== t.fromStoreId) {
        throw new BadRequestException(
          `Cylinder is not at the source store — current custody: ${cylinder.custodyType}.`,
        );
      }
      eventType = CylinderEventType.SCAN_OUT;
      toCustodyType = CustodyType.VEHICLE;
      toCustodyId = vehicleId;
    } else {
      if (cylinder.custodyType === 'STORE' && cylinder.custodyId === t.toStoreId) {
        throw new BadRequestException('Already delivered to the destination store.');
      }
      if (cylinder.custodyType !== 'VEHICLE' || cylinder.custodyId !== vehicleId) {
        throw new BadRequestException(
          `Cylinder is not on your vehicle — pick it up at the source store first.`,
        );
      }
      eventType = CylinderEventType.SCAN_IN;
      toCustodyType = CustodyType.STORE;
      toCustodyId = t.toStoreId;
    }

    const scan = await this.custody.scan({
      qrCode: input.qrCode,
      eventType,
      toCustodyType,
      toCustodyId,
      transferId: t.id,
      actorUserId: input.actorUserId,
      lat: input.lat,
      lng: input.lng,
    });

    // Auto-advance transfer status based on the new aggregate state.
    const progress = await this.progress(t.id);
    let nextStatus: TransferStatus | undefined;
    if (t.status === TransferStatus.REQUESTED && progress.onVehicle > 0) {
      nextStatus = TransferStatus.IN_TRANSIT;
    } else if (progress.phase === 'DONE') {
      nextStatus = TransferStatus.COMPLETED;
    }
    if (nextStatus && nextStatus !== t.status) {
      await this.prisma.transfer.update({
        where: { id: t.id },
        data: {
          status: nextStatus,
          completedAt: nextStatus === TransferStatus.COMPLETED ? new Date() : undefined,
        },
      });
    }

    return { scan, progress, transferStatus: nextStatus ?? t.status };
  }

  async byId(id: string) {
    const t = await this.prisma.transfer.findUnique({
      where: { id },
      include: {
        fromStore: true,
        toStore: true,
        driver: { include: { user: true } },
        vehicle: true,
        lines: {
          include: {
            cylinder: {
              include: { cylinderType: true },
            },
          },
        },
      },
    });
    if (!t) throw new NotFoundException('Transfer not found');
    return t;
  }

  // Driver-app helper: figure out the transfer's phase from the line states.
  // - PICKUP: any line still custodied at fromStore
  // - DROPOFF: all picked up, but at least one still on the vehicle
  // - DONE: every line now at toStore
  async progress(id: string) {
    const t = await this.byId(id);
    let atFrom = 0, onVehicle = 0, atTo = 0, other = 0;
    for (const line of t.lines) {
      const c = line.cylinder;
      if (!c) { other += 1; continue; }
      if (c.custodyType === 'STORE' && c.custodyId === t.fromStoreId) atFrom += 1;
      else if (c.custodyType === 'VEHICLE') onVehicle += 1;
      else if (c.custodyType === 'STORE' && c.custodyId === t.toStoreId) atTo += 1;
      else other += 1;
    }
    return {
      total: t.lines.length,
      atFromStore: atFrom,
      onVehicle,
      atDestinationStore: atTo,
      misrouted: other,
      phase: atFrom > 0 ? 'PICKUP' : onVehicle > 0 ? 'DROPOFF' : 'DONE',
    } as const;
  }
}
