import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FillingStationsService {
  constructor(private prisma: PrismaService) {}

  list(includeInactive = false) {
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        address: string;
        price_per_cylinder_paisa: string;
        is_active: boolean;
        lat: number;
        lng: number;
      }>
    >`
      SELECT id, name, address, price_per_cylinder_paisa, is_active,
             ST_Y(location) AS lat, ST_X(location) AS lng
      FROM filling_stations
      ${includeInactive ? this.prisma.$queryRaw`` : this.prisma.$queryRaw`WHERE is_active = TRUE`}
      ORDER BY name
    `;
  }

  async byId(id: string) {
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT id, name, address, price_per_cylinder_paisa, is_active,
             ST_Y(location) AS lat, ST_X(location) AS lng
      FROM filling_stations WHERE id = ${id}::uuid
    `;
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async create(input: { name: string; address: string; lat: number; lng: number; pricePerCylinderPaisa: number }) {
    const rows: { id: string }[] = await this.prisma.$queryRaw`
      INSERT INTO filling_stations (id, name, address, location, price_per_cylinder_paisa, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${input.name}, ${input.address},
        ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
        ${input.pricePerCylinderPaisa}, TRUE, NOW(), NOW()
      )
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  async update(
    id: string,
    input: { name?: string; address?: string; lat?: number; lng?: number; pricePerCylinderPaisa?: number; isActive?: boolean },
  ) {
    if (input.name !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET name = ${input.name}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    if (input.address !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET address = ${input.address}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    if (input.lat !== undefined && input.lng !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE filling_stations
        SET location = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
            updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    }
    if (input.pricePerCylinderPaisa !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET price_per_cylinder_paisa = ${input.pricePerCylinderPaisa}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    if (input.isActive !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET is_active = ${input.isActive}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    return { ok: true };
  }

  archive(id: string) {
    return this.update(id, { isActive: false });
  }

  /**
   * For batching: find filling stations within radiusKm of the given point.
   * Returns sorted nearest-first.
   */
  async nearby(lat: number, lng: number, radiusKm: number) {
    return this.prisma.$queryRaw<
      Array<{ id: string; name: string; distance_km: number }>
    >`
      SELECT id, name,
             ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 AS distance_km
      FROM filling_stations
      WHERE is_active = TRUE
      ORDER BY distance_km ASC
      LIMIT 10
    `;
  }
}
