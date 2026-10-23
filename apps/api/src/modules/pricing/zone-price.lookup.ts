import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Db } from '../orders/support/tx';
import { compareSizes, toCylinderSize, type CylinderSize } from './size-label';

/** A distributor's current delivery price in one zone (DATA_MODEL §3.3). A size with no row costs 0. */
export interface ZonePriceRow {
  id: string;
  basePaisa: bigint;
  note: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
  sizes: { cylinderTypeId: string; perCylinderPaisa: bigint }[];
}

/**
 * Reads delivery prices and the sizes they are quoted in. The fee strategy depends on this lookup
 * rather than on Prisma, so the cost rules can be tested with a fake one (PRC-012).
 */
@Injectable()
export class ZonePriceLookup {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The price and its per-size amounts in **one** SQL statement, so one snapshot: a price edit (base
   * and size rows replaced in one transaction) committing during the read can never give one version's
   * base with the other's amounts, a total no price ever had. Prisma runs `findUnique({ include })` as
   * two SELECTs, and the quote route reads outside any transaction (the order's runs at READ COMMITTED).
   */
  async priceFor(distributorId: string, zoneId: string, db: Db = this.prisma): Promise<ZonePriceRow | null> {
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        basePaisa: bigint;
        note: string | null;
        updatedAt: Date;
        updatedByUserId: string | null;
        cylinderTypeId: string | null;
        perCylinderPaisa: bigint | null;
      }>
    >`
      SELECT p.id, p.base_paisa AS "basePaisa", p.note, p.updated_at AS "updatedAt", p.updated_by_user_id AS "updatedByUserId",
             s.cylinder_type_id AS "cylinderTypeId", s.per_cylinder_paisa AS "perCylinderPaisa"
      FROM distributor_zone_prices p
      LEFT JOIN distributor_zone_price_sizes s ON s.price_id = p.id
      WHERE p.distributor_id = ${distributorId}::uuid AND p.zone_id = ${zoneId}::uuid`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      basePaisa: row.basePaisa,
      note: row.note,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
      sizes: rows
        .filter((size) => size.cylinderTypeId !== null && size.perCylinderPaisa !== null)
        .map((size) => ({ cylinderTypeId: size.cylinderTypeId as string, perCylinderPaisa: size.perCylinderPaisa as bigint })),
    };
  }

  /**
   * Every cylinder size, lightest first. The schema has no "archived size", so every cylinder type is
   * an active size; a price lists all of them, a missing amount being 0.
   */
  async sizes(db: Db = this.prisma): Promise<CylinderSize[]> {
    const types = await db.cylinderType.findMany({ select: { id: true, code: true, name: true, weightKg: true } });
    return types.map(toCylinderSize).sort(compareSizes);
  }
}
