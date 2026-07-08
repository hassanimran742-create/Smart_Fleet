import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TripStatus } from '@prisma/client';

@Injectable()
export class TripsService {
  constructor(private prisma: PrismaService) {}

  forDriver(driverId: string) {
    return this.prisma.trip
      .findMany({
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
      })
      .then((trips) => this.attachStopCoords(trips));
  }

  async byId(id: string) {
    const t = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        orders: {
          include: {
            client: true,
            distributor: true,
            lines: { include: { cylinderType: true } },
          },
        },
        stops: { orderBy: { seq: 'asc' } },
        vehicle: true,
        driver: true,
        originStore: true,
      },
    });
    if (!t) throw new NotFoundException();
    const [withCoords] = await this.attachStopCoords([t]);
    return withCoords;
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

  markArrived(stopId: string) {
    return this.prisma.tripStop.update({
      where: { id: stopId },
      data: { arrivedAt: new Date() },
    });
  }

  markDeparted(stopId: string) {
    return this.prisma.tripStop.update({
      where: { id: stopId },
      data: { departedAt: new Date() },
    });
  }

  // Prisma's Unsupported("geometry") type comes back as a hex string —
  // not useful to the mobile app. Decode the (lng,lat) for each stop with
  // raw SQL and replace the `location` field with a clean GeoJSON-shaped
  // object the client can read directly.
  private async attachStopCoords(trips: any[]): Promise<any[]> {
    const stopIds: string[] = [];
    for (const t of trips) for (const s of t.stops ?? []) stopIds.push(s.id);
    if (stopIds.length === 0) return trips;

    const coords: Array<{ id: string; lat: number; lng: number }> = await this.prisma.$queryRawUnsafe(
      `SELECT id, ST_Y(location) AS lat, ST_X(location) AS lng
       FROM trip_stops
       WHERE id IN (${stopIds.map((_, i) => `$${i + 1}::uuid`).join(',')})`,
      ...stopIds,
    );
    const byId: Record<string, { lat: number; lng: number }> = {};
    for (const c of coords) byId[c.id] = { lat: c.lat, lng: c.lng };

    return trips.map((t) => ({
      ...t,
      stops: (t.stops ?? []).map((s: any) => {
        const c = byId[s.id];
        return {
          ...s,
          location: c ? { coordinates: [c.lng, c.lat], lat: c.lat, lng: c.lng } : null,
        };
      }),
    }));
  }
}
