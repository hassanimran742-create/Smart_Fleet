import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { TripsModule } from '../trips/trips.module';
import { WalletModule } from '../wallet/wallet.module';
import { OrdersFeePolicy } from './orders-fee.policy';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Orders (API_CONTRACT §5.1): owns `orders` and `order_lines`. Prices come from pricing, trips from
 * trips, and every money move goes through WalletService by way of OrdersFeePolicy, the one place the
 * fee rules live.
 */
@Module({
  imports: [PricingModule, TripsModule, WalletModule, BullModule.registerQueue({ name: 'dispatch' })],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersFeePolicy],
  exports: [OrdersService, OrdersFeePolicy],
})
export class OrdersModule {}
