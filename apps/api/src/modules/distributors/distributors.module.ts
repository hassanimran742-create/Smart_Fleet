import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { StoresModule } from '../stores/stores.module';
import { WalletModule } from '../wallet/wallet.module';
import { ZonesModule } from '../zones/zones.module';
import { DistributorHomeController, DistributorsController } from './distributors.controller';
import { DistributorsService } from './distributors.service';

/**
 * Distributors (API_CONTRACT §5.1): owns `distributors` (except the balance) and creates its store row
 * through StoresService. Reads the wallet through WalletService and price coverage through pricing.
 * AuthModule's session check ends a shop's sessions at once after a suspend or a phone change.
 */
@Module({
  imports: [AuthModule, StoresModule, ZonesModule, PricingModule, WalletModule],
  controllers: [DistributorsController, DistributorHomeController],
  providers: [DistributorsService],
  exports: [DistributorsService],
})
export class DistributorsModule {}
