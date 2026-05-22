import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { SuggestionsService } from './suggestions.service';

@Module({
  controllers: [TripsController],
  providers: [TripsService, SuggestionsService],
  exports: [TripsService],
})
export class TripsModule {}
