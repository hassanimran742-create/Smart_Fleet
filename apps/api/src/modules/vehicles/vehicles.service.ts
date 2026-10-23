import { Injectable } from '@nestjs/common';
import { Prisma, VehicleStatus } from '@prisma/client';
import type { CreateVehicleInput, UpdateVehicleInput } from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A van with its home zone and current driver (API_CONTRACT §7.2: `currentDriver.user` stripped).
 * The driver's user is an explicit safe select: name, phone and status only, never a password hash
 * or a CNIC.
 */
const VEHICLE_VIEW_INCLUDE = {
  homeZone: true,
  currentDriver: {
    select: {
      id: true,
      userId: true,
      licenceNo: true,
      availability: true,
      isOnline: true,
      user: { select: { id: true, name: true, phone: true, status: true } },
    },
  },
} satisfies Prisma.VehicleInclude;

/** Vans (office only). Unknown ids are 404; a plate already used is 409 CONFLICT_DUPLICATE. */
@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.vehicle.findMany({ include: VEHICLE_VIEW_INCLUDE, orderBy: [{ plateNo: 'asc' }, { id: 'asc' }] });
  }

  async byId(id: string) {
    const v = UUID.test(id) ? await this.prisma.vehicle.findUnique({ where: { id }, include: VEHICLE_VIEW_INCLUDE }) : null;
    if (!v) throw new AppError('NOT_FOUND');
    return v;
  }

  async create(input: CreateVehicleInput) {
    await this.assertZone(input.homeZoneId);
    return this.prisma.vehicle.create({ data: input, include: VEHICLE_VIEW_INCLUDE });
  }

  async update(id: string, input: UpdateVehicleInput) {
    await this.byId(id);
    if (input.homeZoneId) await this.assertZone(input.homeZoneId);
    return this.prisma.vehicle.update({ where: { id }, data: input, include: VEHICLE_VIEW_INCLUDE });
  }

  async setStatus(id: string, status: VehicleStatus) {
    await this.byId(id);
    return this.prisma.vehicle.update({ where: { id }, data: { status }, include: VEHICLE_VIEW_INCLUDE });
  }

  async reassignZone(id: string, homeZoneId: string) {
    await this.byId(id);
    await this.assertZone(homeZoneId);
    return this.prisma.vehicle.update({ where: { id }, data: { homeZoneId }, include: VEHICLE_VIEW_INCLUDE });
  }

  /** Archive = mark RETIRED; trips and expenses keep pointing at the van. */
  async archive(id: string) {
    await this.byId(id);
    return this.prisma.vehicle.update({ where: { id }, data: { status: VehicleStatus.RETIRED }, include: VEHICLE_VIEW_INCLUDE });
  }

  private async assertZone(zoneId: string): Promise<void> {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true } });
    if (!zone) throw new AppError('NOT_FOUND', { field: 'homeZoneId' });
  }
}
