import { Injectable } from '@nestjs/common';
import type { StoreInput, UpdateDistributorStoreInput } from '@smartfleet/shared-validation';
import type { Actor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX, type Db, type Tx } from '../orders/support/tx';
import { ZonesService } from '../zones/zones.service';

/** A store row as the legacy list returns it. */
export interface StoreListRow {
  id: string;
  name: string;
  zone_id: string;
  address: string;
  lat: number;
  lng: number;
  is_active: boolean;
}

/** What `distributor.store_update` records before and after (Appendix B). */
export interface StoreSnapshot {
  name: string;
  address: string;
  lat: number;
  lng: number;
  zoneId: string;
  zoneName: string;
}

export interface StoreChange {
  before: StoreSnapshot;
  after: StoreSnapshot;
  changed: boolean;
}

interface LockedStore {
  id: string;
  name: string;
  address: string;
  zone_id: string;
  zone_name: string;
  lat: number;
  lng: number;
}

const OK = { ok: true } as const;

/**
 * Stores (API_CONTRACT §7.2): office only. Every store's zone comes from its pin (`STORE_OUTSIDE_ZONES`
 * when no active zone covers it), and a distributor's one store can't be removed (`STORE_IN_USE`).
 * A store's zone is recomputed only when its pin moves.
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zones: ZonesService,
    private readonly audit: AuditLogService,
  ) {}

  list(): Promise<StoreListRow[]> {
    return this.prisma.$queryRaw<StoreListRow[]>`
      SELECT id, name, zone_id, address, ST_Y(location) AS lat, ST_X(location) AS lng, is_active
      FROM stores
      ORDER BY name, id`;
  }

  /** `POST /stores` (office) → `{ id }`. A `zoneId` in the body is ignored: the pin decides. */
  async create(body: StoreInput): Promise<{ id: string }> {
    return this.prisma.$transaction((tx) => this.insertStore(tx, body).then(({ id }) => ({ id })));
  }

  /** Inserts a store (raw INSERT: the location is a geometry), its zone derived from the pin. */
  async insertStore(tx: Db, store: StoreInput): Promise<{ id: string; zoneId: string; zoneName: string }> {
    const zone = await this.zones.findContainingPoint(store.lat, store.lng, tx);
    if (!zone) throw new AppError('STORE_OUTSIDE_ZONES');
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
      VALUES (gen_random_uuid(), ${store.name}, ${zone.id}::uuid, ${store.address},
              ST_SetSRID(ST_MakePoint(${store.lng}, ${store.lat}), 4326), TRUE, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      RETURNING id`;
    return { id: rows[0].id, zoneId: zone.id, zoneName: zone.name };
  }

  /**
   * `PATCH /stores/:id` (office). A moved pin re-derives the zone (`STORE_OUTSIDE_ZONES`, nothing
   * changes). A distributor's store is audited `distributor.store_update`, as through
   * `PATCH /distributors/:id/store`.
   */
  async update(actor: Actor, id: string, body: UpdateDistributorStoreInput): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const change = await this.updateStoreRow(tx, id, body);
      if (!change.changed) return;
      const owner = await tx.distributor.findUnique({ where: { homeStoreId: id }, select: { id: true, businessName: true } });
      if (owner) {
        await this.audit.record(
          {
            action: 'distributor.store_update',
            actor,
            resourceType: 'distributor',
            resourceId: owner.id,
            distributorId: owner.id,
            before: change.before,
            after: change.after,
            diff: { distributor: owner.businessName },
          },
          tx,
        );
      }
    }, LOCKING_TX);
    return OK;
  }

  /** Locks a store and applies the changed fields; the caller audits. 404 NOT_FOUND for an unknown store. */
  async updateStoreRow(tx: Tx, id: string, body: UpdateDistributorStoreInput): Promise<StoreChange> {
    const rows = await tx.$queryRaw<LockedStore[]>`
      SELECT s.id, s.name, s.address, s.zone_id, z.name AS zone_name, ST_Y(s.location) AS lat, ST_X(s.location) AS lng
      FROM stores s JOIN zones z ON z.id = s.zone_id
      WHERE s.id = ${id}::uuid
      FOR UPDATE OF s`;
    const current = rows[0];
    if (!current) throw new AppError('NOT_FOUND');
    const before: StoreSnapshot = {
      name: current.name,
      address: current.address,
      lat: current.lat,
      lng: current.lng,
      zoneId: current.zone_id,
      zoneName: current.zone_name,
    };
    const after: StoreSnapshot = { ...before };
    if (body.name !== undefined) after.name = body.name;
    if (body.address !== undefined) after.address = body.address;
    const moved = body.lat !== undefined && body.lng !== undefined && (body.lat !== current.lat || body.lng !== current.lng);
    if (moved) {
      const zone = await this.zones.findContainingPoint(body.lat as number, body.lng as number, tx);
      if (!zone) throw new AppError('STORE_OUTSIDE_ZONES');
      after.lat = body.lat as number;
      after.lng = body.lng as number;
      after.zoneId = zone.id;
      after.zoneName = zone.name;
    }
    const changed = after.name !== before.name || after.address !== before.address || moved;
    if (!changed) return { before, after, changed };
    if (moved) {
      await tx.$executeRaw`
        UPDATE stores SET name = ${after.name}, address = ${after.address}, zone_id = ${after.zoneId}::uuid,
               location = ST_SetSRID(ST_MakePoint(${after.lng}, ${after.lat}), 4326), updated_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${id}::uuid`;
    } else {
      await tx.$executeRaw`UPDATE stores SET name = ${after.name}, address = ${after.address}, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    }
    return { before, after, changed };
  }

  /** `DELETE /stores/:id` (office): archives a store; a distributor's store gives 409 STORE_IN_USE. */
  async archive(id: string): Promise<{ ok: true }> {
    const store = await this.prisma.store.findUnique({ where: { id }, select: { id: true, distributor: { select: { id: true } } } });
    if (!store) throw new AppError('NOT_FOUND');
    if (store.distributor) throw new AppError('STORE_IN_USE');
    await this.prisma.$executeRaw`UPDATE stores SET is_active = FALSE, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    return OK;
  }

  /** `PATCH /stores/:id/reactivate` (office). */
  async reactivate(id: string): Promise<{ ok: true }> {
    const store = await this.prisma.store.findUnique({ where: { id }, select: { id: true } });
    if (!store) throw new AppError('NOT_FOUND');
    await this.prisma.$executeRaw`UPDATE stores SET is_active = TRUE, updated_at = (now() AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`;
    return OK;
  }

  /** A store's pin and name, for trips that start there. */
  async location(db: Db, id: string): Promise<{ id: string; name: string; lat: number; lng: number } | null> {
    const rows = await db.$queryRaw<Array<{ id: string; name: string; lat: number; lng: number }>>`
      SELECT id, name, ST_Y(location) AS lat, ST_X(location) AS lng FROM stores WHERE id = ${id}::uuid`;
    return rows[0] ?? null;
  }
}
