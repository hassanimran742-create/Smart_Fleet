import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { updateTripStatusSchema, type UpdateTripStatusInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDriverId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { SuggestionsService, type SuggestedTask } from './suggestions.service';
import { TripsService, type TripView } from './trips.service';

/**
 * Trips (API_CONTRACT §7.7): a driver sees and moves only their own trips (another driver's gives
 * 404, like an unknown id); the office reads any trip and may abort one before anything happened.
 */
@Controller('trips')
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly suggestions: SuggestionsService,
  ) {}

  @ExactRoles(UserRole.DRIVER)
  @Get('mine')
  mine(@CurrentActor() actor: UserActor): Promise<TripView[]> {
    return this.trips.forDriver(ownDriverId(actor));
  }

  /** The driver's open tasks, nearest first (unchanged shape). */
  @ExactRoles(UserRole.DRIVER)
  @Get('next-suggestions')
  next(@CurrentActor() actor: UserActor): Promise<SuggestedTask[]> {
    return this.suggestions.forDriver(ownDriverId(actor));
  }

  @Roles(UserRole.DRIVER)
  @Get(':id')
  byId(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string): Promise<TripView> {
    return this.trips.byId(actor, id);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/status')
  setStatus(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(updateTripStatusSchema)) body: UpdateTripStatusInput,
  ) {
    return this.trips.setStatus(actor, id, body);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch('stops/:stopId/arrive')
  arrive(@CurrentActor() actor: UserActor, @Param('stopId', new UuidParam()) stopId: string) {
    return this.trips.arrive(actor, stopId);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch('stops/:stopId/depart')
  depart(@CurrentActor() actor: UserActor, @Param('stopId', new UuidParam()) stopId: string) {
    return this.trips.depart(actor, stopId);
  }
}
