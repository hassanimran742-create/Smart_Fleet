import { Module } from '@nestjs/common';
import { AdminSummaryController } from './admin-summary.controller';
import { AdminSummaryService } from './admin-summary.service';

/**
 * Read-only office summary (API_CONTRACT §5.1: owns no table and calls no other module's service; it
 * reads the tables with the order tabs' shared definitions and the global settings).
 */
@Module({
  controllers: [AdminSummaryController],
  providers: [AdminSummaryService],
})
export class AdminSummaryModule {}
