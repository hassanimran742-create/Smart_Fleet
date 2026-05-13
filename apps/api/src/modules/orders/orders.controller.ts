import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { OrderStatus, UserRole } from '@prisma/client';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.orders.create({ ...body, distributorId: user.distributorId ?? body.distributorId });
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('all')
  listAll(@Query('status') status?: OrderStatus) {
    return this.orders.listAll({ status });
  }

  @Get(':id/tracking')
  tracking(@Param('id') id: string) {
    return this.orders.tracking(id);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.orders.byId(id);
  }

  @Get()
  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  list(@CurrentUser() user: AuthContext) {
    return this.orders.listForDistributor(user.distributorId!);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  setStatus(
    @Param('id') id: string,
    @Body() body: { status: OrderStatus; reason?: string },
  ) {
    return this.orders.updateStatus(id, body.status, body.reason);
  }
}
