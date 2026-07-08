import { Module } from '@nestjs/common';
import { FuelRefillsController } from './fuel-refills.controller';
import { FuelRefillsService } from './fuel-refills.service';

@Module({
  controllers: [FuelRefillsController],
  providers: [FuelRefillsService],
  exports: [FuelRefillsService],
})
export class FuelRefillsModule {}
