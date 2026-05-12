import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ZonesModule } from '../zones/zones.module';

@Module({
  imports: [ZonesModule, BullModule.registerQueue({ name: 'dispatch' })],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
