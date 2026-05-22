import { BadRequestException, Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { TripsService } from './trips.service';
import { SuggestionsService } from './suggestions.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { TripStatus } from '@prisma/client';

@Controller('trips')
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly suggestions: SuggestionsService,
  ) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthContext) {
    return this.trips.forDriver(user.driverId!);
  }

  // Ranks the driver's open tasks (orders / refills / transfers) by
  // distance from their current location. Tasks whose bearing matches
  // the driver's current heading are flagged onYourRoute=true and
  // sorted first.
  @Get('next-suggestions')
  next(@CurrentUser() user: AuthContext) {
    if (!user.driverId) throw new BadRequestException('Not signed in as a driver');
    return this.suggestions.forDriver(user.driverId);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.trips.byId(id);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: TripStatus) {
    return this.trips.setStatus(id, status);
  }

  // Drivers tap "Arrived" on a stop in the new step-by-step flow.
  @Patch('stops/:stopId/arrive')
  arrive(@Param('stopId') stopId: string) {
    return this.trips.markArrived(stopId);
  }

  @Patch('stops/:stopId/depart')
  depart(@Param('stopId') stopId: string) {
    return this.trips.markDeparted(stopId);
  }
}
