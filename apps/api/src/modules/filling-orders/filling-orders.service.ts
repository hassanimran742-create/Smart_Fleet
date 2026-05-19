import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DriverAvailability,
  FillingOrderStatus,
  LedgerEntryType,
} from '@prisma/client';

@Injectable()
export class FillingOrdersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Distributor (or admin acting on their behalf) requests N cylinders
   * to be refilled at a given station. The estimated cost is computed
   * and the distributor's advance balance is checked at creation —
   * we don't reserve funds at this point; the actual debit happens
   * when the order COMPLETES.
   */
  async create(input: {
    distributorId: string;
    fillingStationId: string;
    cylinderTypeId: string;
    requestedCount: number;
    pickupStoreId?: string;
  }) {
    if (input.requestedCount <= 0) {
      throw new BadRequestException('requestedCount must be > 0');
    }
    const [distributor, station] = await Promise.all([
      this.prisma.distributor.findUnique({ where: { id: input.distributorId } }),
      this.prisma.fillingStation.findUnique({ where: { id: input.fillingStationId } }),
    ]);
    if (!distributor) throw new NotFoundException('Distributor not found');
    if (!station) throw new NotFoundException('Filling station not found');

    const pricePerCylinder = station.pricePerCylinderPaisa;
    const totalCost = pricePerCylinder * BigInt(input.requestedCount);
    if (distributor.advanceBalancePaisa < totalCost) {
      throw new BadRequestException(
        `Insufficient advance balance. Required Rs. ${Number(totalCost) / 100}, available Rs. ${Number(distributor.advanceBalancePaisa) / 100}. Top up before placing this filling order.`,
      );
    }

    return this.prisma.fillingOrder.create({
      data: {
        distributorId: input.distributorId,
        fillingStationId: input.fillingStationId,
        cylinderTypeId: input.cylinderTypeId,
        requestedCount: input.requestedCount,
        pricePerCylinderPaisa: pricePerCylinder,
        totalCostPaisa: totalCost,
        pickupStoreId: input.pickupStoreId ?? distributor.homeStoreId,
      },
      include: { fillingStation: true, cylinderType: true, distributor: true },
    });
  }

  list(opts: { status?: FillingOrderStatus; distributorId?: string; driverId?: string } = {}) {
    return this.prisma.fillingOrder.findMany({
      where: {
        status: opts.status,
        distributorId: opts.distributorId,
        assignedDriverId: opts.driverId,
      },
      include: {
        distributor: { include: { user: true } },
        fillingStation: true,
        cylinderType: true,
        assignedDriver: { include: { user: true } },
        assignedVehicle: true,
        pickupStore: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async byId(id: string) {
    const o = await this.prisma.fillingOrder.findUnique({
      where: { id },
      include: {
        distributor: { include: { user: true } },
        fillingStation: true,
        cylinderType: true,
        assignedDriver: { include: { user: true } },
        assignedVehicle: true,
        pickupStore: true,
      },
    });
    if (!o) throw new NotFoundException();
    return o;
  }

  /**
   * Admin assigns a driver. Driver must be AVAILABLE and online.
   * Only PENDING orders can be assigned. Batching = call assign()
   * with the same driverId multiple times across different orders.
   */
  async assign(orderId: string, driverId: string) {
    const order = await this.prisma.fillingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status !== FillingOrderStatus.PENDING) {
      throw new BadRequestException(`Cannot assign in ${order.status} state`);
    }
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');
    if (driver.availability !== DriverAvailability.AVAILABLE) {
      throw new ForbiddenException(`Driver is ${driver.availability}; can't be assigned a filling run.`);
    }
    return this.prisma.fillingOrder.update({
      where: { id: orderId },
      data: {
        assignedDriverId: driverId,
        assignedVehicleId: driver.currentVehicleId,
        status: FillingOrderStatus.ASSIGNED,
      },
      include: { fillingStation: true, cylinderType: true, distributor: true },
    });
  }

  /** Driver picked up empties from the distributor store. */
  async markPickedEmpties(orderId: string, emptyCount: number) {
    const order = await this.prisma.fillingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status !== FillingOrderStatus.ASSIGNED) {
      throw new BadRequestException(`Cannot mark empties picked in ${order.status} state`);
    }
    return this.prisma.fillingOrder.update({
      where: { id: orderId },
      data: { pickedUpEmptyCount: emptyCount, status: FillingOrderStatus.EMPTIES_PICKED },
    });
  }

  /** Driver arrived at the filling station. */
  async markAtStation(orderId: string) {
    const order = await this.prisma.fillingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status !== FillingOrderStatus.EMPTIES_PICKED) {
      throw new BadRequestException(`Cannot mark AT_STATION in ${order.status} state`);
    }
    return this.prisma.fillingOrder.update({
      where: { id: orderId },
      data: { status: FillingOrderStatus.AT_STATION },
    });
  }

  /** Driver reports actual filled count from the station. */
  async markFilled(orderId: string, filledCount: number) {
    const order = await this.prisma.fillingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status !== FillingOrderStatus.AT_STATION) {
      throw new BadRequestException(`Cannot mark FILLED in ${order.status} state`);
    }
    if (filledCount < 0) throw new BadRequestException('filledCount must be >= 0');
    // Recompute total based on actual filled count vs requested
    const total = order.pricePerCylinderPaisa * BigInt(filledCount);
    return this.prisma.fillingOrder.update({
      where: { id: orderId },
      data: { filledCount, totalCostPaisa: total, status: FillingOrderStatus.FILLED },
    });
  }

  /** Driver dropped filled cylinders back at the distributor store. */
  async markReturned(orderId: string) {
    const order = await this.prisma.fillingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status !== FillingOrderStatus.FILLED) {
      throw new BadRequestException(`Cannot mark RETURNED in ${order.status} state`);
    }
    return this.prisma.fillingOrder.update({
      where: { id: orderId },
      data: { status: FillingOrderStatus.RETURNED },
    });
  }

  /**
   * Final step: complete the order and debit the distributor's ledger.
   * Idempotent — re-running on a COMPLETED order is a no-op.
   */
  async complete(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.fillingOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException();
      if (order.status === FillingOrderStatus.COMPLETED) return order;
      if (order.status !== FillingOrderStatus.RETURNED) {
        throw new BadRequestException(`Cannot complete from ${order.status}`);
      }

      const distributor = await tx.distributor.findUnique({ where: { id: order.distributorId } });
      if (!distributor) throw new NotFoundException('Distributor not found');

      const newBalance = distributor.advanceBalancePaisa - order.totalCostPaisa;
      await tx.distributor.update({
        where: { id: order.distributorId },
        data: { advanceBalancePaisa: newBalance },
      });
      await tx.ledgerEntry.create({
        data: {
          distributorId: order.distributorId,
          entryType: LedgerEntryType.ADJUSTMENT,
          amountPaisa: -order.totalCostPaisa,
          balanceAfterPaisa: newBalance,
          note: `Filling order ${orderId.slice(0, 8)} — ${order.filledCount ?? 0} cylinders filled`,
        },
      });
      return tx.fillingOrder.update({
        where: { id: orderId },
        data: { status: FillingOrderStatus.COMPLETED, completedAt: new Date() },
      });
    });
  }

  async cancel(orderId: string, reason: string) {
    const order = await this.prisma.fillingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status === FillingOrderStatus.COMPLETED || order.status === FillingOrderStatus.CANCELLED) {
      throw new BadRequestException(`Cannot cancel from ${order.status}`);
    }
    return this.prisma.fillingOrder.update({
      where: { id: orderId },
      data: { status: FillingOrderStatus.CANCELLED, cancellationReason: reason },
    });
  }

  /**
   * Find batch candidates: other PENDING filling orders whose station is
   * within radiusKm of the given order's station. Used by the admin to
   * batch-assign multiple filling orders to one driver run.
   */
  async batchCandidates(orderId: string, radiusKm = 5) {
    const order = await this.prisma.fillingOrder.findUnique({
      where: { id: orderId },
      include: { fillingStation: true },
    });
    if (!order) throw new NotFoundException();
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT id FROM filling_stations WHERE id = ${order.fillingStationId}::uuid
    `;
    // Get the station's coordinates
    const stationCoords: { lat: number; lng: number }[] = await this.prisma.$queryRaw`
      SELECT ST_Y(location) AS lat, ST_X(location) AS lng
      FROM filling_stations WHERE id = ${order.fillingStationId}::uuid
    `;
    if (!stationCoords[0]) return [];
    const { lat, lng } = stationCoords[0];
    return this.prisma.$queryRaw`
      SELECT fo.id, fo.distributor_id, fo.requested_count, fs.name AS station_name,
             ST_DistanceSphere(fs.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 AS distance_km
      FROM filling_orders fo
      JOIN filling_stations fs ON fs.id = fo.filling_station_id
      WHERE fo.status = 'PENDING'
        AND fo.id <> ${orderId}::uuid
        AND ST_DistanceSphere(fs.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 <= ${radiusKm}
      ORDER BY distance_km ASC
    `;
  }
}
