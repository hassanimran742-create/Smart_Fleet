import { Module } from '@nestjs/common';
import { CustodyModule } from '../custody/custody.module';
import { DayEndClock } from './day-end-clock';
import { DayEndCore } from './day-end-core';
import { DayEndFiles } from './day-end-files';
import { DayEndOfficeService } from './day-end-office.service';
import { AdminDayEndController, DayEndController } from './day-end.controller';
import { DayEndService } from './day-end.service';

/**
 * [Inc 3] Day-end (API_CONTRACT §10.2, DATA_MODEL §5, settled points G09-01 to G09-13): the system-made
 * sheet with one row per cylinder, the shop's upload with its preview of every difference, the submit, and
 * the office's approve (every listed fix in one transaction, then the day locks), send-back and reopen.
 *
 * Owns `day_closes` and `day_close_lines` (§5.1). It calls custody for every holder and state change
 * (custody-moves.ts: one ADJUSTED event per fix; ScanService.registerMoves for a REGISTER) and files for
 * the two workbooks. Settings, audit, alerts and files are global. It never moves money and never refuses
 * a scan: the day lock (`DAY_LOCKED`) is answered by these routes only. No job creates day rows: the
 * first sheet download for a date does (G09-10).
 */
@Module({
  imports: [CustodyModule],
  controllers: [DayEndController, AdminDayEndController],
  providers: [DayEndClock, DayEndCore, DayEndFiles, DayEndService, DayEndOfficeService],
  exports: [DayEndClock, DayEndService, DayEndOfficeService],
})
export class DayEndModule {}
