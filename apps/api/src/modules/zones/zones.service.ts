import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ZonesService {
  constructor(private prisma: PrismaService) {}

  async listForCity(cityId: string) {
    return this.prisma.$queryRaw<
      Array<{ id: string; city_id: string; name: string; centroid: any; polygon: any; is_active: boolean }>
    >`
      SELECT id, city_id, name,
             ST_AsGeoJSON(centroid)::json AS centroid,
             ST_AsGeoJSON(polygon)::json  AS polygon,
             is_active
      FROM zones
      WHERE city_id = ${cityId}::uuid AND is_active = TRUE
      ORDER BY name
    `;
  }

  async create(input: {
    cityId: string;
    name: string;
    polygonGeoJson: GeoJSON.MultiPolygon;
  }) {
    if (!input.polygonGeoJson || input.polygonGeoJson.type !== 'MultiPolygon') {
      throw new BadRequestException('polygonGeoJson must be a MultiPolygon');
    }
    const geo = JSON.stringify(input.polygonGeoJson);
    const rows: { id: string }[] = await this.prisma.$queryRaw`
      INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${input.cityId}::uuid,
        ${input.name},
        ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326),
        ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326)),
        TRUE,
        NOW(), NOW()
      )
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  async findContainingPoint(lat: number, lng: number) {
    const rows: { id: string; name: string }[] = await this.prisma.$queryRaw`
      SELECT id, name
      FROM zones
      WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
