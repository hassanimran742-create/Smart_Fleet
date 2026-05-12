import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VehicleStatus } from '@prisma/client';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.vehicle.findMany({ include: { homeZone: true, currentDriver: true } });
  }

  create(input: { plateNo: string; capacityUnits: number; homeZoneId: string }) {
    return this.prisma.vehicle.create({ data: input });
  }

  setStatus(id: string, status: VehicleStatus) {
    return this.prisma.vehicle.update({ where: { id }, data: { status } });
  }

  reassignZone(id: string, homeZoneId: string) {
    return this.prisma.vehicle.update({ where: { id }, data: { homeZoneId } });
  }
}
