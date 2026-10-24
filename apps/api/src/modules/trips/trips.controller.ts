import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { DriverHomeDto, StopDetailDto, UnlabelledReturnsResult } from '@smartfleet/shared-types';
import {
  finishStopSchema,
  finishTripSchema,
  tripScanSchema,
  unlabelledReturnsSchema,
  updateTripStatusSchema,
  type FinishStopInput,
  type FinishTripInput,
  type TripScanInput,
  type UnlabelledReturnsInput,
  type UpdateTripStatusInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDriverId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { scanResponse } from '../custody/scan.service';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { SuggestionsService, type SuggestedTask } from './suggestions.service';
import { TripsService, type TripDetailView, type TripView } from './trips.service';

/**
 * Trips (API_CONTRACT §7.7, §9.3): a driver sees and moves only their own trips (another driver's gives
 * 404, like an unknown id); the office reads any trip and may abort one before anything happened. The
 * Inc 2 driver routes are DRIVER exact: the shop and the office get 403.
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
  byId(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string): Promise<TripDetailView> {
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

  /** Kept for the installed app; maps to the stop finish from Inc 2 (§9.10). */
  @ExactRoles(UserRole.DRIVER)
  @Patch('stops/:stopId/depart')
  depart(@CurrentActor() actor: UserActor, @Param('stopId', new UuidParam()) stopId: string) {
    return this.trips.depart(actor, stopId);
  }

  // ---------- Inc 2 (API_CONTRACT §9.3) ----------

  /** LOAD, HANDOVER or TAKE_BACK: 201 RECORDED; a resend 200 `Idempotent-Replay`; the same move again 200 `X-Already-Applied`. */
  @ExactRoles(UserRole.DRIVER)
  @Post(':tripId/scans')
  async scan(
    @CurrentActor() actor: UserActor,
    @Param('tripId', new UuidParam()) tripId: string,
    @Body(new ZodBody(tripScanSchema)) body: TripScanInput,
  ) {
    return scanResponse(await this.trips.scan(actor, tripId, body));
  }

  @ExactRoles(UserRole.DRIVER)
  @Get(':tripId/stops/:stopId')
  stop(
    @CurrentActor() actor: UserActor,
    @Param('tripId', new UuidParam()) tripId: string,
    @Param('stopId', new UuidParam()) stopId: string,
  ): Promise<StopDetailDto> {
    return this.trips.stopDetail(actor, tripId, stopId);
  }

  @ExactRoles(UserRole.DRIVER)
  @Put(':tripId/stops/:stopId/unlabelled-returns')
  @HttpCode(200)
  unlabelledReturns(
    @CurrentActor() actor: UserActor,
    @Param('tripId', new UuidParam()) tripId: string,
    @Param('stopId', new UuidParam()) stopId: string,
    @Body(new ZodBody(unlabelledReturnsSchema)) body: UnlabelledReturnsInput,
  ): Promise<UnlabelledReturnsResult> {
    return this.trips.unlabelledReturns(actor, tripId, stopId, body);
  }

  /** "Done loading" at the store stop, "Finish visit" at a customer's. */
  @ExactRoles(UserRole.DRIVER)
  @Post(':tripId/stops/:stopId/finish')
  @HttpCode(200)
  finishStop(
    @CurrentActor() actor: UserActor,
    @Param('tripId', new UuidParam()) tripId: string,
    @Param('stopId', new UuidParam()) stopId: string,
    @Body(new ZodBody(finishStopSchema)) body: FinishStopInput,
  ) {
    return this.trips.finishStop(actor, tripId, stopId, body);
  }

  /** "Finish trip". */
  @ExactRoles(UserRole.DRIVER)
  @Post(':tripId/finish')
  @HttpCode(200)
  finishTrip(
    @CurrentActor() actor: UserActor,
    @Param('tripId', new UuidParam()) tripId: string,
    @Body(new ZodBody(finishTripSchema)) body: FinishTripInput,
  ) {
    return this.trips.finishTrip(actor, tripId, body);
  }
}

/** `GET /driver/home` (DRIVER exact): the Inc 2 Today screen in one request. */
@Controller('driver')
@ExactRoles(UserRole.DRIVER)
export class DriverHomeController {
  constructor(private readonly trips: TripsService) {}

  @Get('home')
  home(@CurrentActor() actor: UserActor): Promise<DriverHomeDto> {
    return this.trips.driverHome(actor);
  }
}
