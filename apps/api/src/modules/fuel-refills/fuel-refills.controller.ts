import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  createFuelRefillSchema,
  fuelRefillsQuerySchema,
  type CreateFuelRefillInput,
  type FuelRefillsQuery,
} from '@smartfleet/shared-validation';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { Feature } from '../../common/features/feature';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { FuelRefillsService } from './fuel-refills.service';

/**
 * Fuel logs (API_CONTRACT §7.2). `features.fuelRefills` (off) gates only the drivers' own routes:
 * `POST /fuel-refills` gets 403 FEATURE_DISABLED and `GET /fuel-refills/mine` `[]`, both with
 * `X-Feature-Disabled: fuelRefills`. The office routes answer whatever the switch.
 */
@Controller('fuel-refills')
export class FuelRefillsController {
  constructor(private readonly refills: FuelRefillsService) {}

  @Feature('fuelRefills')
  @ExactRoles(UserRole.DRIVER)
  @Post()
  create(@CurrentUser() user: AuthContext, @Body(new ZodBody(createFuelRefillSchema)) body: CreateFuelRefillInput) {
    if (!user.driverId) throw new AppError('PERMISSION_DENIED');
    return this.refills.create(user.driverId, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get()
  listAll(@Query(new ZodQuery(fuelRefillsQuerySchema)) query: FuelRefillsQuery) {
    return this.refills.listAll(query.since ? new Date(query.since) : undefined);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get('vehicle/:id')
  forVehicle(@Param('id') id: string) {
    return this.refills.forVehicle(id);
  }

  @Feature('fuelRefills')
  @ExactRoles(UserRole.DRIVER)
  @Get('mine')
  mine(@CurrentUser() user: AuthContext) {
    if (!user.driverId) throw new AppError('PERMISSION_DENIED');
    return this.refills.forDriver(user.driverId);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get('driver/:id')
  forDriver(@Param('id') id: string) {
    return this.refills.forDriver(id);
  }
}
