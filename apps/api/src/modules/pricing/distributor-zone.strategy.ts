import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Db } from '../orders/support/tx';
import type { DeliveryFeeStrategy, FeeQuote, FeeQuoteContext } from './delivery-fee.strategy';
import { ZonePriceLookup } from './zone-price.lookup';

/**
 * The pilot strategy, DISTRIBUTOR_ZONE (ADR-08, API_CONTRACT §5.6): the distributor's delivery cost for
 * the customer's zone, ONE flat amount per order whatever cylinders it holds (owner, 2026-10-26: "We are
 * managing deliveries not cylinder pricing. Only delivery costs.").
 */
@Injectable()
export class DistributorZoneStrategy implements DeliveryFeeStrategy {
  readonly key = 'DISTRIBUTOR_ZONE' as const;

  constructor(private readonly prices: ZonePriceLookup) {}

  async quote(ctx: FeeQuoteContext, db?: Db): Promise<FeeQuote> {
    const [price, sizes] = await Promise.all([this.prices.priceFor(ctx.distributorId, ctx.zone.id, db), this.prices.sizes(db)]);
    if (!price) throw new AppError('PRICING_PRICE_NOT_SET', { zoneId: ctx.zone.id, zoneName: ctx.zone.name });
    // The order must still name known sizes, though they don't change the cost.
    const known = new Set(sizes.map((size) => size.id));
    if (ctx.lines.some((line) => !known.has(line.cylinderTypeId))) throw new AppError('NOT_FOUND', { field: 'lines' });
    return {
      strategy: this.key,
      zone: { id: ctx.zone.id, name: ctx.zone.name },
      basePaisa: price.basePaisa,
      totalPaisa: price.basePaisa,
      price: { id: price.id, updatedAt: price.updatedAt },
    };
  }
}
