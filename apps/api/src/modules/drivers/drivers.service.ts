import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DriverAvailability, UserRole, UserStatus } from '@prisma/client';

/** Turn "" / whitespace-only into undefined so blanks store as NULL. */
function blankToUndef(v?: string): string | undefined {
  const t = (v ?? '').trim();
  return t === '' ? undefined : t;
}

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

  create(input: {
    phone: string;
    name: string;
    licenceNo: string;
    email?: string;
    cnic?: string;
    profilePictureUrl?: string;
  }) {
    // Blank optional fields arrive from the form as "" — coerce to undefined so
    // they store as NULL. email is @unique, and an empty-string email collides
    // across every driver left blank; NULL does not.
    const email = blankToUndef(input.email);
    const cnic = blankToUndef(input.cnic);
    const profilePictureUrl = blankToUndef(input.profilePictureUrl);
    const licenceNo = (input.licenceNo ?? '').trim();
    if (!licenceNo) throw new BadRequestException('Driving licence # is required.');

    return this.prisma.$transaction(async (tx) => {
      const existingDriver = await tx.driver.findFirst({
        where: { user: { phone: input.phone } },
        select: { id: true },
      });
      if (existingDriver) {
        throw new BadRequestException('A driver with this phone number already exists.');
      }
      const user = await tx.user.upsert({
        where: { phone: input.phone },
        update: { name: input.name, role: UserRole.DRIVER, email, cnic, profilePictureUrl },
        create: {
          phone: input.phone,
          name: input.name,
          role: UserRole.DRIVER,
          status: UserStatus.ACTIVE,
          email,
          cnic,
          profilePictureUrl,
        },
      });
      return tx.driver.create({
        data: { userId: user.id, licenceNo },
        include: { user: true },
      });
    });
  }

  async updateProfile(
    driverId: string,
    input: {
      name?: string;
      email?: string;
      cnic?: string;
      profilePictureUrl?: string;
      licenceNo?: string;
    },
  ) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException();
    const email = blankToUndef(input.email);
    const cnic = blankToUndef(input.cnic);
    const profilePictureUrl = blankToUndef(input.profilePictureUrl);
    const name = blankToUndef(input.name);
    const licenceNo = blankToUndef(input.licenceNo);
    if (licenceNo) {
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { licenceNo },
      });
    }
    if (name || email || cnic || profilePictureUrl) {
      await this.prisma.user.update({
        where: { id: driver.userId },
        data: { name, email, cnic, profilePictureUrl },
      });
    }
    return this.findById(driverId);
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

  /**
   * Toggling online opens a new DriverShift; toggling offline closes
   * the most recent open shift. The attendance report aggregates these
   * shifts per day to produce hours-worked numbers.
   */
  async setOnline(driverId: string, isOnline: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      if (!driver) throw new NotFoundException();
      if (isOnline && driver.availability !== DriverAvailability.AVAILABLE) {
        throw new BadRequestException(
          `Driver is ${driver.availability}; cannot go online until marked AVAILABLE.`,
        );
      }
      await tx.driver.update({ where: { id: driverId }, data: { isOnline } });
      if (isOnline) {
        // Safety: close any previously open shift before starting a new one.
        await tx.driverShift.updateMany({
          where: { driverId, endedAt: null },
          data: { endedAt: new Date() },
        });
        await tx.driverShift.create({ data: { driverId } });
      } else {
        const open = await tx.driverShift.findFirst({
          where: { driverId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        });
        if (open) {
          await tx.driverShift.update({
            where: { id: open.id },
            data: { endedAt: new Date() },
          });
        }
      }
      return { ok: true };
    });
  }

  async setAvailability(
    driverId: string,
    availability: DriverAvailability,
    leaveStart?: string,
    leaveEnd?: string,
    reason?: string,
  ) {
    const data: any = { availability };
    if (availability === DriverAvailability.ON_LEAVE) {
      data.leaveStart = leaveStart ? new Date(leaveStart) : null;
      data.leaveEnd = leaveEnd ? new Date(leaveEnd) : null;
      data.leaveReason = reason ?? null;
      // Force offline; close any open shift.
      data.isOnline = false;
      await this.prisma.driverShift.updateMany({
        where: { driverId, endedAt: null },
        data: { endedAt: new Date() },
      });
    } else {
      data.leaveStart = null;
      data.leaveEnd = null;
      data.leaveReason = null;
      if (availability === DriverAvailability.OFF_DUTY) data.isOnline = false;
    }
    return this.prisma.driver.update({ where: { id: driverId }, data });
  }

  assignVehicle(driverId: string, vehicleId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      // currentVehicleId is unique — a vehicle belongs to at most one driver.
      // If another driver currently holds this vehicle, release it first so
      // reassigning doesn't blow up on the unique constraint. This makes the
      // admin "assign vehicle" action a clean move rather than a hard error.
      if (vehicleId) {
        await tx.driver.updateMany({
          where: { currentVehicleId: vehicleId, id: { not: driverId } },
          data: { currentVehicleId: null },
        });
      }
      return tx.driver.update({
        where: { id: driverId },
        data: { currentVehicleId: vehicleId },
      });
    });
  }

  /**
   * Archive a driver: suspend the underlying user account and unassign
   * any vehicle. We don't hard-delete because trips/reconciliations
   * reference the driver row.
   */
  async archive(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.driver.update({
        where: { id: driverId },
        data: { currentVehicleId: null, isOnline: false },
      }),
      this.prisma.user.update({
        where: { id: driver.userId },
        data: { status: UserStatus.SUSPENDED },
      }),
    ]);
    return { ok: true };
  }

  async reactivate(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException();
    await this.prisma.user.update({
      where: { id: driver.userId },
      data: { status: UserStatus.ACTIVE },
    });
    return { ok: true };
  }
}
