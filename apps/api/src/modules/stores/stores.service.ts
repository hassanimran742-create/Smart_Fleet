import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.$queryRaw<
      Array<{ id: string; name: string; zone_id: string; address: string; lat: number; lng: number; is_active: boolean }>
    >`
      SELECT id, name, zone_id, address,
             ST_Y(location) AS lat, ST_X(location) AS lng, is_active
      FROM stores
      ORDER BY name
    `;
  }

  async create(input: { name: string; zoneId: string; address: string; lat: number; lng: number }) {
    const rows: { id: string }[] = await this.prisma.$queryRaw`
      INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${input.name}, ${input.zoneId}::uuid, ${input.address},
        ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
        TRUE, NOW(), NOW()
      )
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  async update(
    id: string,
    input: { name?: string; zoneId?: string; address?: string; lat?: number; lng?: number; isActive?: boolean },
  ) {
    if (input.name !== undefined) {
      await this.prisma.$executeRaw`UPDATE stores SET name = ${input.name}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    if (input.zoneId !== undefined) {
      await this.prisma.$executeRaw`UPDATE stores SET zone_id = ${input.zoneId}::uuid, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    if (input.address !== undefined) {
      await this.prisma.$executeRaw`UPDATE stores SET address = ${input.address}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    if (input.lat !== undefined && input.lng !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE stores SET location = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
                          updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    }
    if (input.isActive !== undefined) {
      await this.prisma.$executeRaw`UPDATE stores SET is_active = ${input.isActive}, updated_at = NOW() WHERE id = ${id}::uuid`;
    }
    return { ok: true };
  }

  archive(id: string) {
    return this.update(id, { isActive: false });
  }

  reactivate(id: string) {
    return this.update(id, { isActive: true });
  }

  async nearestStoreWithStock(opts: {
    distributorId: string;
    cylinderTypeId: string;
    nearLat: number;
    nearLng: number;
    minFullCount: number;
  }) {
    const rows: { id: string; name: string; distance_km: number }[] = await this.prisma.$queryRaw`
      SELECT s.id, s.name,
             ST_DistanceSphere(s.location, ST_SetSRID(ST_MakePoint(${opts.nearLng}, ${opts.nearLat}), 4326)) / 1000 AS distance_km
      FROM stores s
      JOIN inventory_lots il
        ON il.holder_type = 'STORE' AND il.holder_id = s.id
       AND il.distributor_id = ${opts.distributorId}::uuid
       AND il.cylinder_type_id = ${opts.cylinderTypeId}::uuid
       AND il.state = 'FULL'
       AND il.count >= ${opts.minFullCount}
      WHERE s.is_active = TRUE
      ORDER BY distance_km ASC
      LIMIT 5
    `;
    return rows;
  }
}
