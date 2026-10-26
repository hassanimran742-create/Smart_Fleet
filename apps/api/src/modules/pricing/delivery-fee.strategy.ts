import type { DeliveryQuote, FeeStrategy, IdName } from '@smartfleet/shared-types';
import type { Db } from '../orders/support/tx';

/** One size on an order, as quoted: full cylinders only. */
export interface FeeQuoteLineInput {
  cylinderTypeId: string;
  fullCount: number;
}

/** What a strategy prices (API_CONTRACT §5.6). */
export interface FeeQuoteContext {
  distributorId: string;
  /** Always the distributor's home store, never the body's (ADR-01). */
  originStore: { id: string; zoneId: string; lat: number; lng: number };
  /** The active zone covering the delivery pin (DATA_MODEL §6.6). */
  zone: IdName;
  destination: { lat: number; lng: number };
  /** The order's sizes. Each must be a known size; DISTRIBUTOR_ZONE's cost doesn't depend on them. */
  lines: FeeQuoteLineInput[];
}

/**
 * The cost of one order, computed by a {@link DeliveryFeeStrategy}. For DISTRIBUTOR_ZONE it is ONE flat
 * amount per order, whatever cylinders it holds, so `totalPaisa === basePaisa` (ADR-08). Money is BigInt
 * paisa inside the API; the wire turns it into digit strings. `price` names the price row it came from,
 * kept on the order as display-only `fee_details` (orders carry their own copy of the cost).
 */
export interface FeeQuote {
  strategy: FeeStrategy;
  zone: IdName;
  basePaisa: bigint;
  totalPaisa: bigint;
  price: { id: string; updatedAt: Date };
}

/**
 * How a delivery is priced (ADR-20). `DISTRIBUTOR_ZONE` is the pilot strategy; "zones crossed" can be
 * added later as another implementation, with no change to the orders table.
 */
export interface DeliveryFeeStrategy {
  readonly key: FeeStrategy;
  /** Throws 422 PRICING_PRICE_NOT_SET when the distributor has no price in the zone. */
  quote(ctx: FeeQuoteContext, db?: Db): Promise<FeeQuote>;
}

/** The wire shape of a quote (`Paisa` digit strings). */
export function toDeliveryQuote(quote: FeeQuote): DeliveryQuote {
  return {
    strategy: quote.strategy,
    zone: { id: quote.zone.id, name: quote.zone.name },
    basePaisa: quote.basePaisa.toString(),
    totalPaisa: quote.totalPaisa.toString(),
  };
}
