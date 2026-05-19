import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FuelRefillsService } from './fuel-refills.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('fuel-refills')
export class FuelRefillsController {
  constructor(private readonly refills: FuelRefillsService) {}

  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.refills.create({
      ...body,
      driverId: user.driverId ?? body.driverId,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  listAll(@Query('since') since?: string) {
    return this.refills.listAll(since ? new Date(since) : undefined);
  }

  @Get('vehicle/:id')
  forVehicle(@Param('id') id: string) {
    return this.refills.forVehicle(id);
  }

  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('mine')
  mine(@CurrentUser() user: AuthContext) {
    return this.refills.forDriver(user.driverId!);
  }

  @Get('driver/:id')
  forDriver(@Param('id') id: string) {
    return this.refills.forDriver(id);
  }
}
