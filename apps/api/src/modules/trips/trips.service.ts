import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TripStatus } from '@prisma/client';

@Injectable()
export class TripsService {
  constructor(private prisma: PrismaService) {}

  forDriver(driverId: string) {
    return this.prisma.trip.findMany({
      where: { driverId },
      include: {
        orders: {
          include: {
            client: true,
            distributor: true,
            lines: { include: { cylinderType: true } },
          },
        },
        stops: { orderBy: { seq: 'asc' } },
        originStore: true,
        vehicle: true,
      },
      orderBy: { plannedAt: 'desc' },
      take: 50,
    });
  }

  async byId(id: string) {
    const t = await this.prisma.trip.findUnique({
      where: { id },
      include: { orders: true, stops: { orderBy: { seq: 'asc' } }, vehicle: true, driver: true, originStore: true },
    });
    if (!t) throw new NotFoundException();
    return t;
  }

  setStatus(id: string, status: TripStatus) {
    return this.prisma.trip.update({
      where: { id },
      data: {
        status,
        startedAt: status === TripStatus.IN_PROGRESS ? new Date() : undefined,
        completedAt: status === TripStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }
}
