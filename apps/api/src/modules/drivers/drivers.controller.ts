import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  createDriverSchema,
  driverAvailabilitySchema,
  driverLocationSchema,
  driverOnlineSchema,
  driverReasonSchema,
  driverVehicleSchema,
  type CreateDriverInput,
  type DriverAvailabilityInput,
  type DriverLocationInput,
  type DriverOnlineInput,
  type DriverReasonInput,
  type DriverVehicleInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { AuthContext, CurrentActor, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { DriversService } from './drivers.service';

/**
 * API_CONTRACT §7.2. Office routes are SUPER_ADMIN exact; a driver may read their own profile, change
 * their own name and photo, and report their own position and online state (DRIVER exact). Any other
 * role gets 403 before a record is read; a driver naming another driver's id gets 404.
 */
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get()
  list() {
    return this.drivers.listForOffice();
  }

  /** The office, or the driver reading themselves. */
  @Roles(UserRole.DRIVER)
  @Get(':id')
  byId(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.drivers.view(user, id);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post()
  create(@CurrentActor() actor: UserActor, @Body(new ZodBody(createDriverSchema)) body: CreateDriverInput) {
    return this.drivers.create(actor, body);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/location')
  updateLocation(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body(new ZodBody(driverLocationSchema)) body: DriverLocationInput,
  ) {
    return this.drivers.updateLocation(user, id, body.lat, body.lng);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/online')
  setOnline(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body(new ZodBody(driverOnlineSchema)) body: DriverOnlineInput,
  ) {
    return this.drivers.updateOnline(user, id, body.isOnline);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/vehicle')
  assignVehicle(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(driverVehicleSchema)) body: DriverVehicleInput,
  ) {
    return this.drivers.assignVehicle(actor, id, body);
  }

  /** The office edits any field; a driver on themselves only name and photo (USER_FIELD_OFFICE_ONLY). */
  @Roles(UserRole.DRIVER)
  @Patch(':id/profile')
  updateProfile(@CurrentActor() actor: UserActor, @Param('id') id: string, @Body() body: unknown) {
    return this.drivers.updateProfile(actor, id, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/availability')
  setAvailability(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(driverAvailabilitySchema)) body: DriverAvailabilityInput,
  ) {
    return this.drivers.setAvailability(actor, id, body);
  }

  /** Archive (API_CONTRACT §7.2): needs a reason; ends the driver's sessions. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Delete(':id')
  archive(@CurrentActor() actor: UserActor, @Param('id') id: string, @Body(new ZodBody(driverReasonSchema)) body: DriverReasonInput) {
    return this.drivers.archive(actor, id, body.reason);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/reactivate')
  reactivate(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(driverReasonSchema)) body: DriverReasonInput,
  ) {
    return this.drivers.reactivate(actor, id, body.reason);
  }
}
