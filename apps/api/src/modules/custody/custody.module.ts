import { Module } from '@nestjs/common';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';
import { CylinderHistoryService } from './history.service';
import { ScanService } from './scan.service';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { VanCheckJob } from './van-check.job';

/**
 * Custody (API_CONTRACT §5.1): owns the cylinders' holder and state, `cylinder_events` and
 * `stop_cylinders`. ScanService applies every move; the store routes, the cylinder history and the
 * 03:00 van check live here too. Settings, audit and alerts are global.
 */
@Module({
  controllers: [CustodyController, StoreController],
  providers: [CustodyService, ScanService, StoreService, CylinderHistoryService, VanCheckJob],
  exports: [CustodyService, ScanService, StoreService, CylinderHistoryService, VanCheckJob],
})
export class CustodyModule {}
