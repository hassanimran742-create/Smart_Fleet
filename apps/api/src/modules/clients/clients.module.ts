import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/** Customers (API_CONTRACT §5.1): owns `clients` and `client_addresses`; coverage comes from pricing. */
@Module({
  imports: [PricingModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
