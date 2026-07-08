import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VehicleStatus } from '@prisma/client';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.vehicle.findMany({ include: { homeZone: true, currentDriver: { include: { user: true } } } });
  }

  async byId(id: string) {
    const v = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { homeZone: true, currentDriver: { include: { user: true } } },
    });
    if (!v) throw new NotFoundException();
    return v;
  }

  create(input: { plateNo: string; capacityUnits: number; homeZoneId: string }) {
    return this.prisma.vehicle.create({ data: input });
  }

  update(id: string, input: { plateNo?: string; capacityUnits?: number; homeZoneId?: string }) {
    return this.prisma.vehicle.update({ where: { id }, data: input });
  }

  setStatus(id: string, status: VehicleStatus) {
    return this.prisma.vehicle.update({ where: { id }, data: { status } });
  }

  reassignZone(id: string, homeZoneId: string) {
    return this.prisma.vehicle.update({ where: { id }, data: { homeZoneId } });
  }

  // Archive = mark RETIRED. Trip/transfer FKs remain valid.
  archive(id: string) {
    return this.prisma.vehicle.update({
      where: { id },
      data: { status: VehicleStatus.RETIRED },
    });
  }
}
