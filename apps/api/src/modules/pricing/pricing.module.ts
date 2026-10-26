import { Module } from '@nestjs/common';
import { ZonesModule } from '../zones/zones.module';
import { DistributorZoneStrategy } from './distributor-zone.strategy';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { ZonePriceLookup } from './zone-price.lookup';

/**
 * Delivery prices and quotes (API_CONTRACT §5.1, §5.6): owns `distributor_zone_prices`, one flat
 * delivery cost per order per distributor per zone; `pricing_rules` is frozen (kept, office-writable
 * through the legacy routes, never read by quotes, orders or fees).
 */
@Module({
  imports: [ZonesModule],
  controllers: [PricingController],
  providers: [PricingService, ZonePriceLookup, DistributorZoneStrategy],
  exports: [PricingService, ZonePriceLookup],
})
export class PricingModule {}
