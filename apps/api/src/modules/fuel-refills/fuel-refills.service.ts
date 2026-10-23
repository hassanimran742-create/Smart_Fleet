import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateFuelRefillInput } from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { PrismaService } from '../../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The driver of a fuel log, safe fields only (API_CONTRACT §3.5): never a password hash or a CNIC. */
const SAFE_DRIVER_SELECT = {
  id: true,
  licenceNo: true,
  user: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.DriverSelect;

const VEHICLE_SELECT = { id: true, plateNo: true, currentOdometerKm: true } satisfies Prisma.VehicleSelect;

/**
 * Drivers' fuel logs (API_CONTRACT §7.2, §7.12). Only the drivers' own routes are behind
 * `features.fuelRefills`; the office always reads older logs (they show next to Petrol expenses).
 */
@Injectable()
export class FuelRefillsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Records a refill and moves the van's odometer to the reading, which can't go backwards
   * (400 VALIDATION_FAILED on `odometerKm`).
   */
  async create(driverId: string, input: CreateFuelRefillInput) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId }, select: VEHICLE_SELECT });
    if (!vehicle) throw new AppError('NOT_FOUND', { field: 'vehicleId' });
    if (input.odometerKm < vehicle.currentOdometerKm) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [
          {
            path: 'odometerKm',
            code: 'TOO_SMALL',
            message: validationMessage('TOO_SMALL', { min: vehicle.currentOdometerKm }),
            params: { min: vehicle.currentOdometerKm },
          },
        ],
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const refill = await tx.fuelRefill.create({
        data: {
          vehicleId: input.vehicleId,
          driverId,
          litres: input.litres,
          costPaisa: BigInt(input.costPaisa),
          odometerKm: input.odometerKm,
          fuelStation: input.fuelStation,
          notes: input.notes,
        },
        include: { vehicle: { select: VEHICLE_SELECT } },
      });
      await tx.vehicle.update({ where: { id: input.vehicleId }, data: { currentOdometerKm: input.odometerKm } });
      return refill;
    });
  }

  /** `GET /fuel-refills/vehicle/:id` (office). */
  forVehicle(vehicleId: string) {
    if (!UUID.test(vehicleId)) return [];
    return this.prisma.fuelRefill.findMany({
      where: { vehicleId },
      include: { driver: { select: SAFE_DRIVER_SELECT } },
      orderBy: { refillAt: 'desc' },
      take: 50,
    });
  }

  /** `GET /fuel-refills/driver/:id` (office) and the driver's own `GET /fuel-refills/mine`. */
  forDriver(driverId: string) {
    if (!UUID.test(driverId)) return [];
    return this.prisma.fuelRefill.findMany({
      where: { driverId },
      include: { vehicle: { select: VEHICLE_SELECT } },
      orderBy: { refillAt: 'desc' },
      take: 50,
    });
  }

  /** `GET /fuel-refills` (office). */
  listAll(since?: Date) {
    return this.prisma.fuelRefill.findMany({
      where: since ? { refillAt: { gte: since } } : undefined,
      include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: SAFE_DRIVER_SELECT } },
      orderBy: { refillAt: 'desc' },
      take: 500,
    });
  }
}
