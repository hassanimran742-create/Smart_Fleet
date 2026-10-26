import { Module } from '@nestjs/common';
import { FillingOrdersController } from './filling-orders.controller';
import { FillingOrdersService } from './filling-orders.service';
import { RefillScanService } from './refill-scans.service';

/**
 * Refills (API_CONTRACT §5.1: filling_orders and, from Inc 3, filling_order_cylinders). The scans move
 * cylinders only through the custody module's move write (custody-moves.ts); the store's receive of a
 * refill cylinder calls refill-receive.ts from the custody scan service. No money.
 */
@Module({
  controllers: [FillingOrdersController],
  providers: [FillingOrdersService, RefillScanService],
  exports: [FillingOrdersService, RefillScanService],
})
export class FillingOrdersModule {}
