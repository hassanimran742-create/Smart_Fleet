import type { IdName, IsoDateTime, ISODateString, Paisa, UUID } from './common.types';
import type { FeeStrategy } from './order.types';

/** @deprecated Frozen legacy zone-pair pricing (`pricing_rules`). Delivery prices are per distributor per zone. */
export interface PricingRule {
  id: UUID;
  cityId: UUID;
  originZoneId: UUID;
  destZoneId: UUID;
  cylinderTypeId: UUID;
  basePaisa: Paisa;
  perUnitPaisa: Paisa;
  effectiveFrom: ISODateString;
  effectiveUntil?: ISODateString;
}

/** The two ways a location can be blocked from delivery (API_CONTRACT §7.5). */
export type PricingBlockCode = 'PRICING_ZONE_NOT_COVERED' | 'PRICING_PRICE_NOT_SET';

/** Whether a customer address can be priced: SET, NOT_SET (zone without a price) or OUTSIDE every zone. */
export type PriceStatus = 'SET' | 'NOT_SET' | 'OUTSIDE';

/**
 * A distributor's delivery cost in one zone (ADR-08): ONE flat amount per order, whatever cylinders the
 * order holds. `basePaisa` is that cost (the name is kept from the earlier base-plus-sizes price).
 */
export interface PriceView {
  zone: IdName;
  /** The delivery cost per order. */
  basePaisa: Paisa;
  updatedAt: IsoDateTime;
}

/** `GET /pricing/quote?lat&lng`: always 200; a blocked location carries `blockCode`. */
export interface LocationQuote {
  /** Exactly `blockCode === null`. */
  serviceable: boolean;
  zone: IdName | null;
  price: PriceView | null;
  blockCode: PricingBlockCode | null;
}

/**
 * The cost of one order: the zone's flat delivery cost, charged once per order. `basePaisa` and
 * `totalPaisa` are the same amount; both are kept for the apps that read either.
 */
export interface DeliveryQuote {
  strategy: FeeStrategy;
  zone: IdName;
  basePaisa: Paisa;
  totalPaisa: Paisa;
}

export interface PriceGridPrice {
  /** The delivery cost per order. */
  basePaisa: Paisa;
  updatedAt: IsoDateTime;
  updatedBy: IdName | null;
}

export interface PriceGridZone {
  zone: { id: UUID; name: string; cityName: string; isActive: boolean };
  /** Null when no price is set: customers in this zone are blocked. */
  price: PriceGridPrice | null;
}

/** `GET /pricing/prices/:distributorId` (office): one row per zone. `coverage.total` counts active zones. */
export interface PriceGridDto {
  distributor: {
    id: UUID;
    businessName: string;
    code: string;
    /** Null only while the distributor's store is not set up. */
    store: { id: UUID; name: string; zone: IdName } | null;
  };
  zones: PriceGridZone[];
  coverage: { priced: number; total: number };
}
