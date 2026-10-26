import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Db } from '../orders/support/tx';
import { compareSizes, toCylinderSize, type CylinderSize } from './size-label';

/**
 * A distributor's current delivery price in one zone (DATA_MODEL §3.3): ONE flat cost per order,
 * whatever cylinders it holds (ADR-08, 2026-10-26).
 */
export interface ZonePriceRow {
  id: string;
  /** The delivery cost per order. */
  basePaisa: bigint;
  note: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
}

/**
 * Reads delivery prices and the cylinder sizes an order may name. The fee strategy depends on this
 * lookup rather than on Prisma, so the cost rules can be tested with a fake one (PRC-012).
 */
@Injectable()
export class ZonePriceLookup {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The price row in one SQL statement (the quote route reads outside any transaction, the order's runs
   * at READ COMMITTED), or null when the distributor has no price in the zone.
   */
  async priceFor(distributorId: string, zoneId: string, db: Db = this.prisma): Promise<ZonePriceRow | null> {
    const rows = await db.$queryRaw<ZonePriceRow[]>`
      SELECT p.id, p.base_paisa AS "basePaisa", p.note, p.updated_at AS "updatedAt", p.updated_by_user_id AS "updatedByUserId"
      FROM distributor_zone_prices p
      WHERE p.distributor_id = ${distributorId}::uuid AND p.zone_id = ${zoneId}::uuid`;
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, basePaisa: row.basePaisa, note: row.note, updatedAt: row.updatedAt, updatedByUserId: row.updatedByUserId };
  }

  /** Every cylinder size, lightest first. The schema has no "archived size", so every cylinder type is a size. */
  async sizes(db: Db = this.prisma): Promise<CylinderSize[]> {
    const types = await db.cylinderType.findMany({ select: { id: true, code: true, name: true, weightKg: true } });
    return types.map(toCylinderSize).sort(compareSizes);
  }
}
