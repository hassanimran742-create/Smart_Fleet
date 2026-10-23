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

export interface PriceSizeView {
  cylinderTypeId: UUID;
  sizeLabel: string;
  /** "0" when the size has no amount. */
  perCylinderPaisa: Paisa;
}

/**
 * A distributor's delivery price in one zone (ADR-08): a base per order plus an optional amount per
 * full cylinder by size. `sizes` lists every active size; a missing amount is "0".
 */
export interface PriceView {
  zone: IdName;
  basePaisa: Paisa;
  sizes: PriceSizeView[];
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

export interface DeliveryQuoteLine {
  cylinderTypeId: UUID;
  sizeLabel: string;
  count: number;
  perCylinderPaisa: Paisa;
  subtotalPaisa: Paisa;
}

/** The cost of one order: `totalPaisa = basePaisa + Σ subtotalPaisa`, with the base charged once. */
export interface DeliveryQuote {
  strategy: FeeStrategy;
  zone: IdName;
  basePaisa: Paisa;
  lines: DeliveryQuoteLine[];
  totalPaisa: Paisa;
}

export interface PriceGridSize {
  cylinderTypeId: UUID;
  code: string;
  label: string;
}

export interface PriceGridPrice {
  basePaisa: Paisa;
  sizes: { cylinderTypeId: UUID; perCylinderPaisa: Paisa }[];
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
  sizes: PriceGridSize[];
  zones: PriceGridZone[];
  coverage: { priced: number; total: number };
}
