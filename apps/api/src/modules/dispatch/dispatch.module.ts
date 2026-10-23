import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DispatchController } from './dispatch.controller';
import { DispatchProcessor } from './dispatch.processor';
import { DispatchService } from './dispatch.service';

/** Automatic assignment, off for the pilot (ADR-12). Assigns through OrdersService when switched on. */
@Module({
  imports: [OrdersModule, BullModule.registerQueue({ name: 'dispatch' })],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchProcessor],
  exports: [DispatchService],
})
export class DispatchModule {}
