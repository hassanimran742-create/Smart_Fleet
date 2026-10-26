import { Injectable } from '@nestjs/common';
import type {
  IdName,
  LocationQuote,
  PriceGridDto,
  PriceGridPrice,
  PriceGridZone,
  PriceView,
} from '@smartfleet/shared-types';
import type { LegacyPricingRuleInput, PutPriceInput } from '@smartfleet/shared-validation';
import type { Actor } from '../../common/auth/actor';
import { actorUserId } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX, type Db, type Tx } from '../orders/support/tx';
import { SettingsService } from '../settings/settings.service';
import { ZonesService } from '../zones/zones.service';
import type { DeliveryFeeStrategy, FeeQuote, FeeQuoteLineInput } from './delivery-fee.strategy';
import { DistributorZoneStrategy } from './distributor-zone.strategy';
import { ZonePriceLookup, type ZonePriceRow } from './zone-price.lookup';

/** A point on the map. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** What `price.set` and `price.remove` record: the delivery cost per order and the note. */
interface PriceSnapshot {
  basePaisa: string;
  note: string | null;
}

interface ZoneRef {
  id: string;
  name: string;
  isActive: boolean;
  cityName: string;
}

function snapshotOf(price: { basePaisa: bigint; note: string | null }): PriceSnapshot {
  return { basePaisa: price.basePaisa.toString(), note: price.note ?? null };
}

function sameSnapshot(a: PriceSnapshot, b: PriceSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Delivery prices and quotes (ADR-08, API_CONTRACT §5.6, §7.5). A price is ONE flat delivery cost per
 * order, one row per distributor per zone, edited in place with a before/after audit row; quotes read it
 * live, and orders keep their own copy of the cost. `pricing_rules` is frozen: only the office's legacy
 * routes read or write it.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zones: ZonesService,
    private readonly prices: ZonePriceLookup,
    private readonly distributorZone: DistributorZoneStrategy,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------- quotes (§5.6) ----------

  /**
   * The price at a pin, for the live pin panel and adding customers. Never throws for coverage:
   * `blockCode` says why a pin can't be served, and `serviceable === (blockCode === null)`.
   * A location's price depends only on the customer's zone, so the distributor's store isn't needed.
   */
  async quoteLocation(distributorId: string, point: GeoPoint, db: Db = this.prisma): Promise<LocationQuote> {
    const zone = await this.zones.findContainingPoint(point.lat, point.lng, db);
    if (!zone) return { serviceable: false, zone: null, price: null, blockCode: 'PRICING_ZONE_NOT_COVERED' };
    const price = await this.priceView(distributorId, zone, db);
    if (!price) return { serviceable: false, zone, price: null, blockCode: 'PRICING_PRICE_NOT_SET' };
    return { serviceable: true, zone, price, blockCode: null };
  }

  /**
   * The cost of an order to a pin. The origin is always the distributor's home store (409
   * DISTRIBUTOR_NO_STORE without one); 422 PRICING_ZONE_NOT_COVERED or PRICING_PRICE_NOT_SET when the
   * pin can't be priced. Pass the order's transaction so the quote and the placement read one state.
   */
  async quoteOrder(distributorId: string, point: GeoPoint, lines: readonly FeeQuoteLineInput[], db: Db = this.prisma): Promise<FeeQuote> {
    const distributor = await db.distributor.findUnique({ where: { id: distributorId }, select: { homeStoreId: true } });
    if (!distributor) throw new AppError('NOT_FOUND');
    if (!distributor.homeStoreId) throw new AppError('DISTRIBUTOR_NO_STORE');
    const stores = await db.$queryRaw<Array<{ id: string; zone_id: string; lat: number; lng: number }>>`
      SELECT id, zone_id, ST_Y(location) AS lat, ST_X(location) AS lng FROM stores WHERE id = ${distributor.homeStoreId}::uuid`;
    const store = stores[0];
    if (!store) throw new AppError('DISTRIBUTOR_NO_STORE');
    const zone = await this.zones.findContainingPoint(point.lat, point.lng, db);
    if (!zone) throw new AppError('PRICING_ZONE_NOT_COVERED');
    const strategy = await this.strategy();
    return strategy.quote(
      {
        distributorId,
        originStore: { id: store.id, zoneId: store.zone_id, lat: store.lat, lng: store.lng },
        zone,
        destination: { lat: point.lat, lng: point.lng },
        lines: lines.map((line) => ({ cylinderTypeId: line.cylinderTypeId, fullCount: line.fullCount })),
      },
      db,
    );
  }

  /** A distributor's delivery cost per order in a zone, or null when none is set. */
  async priceView(distributorId: string, zone: IdName, db: Db = this.prisma): Promise<PriceView | null> {
    const price = await this.prices.priceFor(distributorId, zone.id, db);
    if (!price) return null;
    return { zone: { id: zone.id, name: zone.name }, basePaisa: price.basePaisa.toString(), updatedAt: price.updatedAt.toISOString() };
  }

  /** The strategy named by setting `pricing.deliveryStrategy` (only DISTRIBUTOR_ZONE exists). */
  private async strategy(): Promise<DeliveryFeeStrategy> {
    const key = await this.settings.get('pricing.deliveryStrategy');
    if (key === this.distributorZone.key) return this.distributorZone;
    throw new AppError('INTERNAL_ERROR', { reason: 'UNKNOWN_DELIVERY_STRATEGY' });
  }

  // ---------- the office price grid (§7.5) ----------

  /** `GET /pricing/prices/:distributorId`: one row per zone; `coverage.total` counts active zones. */
  async grid(distributorId: string): Promise<PriceGridDto> {
    const distributor = await this.prisma.distributor.findUnique({
      where: { id: distributorId },
      select: {
        id: true,
        businessName: true,
        code: true,
        homeStore: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } },
      },
    });
    if (!distributor) throw new AppError('NOT_FOUND');
    const [zones, prices] = await Promise.all([this.allZones(), this.prisma.distributorZonePrice.findMany({ where: { distributorId } })]);
    const names = await this.userNames(prices.map((price) => price.updatedByUserId));
    const priceByZone = new Map(prices.map((price) => [price.zoneId, price]));
    const rows: PriceGridZone[] = zones.map((zone) => {
      const price = priceByZone.get(zone.id);
      return { zone: this.zoneOut(zone), price: price ? this.gridPrice(price, names) : null };
    });
    return {
      distributor: {
        id: distributor.id,
        businessName: distributor.businessName,
        code: distributor.code ?? '',
        store: distributor.homeStore
          ? { id: distributor.homeStore.id, name: distributor.homeStore.name, zone: { ...distributor.homeStore.zone } }
          : null,
      },
      zones: rows,
      coverage: {
        priced: rows.filter((row) => row.zone.isActive && row.price !== null).length,
        total: zones.filter((zone) => zone.isActive).length,
      },
    };
  }

  /**
   * `PUT /pricing/prices/:distributorId/:zoneId` (office): the delivery cost per order. One transaction
   * upserts the row, audited `price.set` with before and after. A body equal to the stored price writes
   * nothing. Two first saves at once both succeed in turn: the second waits for the first row, then edits
   * it, so the stored price is always one body in full.
   */
  async putPrice(actor: Actor, distributorId: string, zoneId: string, body: PutPriceInput): Promise<PriceGridZone> {
    const distributor = await this.prisma.distributor.findUnique({ where: { id: distributorId }, select: { id: true, businessName: true } });
    if (!distributor) throw new AppError('NOT_FOUND', { field: 'distributorId' });
    const zone = await this.zoneRef(zoneId);
    if (!zone.isActive) throw new AppError('ZONE_ARCHIVED');
    const wanted = snapshotOf({ basePaisa: BigInt(body.basePaisa), note: body.note ?? null });
    const by = actorUserId(actor);
    const diff = { distributor: distributor.businessName, zone: zone.name };

    await this.prisma.$transaction(async (tx) => {
      let current = await this.lockPrice(tx, distributorId, zoneId);
      if (!current) {
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO distributor_zone_prices (id, distributor_id, zone_id, base_paisa, note, updated_by_user_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${distributorId}::uuid, ${zoneId}::uuid, ${BigInt(wanted.basePaisa)}, ${wanted.note},
                  ${by}::uuid, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
          ON CONFLICT (distributor_id, zone_id) DO NOTHING
          RETURNING id`;
        if (inserted[0]) {
          await this.audit.record(
            { action: 'price.set', actor, resourceType: 'price', resourceId: inserted[0].id, distributorId, before: null, after: wanted, diff },
            tx,
          );
          return;
        }
        // A save racing this one created the row first: edit it, as a second save would.
        current = await this.lockPrice(tx, distributorId, zoneId);
        if (!current) throw new AppError('CONFLICT_STALE_STATE');
      }
      const before = snapshotOf(current);
      if (sameSnapshot(before, wanted)) return;
      await tx.$executeRaw`
        UPDATE distributor_zone_prices
        SET base_paisa = ${BigInt(wanted.basePaisa)}, note = ${wanted.note}, updated_by_user_id = ${by}::uuid, updated_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${current.id}::uuid`;
      await this.audit.record(
        { action: 'price.set', actor, resourceType: 'price', resourceId: current.id, distributorId, before, after: wanted, diff },
        tx,
      );
    }, LOCKING_TX);
    return this.gridRow(distributorId, zone);
  }

  /**
   * `DELETE /pricing/prices/:distributorId/:zoneId` (office) `{ reason }`: the zone is blocked again.
   * Audited `price.remove` with the old price as before. With no price set: 200 `X-Already-Applied`
   * and no audit row. It works on an archived zone too.
   */
  async removePrice(actor: Actor, distributorId: string, zoneId: string, reason: string): Promise<PriceGridZone | IdempotentResponse<PriceGridZone>> {
    const distributor = await this.prisma.distributor.findUnique({ where: { id: distributorId }, select: { id: true, businessName: true } });
    if (!distributor) throw new AppError('NOT_FOUND', { field: 'distributorId' });
    const zone = await this.zoneRef(zoneId);
    const removed = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockPrice(tx, distributorId, zoneId);
      if (!current) return false;
      await tx.distributorZonePrice.delete({ where: { id: current.id } });
      await this.audit.record(
        {
          action: 'price.remove',
          actor,
          resourceType: 'price',
          resourceId: current.id,
          distributorId,
          reason,
          before: snapshotOf(current),
          after: null,
          diff: { distributor: distributor.businessName, zone: zone.name },
        },
        tx,
      );
      return true;
    }, LOCKING_TX);
    const row = await this.gridRow(distributorId, zone);
    return removed ? row : alreadyApplied(row);
  }

  /** `{ priced, total }` per distributor: active zones with a price, out of all active zones. */
  async coverage(distributorIds: readonly string[], db: Db = this.prisma): Promise<Map<string, { priced: number; total: number }>> {
    const total = await db.zone.count({ where: { isActive: true } });
    if (distributorIds.length === 0) return new Map();
    const priced = await db.distributorZonePrice.groupBy({
      by: ['distributorId'],
      where: { distributorId: { in: [...distributorIds] }, zone: { isActive: true } },
      _count: { _all: true },
    });
    const pricedBy = new Map(priced.map((row) => [row.distributorId, row._count._all]));
    return new Map(distributorIds.map((id) => [id, { priced: pricedBy.get(id) ?? 0, total }]));
  }

  // ---------- the frozen legacy routes ----------

  /** `GET /pricing/city/:cityId` (office): today's legacy shape. Never read by quotes, orders or fees. */
  listLegacyRules(cityId: string) {
    return this.prisma.pricingRule.findMany({
      where: { cityId, effectiveUntil: null },
      orderBy: [{ originZoneId: 'asc' }, { destZoneId: 'asc' }],
    });
  }

  /** `POST /pricing/rules` (office): writes `pricing_rules` as today. Nothing else reads the table. */
  async upsertLegacyRule(input: LegacyPricingRuleInput) {
    const [city, origin, dest, type] = await Promise.all([
      this.prisma.city.findUnique({ where: { id: input.cityId }, select: { id: true } }),
      this.prisma.zone.findUnique({ where: { id: input.originZoneId }, select: { id: true } }),
      this.prisma.zone.findUnique({ where: { id: input.destZoneId }, select: { id: true } }),
      this.prisma.cylinderType.findUnique({ where: { id: input.cylinderTypeId }, select: { id: true } }),
    ]);
    if (!city) throw new AppError('NOT_FOUND', { field: 'cityId' });
    if (!origin) throw new AppError('NOT_FOUND', { field: 'originZoneId' });
    if (!dest) throw new AppError('NOT_FOUND', { field: 'destZoneId' });
    if (!type) throw new AppError('NOT_FOUND', { field: 'cylinderTypeId' });
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.pricingRule.updateMany({
        where: {
          cityId: input.cityId,
          originZoneId: input.originZoneId,
          destZoneId: input.destZoneId,
          cylinderTypeId: input.cylinderTypeId,
          effectiveUntil: null,
        },
        data: { effectiveUntil: now },
      });
      return tx.pricingRule.create({
        data: {
          cityId: input.cityId,
          originZoneId: input.originZoneId,
          destZoneId: input.destZoneId,
          cylinderTypeId: input.cylinderTypeId,
          basePaisa: BigInt(input.basePaisa),
          perUnitPaisa: BigInt(input.perUnitPaisa),
          effectiveFrom: now,
        },
      });
    });
  }

  // ---------- internals ----------

  private async lockPrice(tx: Tx, distributorId: string, zoneId: string): Promise<ZonePriceRow | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM distributor_zone_prices
      WHERE distributor_id = ${distributorId}::uuid AND zone_id = ${zoneId}::uuid
      FOR UPDATE`;
    if (!rows[0]) return null;
    return this.prices.priceFor(distributorId, zoneId, tx);
  }

  private async zoneRef(zoneId: string): Promise<ZoneRef> {
    const zone = await this.prisma.zone.findUnique({
      where: { id: zoneId },
      select: { id: true, name: true, isActive: true, city: { select: { name: true } } },
    });
    if (!zone) throw new AppError('NOT_FOUND', { field: 'zoneId' });
    return { id: zone.id, name: zone.name, isActive: zone.isActive, cityName: zone.city.name };
  }

  private async allZones(): Promise<ZoneRef[]> {
    const zones = await this.prisma.zone.findMany({
      select: { id: true, name: true, isActive: true, city: { select: { name: true } } },
      orderBy: [{ city: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    });
    return zones.map((zone) => ({ id: zone.id, name: zone.name, isActive: zone.isActive, cityName: zone.city.name }));
  }

  private zoneOut(zone: ZoneRef): PriceGridZone['zone'] {
    return { id: zone.id, name: zone.name, cityName: zone.cityName, isActive: zone.isActive };
  }

  private async gridRow(distributorId: string, zone: ZoneRef): Promise<PriceGridZone> {
    const price = await this.prices.priceFor(distributorId, zone.id);
    const names = await this.userNames(price ? [price.updatedByUserId] : []);
    // The zone is read again: an archive between the check and the answer shows as it now is.
    const fresh = await this.zoneRef(zone.id);
    return { zone: this.zoneOut(fresh), price: price ? this.gridPrice(price, names) : null };
  }

  private gridPrice(price: { basePaisa: bigint; updatedAt: Date; updatedByUserId: string | null }, names: Map<string, string>): PriceGridPrice {
    const by = price.updatedByUserId;
    return {
      basePaisa: price.basePaisa.toString(),
      updatedAt: price.updatedAt.toISOString(),
      updatedBy: by && names.has(by) ? { id: by, name: names.get(by) as string } : null,
    };
  }

  private async userNames(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
    if (wanted.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
