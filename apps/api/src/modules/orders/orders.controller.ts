import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { OrderStatus, UserRole } from '@prisma/client';

// Who can move the order to which status. The driver can only flip
// IN_TRANSIT / DELIVERED (recorded from the active-trip flow).
// CANCELLED is admin/super-admin only (manual). CONFIRMED is for
// the "approval of partial cylinder availability" case.
const ROLE_ALLOWED_TARGETS: Record<string, OrderStatus[]> = {
  SUPER_ADMIN: ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED'],
  ADMIN:       ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED'],
  DISPATCHER:  ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED'],
  DRIVER:      ['IN_TRANSIT', 'DELIVERED', 'FAILED'],
};

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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  setStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { status: OrderStatus; reason?: string },
  ) {
    const allowed = ROLE_ALLOWED_TARGETS[user.role] ?? [];
    if (!allowed.includes(body.status)) {
      throw new ForbiddenException(
        `Role ${user.role} cannot move order to ${body.status}. Drivers can only mark IN_TRANSIT or DELIVERED; CANCELLED is admin-only.`,
      );
    }
    if (body.status === OrderStatus.CANCELLED && !body.reason) {
      throw new BadRequestException('A cancellation reason is required.');
    }
    return this.orders.updateStatus(id, body.status, body.reason);
  }
}
