import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FuelRefillsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Record a refill. Updates the vehicle's currentOdometerKm to the
   * reported reading (which is also the canonical "how many km has
   * this vehicle driven" number we read back in reports).
   */
  async create(input: {
    vehicleId: string;
    driverId: string;
    litres: number;
    costPaisa: number;
    odometerKm: number;
    fuelStation?: string;
    receiptUrl?: string;
    notes?: string;
  }) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (input.odometerKm < vehicle.currentOdometerKm) {
      throw new BadRequestException(
        `Odometer can't go backwards. Current: ${vehicle.currentOdometerKm} km, submitted: ${input.odometerKm} km.`,
      );
    }
    if (input.litres <= 0 || input.costPaisa < 0) {
      throw new BadRequestException('Invalid litres or cost');
    }
    return this.prisma.$transaction(async (tx) => {
      const refill = await tx.fuelRefill.create({
        data: {
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          litres: input.litres,
          costPaisa: BigInt(input.costPaisa),
          odometerKm: input.odometerKm,
          fuelStation: input.fuelStation,
          receiptUrl: input.receiptUrl,
          notes: input.notes,
        },
      });
      await tx.vehicle.update({
        where: { id: input.vehicleId },
        data: { currentOdometerKm: input.odometerKm },
      });
      return refill;
    });
  }

  forVehicle(vehicleId: string) {
    return this.prisma.fuelRefill.findMany({
      where: { vehicleId },
      include: { driver: { include: { user: true } } },
      orderBy: { refillAt: 'desc' },
      take: 50,
    });
  }

  forDriver(driverId: string) {
    return this.prisma.fuelRefill.findMany({
      where: { driverId },
      include: { vehicle: true },
      orderBy: { refillAt: 'desc' },
      take: 50,
    });
  }

  async listAll(since?: Date) {
    return this.prisma.fuelRefill.findMany({
      where: since ? { refillAt: { gte: since } } : undefined,
      include: {
        vehicle: true,
        driver: { include: { user: true } },
      },
      orderBy: { refillAt: 'desc' },
      take: 500,
    });
  }
}
