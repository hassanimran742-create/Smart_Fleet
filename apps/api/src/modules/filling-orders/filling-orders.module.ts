import { Module } from '@nestjs/common';
import { FillingOrdersController } from './filling-orders.controller';
import { FillingOrdersService } from './filling-orders.service';

@Module({
  controllers: [FillingOrdersController],
  providers: [FillingOrdersService],
  exports: [FillingOrdersService],
})
export class FillingOrdersModule {}
