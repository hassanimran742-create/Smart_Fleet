import { Module } from '@nestjs/common';
import { ZonesModule } from '../zones/zones.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

/** Stores (API_CONTRACT §5.1): owns `stores`; a store's zone comes from the zone lookup. */
@Module({
  imports: [ZonesModule],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
