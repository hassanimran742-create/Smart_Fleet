import type { ISODateString, Paisa, UUID } from './common.types';

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
