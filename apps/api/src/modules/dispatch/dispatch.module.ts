import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DispatchService } from './dispatch.service';
import { DispatchProcessor } from './dispatch.processor';
import { DispatchController } from './dispatch.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'dispatch' })],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchProcessor],
  exports: [DispatchService],
})
export class DispatchModule {}
