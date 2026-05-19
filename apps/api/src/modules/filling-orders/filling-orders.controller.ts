import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FillingOrdersService } from './filling-orders.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { FillingOrderStatus, UserRole } from '@prisma/client';

@Controller('filling-orders')
export class FillingOrdersController {
  constructor(private readonly orders: FillingOrdersService) {}

  // Distributor places a request, or admin places on their behalf.
  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.orders.create({
      ...body,
      distributorId: user.distributorId ?? body.distributorId,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  listAll(@Query('status') status?: FillingOrderStatus, @Query('driverId') driverId?: string) {
    return this.orders.list({ status, driverId });
  }

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('mine')
  listMine(@CurrentUser() user: AuthContext) {
    return this.orders.list({ distributorId: user.distributorId });
  }

  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('driver/mine')
  listDriverMine(@CurrentUser() user: AuthContext) {
    return this.orders.list({ driverId: user.driverId });
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.orders.byId(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get(':id/batch-candidates')
  batchCandidates(@Param('id') id: string, @Query('radiusKm') radiusKm?: string) {
    return this.orders.batchCandidates(id, radiusKm ? Number(radiusKm) : 5);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body('driverId') driverId: string) {
    return this.orders.assign(id, driverId);
  }

  // Driver lifecycle transitions
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/picked-empties')
  markPickedEmpties(@Param('id') id: string, @Body('emptyCount') emptyCount: number) {
    return this.orders.markPickedEmpties(id, emptyCount);
  }

  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/at-station')
  markAtStation(@Param('id') id: string) {
    return this.orders.markAtStation(id);
  }

  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/filled')
  markFilled(@Param('id') id: string, @Body('filledCount') filledCount: number) {
    return this.orders.markFilled(id, filledCount);
  }

  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/returned')
  markReturned(@Param('id') id: string) {
    return this.orders.markReturned(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.orders.complete(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DISTRIBUTOR)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason: string) {
    return this.orders.cancel(id, reason);
  }
}
