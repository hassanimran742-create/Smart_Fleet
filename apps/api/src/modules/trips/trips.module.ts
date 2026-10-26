import { Module } from '@nestjs/common';
import { CustodyModule } from '../custody/custody.module';
import { SuggestionsService } from './suggestions.service';
import { DriverHomeController, TripsController } from './trips.controller';
import { TripsService } from './trips.service';

/**
 * Trips and stops (API_CONTRACT §5.1): owns `trips` and `trip_stops`. Scans go through custody's
 * ScanService; settings, audit, alerts and the customer confirmation are global.
 */
@Module({
  imports: [CustodyModule],
  controllers: [TripsController, DriverHomeController],
  providers: [TripsService, SuggestionsService],
  exports: [TripsService],
})
export class TripsModule {}
