import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { TripsService } from './trips.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { TripStatus } from '@prisma/client';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthContext) {
    return this.trips.forDriver(user.driverId!);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.trips.byId(id);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: TripStatus) {
    return this.trips.setStatus(id, status);
  }
}
