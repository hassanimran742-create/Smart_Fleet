import { Injectable } from '@nestjs/common';
import type { CreateFillingStationInput, UpdateFillingStationInput } from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A refill station as every caller sees it. The price is always "0" (ADR-16: refills carry no money),
 * under both its legacy and its new name; the stored value is never shown.
 */
export interface FillingStationView {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
  isActive: boolean;
  lat: number;
  lng: number;
  price_per_cylinder_paisa: '0';
  pricePerCylinderPaisa: '0';
}

interface StationRow {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
  lat: number;
  lng: number;
}

function toView(row: StationRow): FillingStationView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    is_active: row.is_active,
    isActive: row.is_active,
    lat: row.lat,
    lng: row.lng,
    price_per_cylinder_paisa: '0',
    pricePerCylinderPaisa: '0',
  };
}

/** Refill stations (API_CONTRACT §7.2): read by anyone signed in, written by the office. */
@Injectable()
export class FillingStationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeInactive = false): Promise<FillingStationView[]> {
    const rows = includeInactive
      ? await this.prisma.$queryRaw<StationRow[]>`
          SELECT id, name, address, is_active, ST_Y(location) AS lat, ST_X(location) AS lng
          FROM filling_stations ORDER BY name, id`
      : await this.prisma.$queryRaw<StationRow[]>`
          SELECT id, name, address, is_active, ST_Y(location) AS lat, ST_X(location) AS lng
          FROM filling_stations WHERE is_active = TRUE ORDER BY name, id`;
    return rows.map(toView);
  }

  async byId(id: string): Promise<FillingStationView> {
    const rows = await this.prisma.$queryRaw<StationRow[]>`
      SELECT id, name, address, is_active, ST_Y(location) AS lat, ST_X(location) AS lng
      FROM filling_stations WHERE id = ${id}::uuid`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return toView(rows[0]);
  }

  /** `POST /filling-stations` (office). A sent price is ignored; the column keeps its default of 0. */
  async create(input: CreateFillingStationInput): Promise<FillingStationView> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO filling_stations (id, name, address, location, is_active, created_at, updated_at)
      VALUES (gen_random_uuid(), ${input.name}, ${input.address},
              ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326), TRUE, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      RETURNING id`;
    return this.byId(rows[0].id);
  }

  /** `PATCH /filling-stations/:id` (office). A sent price is ignored: the stored one is left as it was. */
  async update(id: string, input: UpdateFillingStationInput): Promise<FillingStationView> {
    await this.byId(id);
    if (input.name !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET name = ${input.name}, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    }
    if (input.address !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET address = ${input.address}, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    }
    if (input.lat !== undefined && input.lng !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE filling_stations SET location = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326), updated_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${id}::uuid`;
    }
    if (input.isActive !== undefined) {
      await this.prisma.$executeRaw`UPDATE filling_stations SET is_active = ${input.isActive}, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    }
    return this.byId(id);
  }

  /** `DELETE /filling-stations/:id` (office): archive. */
  async archive(id: string): Promise<{ ok: true }> {
    await this.byId(id);
    await this.prisma.$executeRaw`UPDATE filling_stations SET is_active = FALSE, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    return { ok: true };
  }

  /** Active stations within `radiusKm` of a point, nearest first (for batching). */
  nearby(lat: number, lng: number, radiusKm: number) {
    return this.prisma.$queryRaw<Array<{ id: string; name: string; distance_km: number }>>`
      SELECT id, name, ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 AS distance_km
      FROM filling_stations
      WHERE is_active = TRUE
        AND ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 <= ${radiusKm}
      ORDER BY distance_km ASC
      LIMIT 10`;
  }
}
