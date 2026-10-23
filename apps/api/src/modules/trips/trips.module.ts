import { Module } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

/** Trips and stops (API_CONTRACT §5.1): owns `trips` and `trip_stops`. */
@Module({
  controllers: [TripsController],
  providers: [TripsService, SuggestionsService],
  exports: [TripsService],
})
export class TripsModule {}
