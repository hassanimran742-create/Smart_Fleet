import { Injectable } from '@nestjs/common';
import type { IdName, ZoneListRow } from '@smartfleet/shared-types';
import type { CreateZoneInput, UpdateZoneInput } from '@smartfleet/shared-validation';
import type { Actor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX, type Db } from '../orders/support/tx';

/** A zone as the legacy list returns it (zones.service.ts kept this shape), outline included. */
export type { ZoneListRow };

/** What the zone audit rows record before and after a change (API_CONTRACT §7.2). */
interface ZoneSnapshot {
  name: string;
  isActive: boolean;
  areaKm2: number;
}

interface ZoneRow {
  id: string;
  name: string;
  is_active: boolean;
  area_m2: number;
}

const OK = { ok: true } as const;

function areaKm2(areaM2: number): number {
  return Math.round((Number(areaM2) / 1_000_000) * 1000) / 1000;
}

/**
 * Zones (API_CONTRACT §7.2, DATA_MODEL §6). The one lookup rule everywhere: active zones only,
 * `ST_Covers` (border points count), the smallest zone first, then the oldest, then the lowest id.
 * Archiving takes a zone out of every lookup at once; its price rows are kept for reactivation.
 */
@Injectable()
export class ZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * `GET /zones/city/:cityId` (legacy shape), with each zone's outline (`polygon`) and centre
   * (`centroid`) as GeoJSON. Only the office may include archived zones.
   */
  listForCity(cityId: string, includeArchived = false): Promise<ZoneListRow[]> {
    if (includeArchived) {
      return this.prisma.$queryRaw<ZoneListRow[]>`
        SELECT id, city_id, name,
               ST_AsGeoJSON(centroid)::json AS centroid,
               ST_AsGeoJSON(polygon)::json  AS polygon,
               is_active
        FROM zones
        WHERE city_id = ${cityId}::uuid
        ORDER BY name, id`;
    }
    return this.prisma.$queryRaw<ZoneListRow[]>`
      SELECT id, city_id, name,
             ST_AsGeoJSON(centroid)::json AS centroid,
             ST_AsGeoJSON(polygon)::json  AS polygon,
             is_active
      FROM zones
      WHERE city_id = ${cityId}::uuid AND is_active = TRUE
      ORDER BY name, id`;
  }

  /**
   * The zone covering a point (DATA_MODEL §6.6), or null outside every active zone. Deterministic:
   * `ORDER BY ST_Area(polygon), created_at, id LIMIT 1`. `includeArchived` is for the office's
   * `GET /zones/locate` only; quotes, customers, stores and orders never pass it.
   */
  async findContainingPoint(lat: number, lng: number, db: Db = this.prisma, options: { includeArchived?: boolean } = {}): Promise<IdName | null> {
    const rows = options.includeArchived
      ? await db.$queryRaw<IdName[]>`
          SELECT id, name FROM zones
          WHERE ST_Covers(polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
          ORDER BY ST_Area(polygon), created_at, id
          LIMIT 1`
      : await db.$queryRaw<IdName[]>`
          SELECT id, name FROM zones
          WHERE is_active AND ST_Covers(polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
          ORDER BY ST_Area(polygon), created_at, id
          LIMIT 1`;
    return rows[0] ? { id: rows[0].id, name: rows[0].name } : null;
  }

  /** `POST /zones` (office) → `{ id }`; audited `zone.create`. */
  async create(actor: Actor, body: CreateZoneInput): Promise<{ id: string }> {
    const city = await this.prisma.city.findUnique({ where: { id: body.cityId }, select: { id: true } });
    if (!city) throw new AppError('NOT_FOUND', { field: 'cityId' });
    const geojson = JSON.stringify(body.polygonGeoJson);
    const shape = await this.checkShape(geojson);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), ${body.cityId}::uuid, ${body.name},
                ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
                ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
                TRUE, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        RETURNING id`;
      const id = rows[0].id;
      const after: ZoneSnapshot = { name: body.name, isActive: true, areaKm2: shape.areaKm2 };
      await this.audit.record(
        { action: 'zone.create', actor, resourceType: 'zone', resourceId: id, before: null, after, diff: { zone: body.name } },
        tx,
      );
      return { id };
    });
  }

  /**
   * `PATCH /zones/:id` (office) `{ name?, polygonGeoJson? }` → `{ ok: true }`; `isActive` is ignored
   * (archive and reactivate have their own routes). A change is audited `zone.update`; a body that
   * changes nothing writes nothing.
   */
  async update(actor: Actor, id: string, body: UpdateZoneInput): Promise<{ ok: true }> {
    const geojson = body.polygonGeoJson ? JSON.stringify(body.polygonGeoJson) : null;
    const shape = geojson ? await this.checkShape(geojson) : null;

    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockZone(tx, id);
      const nameChanges = body.name !== undefined && body.name !== current.name;
      const shapeChanges = geojson !== null && !(await this.sameShape(tx, id, geojson));
      if (!nameChanges && !shapeChanges) return OK;

      const name = nameChanges ? (body.name as string) : current.name;
      if (shapeChanges && geojson) {
        await tx.$executeRaw`
          UPDATE zones
          SET name = ${name},
              polygon = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
              centroid = ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
              updated_at = (now() AT TIME ZONE 'UTC')
          WHERE id = ${id}::uuid`;
      } else {
        await tx.$executeRaw`UPDATE zones SET name = ${name}, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
      }
      const before: ZoneSnapshot = { name: current.name, isActive: current.is_active, areaKm2: areaKm2(current.area_m2) };
      const after: ZoneSnapshot = { name, isActive: current.is_active, areaKm2: shape && shapeChanges ? shape.areaKm2 : before.areaKm2 };
      await this.audit.record({ action: 'zone.update', actor, resourceType: 'zone', resourceId: id, before, after, diff: { zone: name } }, tx);
      return OK;
    }, LOCKING_TX);
  }

  /** `DELETE /zones/:id` (office): archive. A repeat answers 200 with `X-Already-Applied`. */
  archive(actor: Actor, id: string): Promise<{ ok: true } | IdempotentResponse<{ ok: true }>> {
    return this.setActive(actor, id, false);
  }

  /** `PATCH /zones/:id/reactivate` (office). A repeat answers 200 with `X-Already-Applied`. */
  reactivate(actor: Actor, id: string): Promise<{ ok: true } | IdempotentResponse<{ ok: true }>> {
    return this.setActive(actor, id, true);
  }

  private setActive(actor: Actor, id: string, isActive: boolean): Promise<{ ok: true } | IdempotentResponse<{ ok: true }>> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockZone(tx, id);
      if (current.is_active === isActive) return alreadyApplied(OK);
      await tx.$executeRaw`UPDATE zones SET is_active = ${isActive}, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
      const area = areaKm2(current.area_m2);
      await this.audit.record(
        {
          action: isActive ? 'zone.reactivate' : 'zone.archive',
          actor,
          resourceType: 'zone',
          resourceId: id,
          before: { name: current.name, isActive: current.is_active, areaKm2: area } satisfies ZoneSnapshot,
          after: { name: current.name, isActive, areaKm2: area } satisfies ZoneSnapshot,
          diff: { zone: current.name },
        },
        tx,
      );
      return OK;
    }, LOCKING_TX);
  }

  private async lockZone(tx: Db, id: string): Promise<ZoneRow> {
    const rows = await tx.$queryRaw<ZoneRow[]>`
      SELECT id, name, is_active, ST_Area(polygon::geography) AS area_m2
      FROM zones WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return rows[0];
  }

  private async sameShape(tx: Db, id: string, geojson: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ same: boolean }>>`
      SELECT ST_Equals(polygon, ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)) AS same
      FROM zones WHERE id = ${id}::uuid`;
    return rows[0]?.same === true;
  }

  /**
   * A zone shape must be a non-empty, valid MultiPolygon with an area above 0 (`ST_IsValid`), else
   * 400 ZONE_INVALID_SHAPE. Runs before any transaction: PostGIS refuses some broken shapes outright.
   */
  private async checkShape(geojson: string): Promise<{ areaKm2: number }> {
    let rows: Array<{ valid: boolean; empty: boolean; area_m2: number | null }>;
    try {
      rows = await this.prisma.$queryRaw`
        SELECT ST_IsValid(g) AS valid, ST_IsEmpty(g) AS empty,
               CASE WHEN ST_IsValid(g) THEN ST_Area(g::geography) ELSE NULL END AS area_m2
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS g) AS shape`;
    } catch (error) {
      throw new AppError('ZONE_INVALID_SHAPE', undefined, { cause: error });
    }
    const shape = rows[0];
    if (!shape || !shape.valid || shape.empty || !(Number(shape.area_m2) > 0)) throw new AppError('ZONE_INVALID_SHAPE');
    return { areaKm2: areaKm2(Number(shape.area_m2)) };
  }
}
