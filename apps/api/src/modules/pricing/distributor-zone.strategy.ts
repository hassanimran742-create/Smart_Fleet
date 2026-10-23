import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Db } from '../orders/support/tx';
import type { DeliveryFeeStrategy, FeeQuote, FeeQuoteContext, FeeQuoteLine } from './delivery-fee.strategy';
import { compareSizes } from './size-label';
import { ZonePriceLookup } from './zone-price.lookup';

/**
 * The pilot strategy, DISTRIBUTOR_ZONE (ADR-08, API_CONTRACT §5.6): the distributor's price for the
 * customer's zone. `total = base + Σ(per-size amount × full cylinders)`: the base is charged once per
 * order (the old code added it once per line), and a size with no amount costs 0.
 */
@Injectable()
export class DistributorZoneStrategy implements DeliveryFeeStrategy {
  readonly key = 'DISTRIBUTOR_ZONE' as const;

  constructor(private readonly prices: ZonePriceLookup) {}

  async quote(ctx: FeeQuoteContext, db?: Db): Promise<FeeQuote> {
    const [price, sizes] = await Promise.all([this.prices.priceFor(ctx.distributorId, ctx.zone.id, db), this.prices.sizes(db)]);
    if (!price) throw new AppError('PRICING_PRICE_NOT_SET', { zoneId: ctx.zone.id, zoneName: ctx.zone.name });

    const sizeById = new Map(sizes.map((size) => [size.id, size]));
    const amountBySize = new Map(price.sizes.map((size) => [size.cylinderTypeId, size.perCylinderPaisa]));
    const lines: Array<FeeQuoteLine & { order: { weightKg: number; code: string } }> = ctx.lines.map((line) => {
      const size = sizeById.get(line.cylinderTypeId);
      if (!size) throw new AppError('NOT_FOUND', { field: 'lines' });
      const perCylinderPaisa = amountBySize.get(line.cylinderTypeId) ?? 0n;
      return {
        cylinderTypeId: line.cylinderTypeId,
        sizeLabel: size.label,
        count: line.fullCount,
        perCylinderPaisa,
        subtotalPaisa: perCylinderPaisa * BigInt(line.fullCount),
        order: { weightKg: size.weightKg, code: size.code },
      };
    });
    lines.sort((a, b) => compareSizes(a.order, b.order));

    const totalPaisa = lines.reduce((sum, line) => sum + line.subtotalPaisa, price.basePaisa);
    return {
      strategy: this.key,
      zone: { id: ctx.zone.id, name: ctx.zone.name },
      basePaisa: price.basePaisa,
      lines: lines.map(({ order: _order, ...line }) => line),
      totalPaisa,
      price: { id: price.id, updatedAt: price.updatedAt },
    };
  }
}
