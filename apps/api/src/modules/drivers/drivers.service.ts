import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.driver.findMany({ include: { user: true, currentVehicle: true } });
  }

  async findById(id: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id },
      include: { user: true, currentVehicle: true },
    });
    if (!d) throw new NotFoundException();
    return d;
  }

  create(input: { phone: string; name: string; licenceNo: string }) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone: input.phone },
        update: { name: input.name, role: UserRole.DRIVER },
        create: {
          phone: input.phone,
          name: input.name,
          role: UserRole.DRIVER,
          status: UserStatus.ACTIVE,
        },
      });
      return tx.driver.create({
        data: { userId: user.id, licenceNo: input.licenceNo },
        include: { user: true },
      });
    });
  }

  async updateLocation(driverId: string, lat: number, lng: number) {
    await this.prisma.$executeRaw`
      UPDATE drivers
      SET current_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          current_location_updated_at = NOW()
      WHERE id = ${driverId}::uuid
    `;
    // Resolve current zone via point-in-polygon
    const rows: { zone_id: string | null }[] = await this.prisma.$queryRaw`
      SELECT z.id AS zone_id
      FROM zones z, drivers d
      WHERE d.id = ${driverId}::uuid
        AND ST_Contains(z.polygon, d.current_location)
      LIMIT 1
    `;
    const zoneId = rows[0]?.zone_id;
    if (zoneId) {
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { currentZoneId: zoneId },
      });
    }
    return { ok: true, zoneId };
  }

  setOnline(driverId: string, isOnline: boolean) {
    return this.prisma.driver.update({ where: { id: driverId }, data: { isOnline } });
  }

  assignVehicle(driverId: string, vehicleId: string | null) {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: { currentVehicleId: vehicleId },
    });
  }
}
