import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ClientPortalService } from './client-portal.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { Feature } from '../../common/features/feature';
import { UserRole } from '@prisma/client';

/** The customer app: switched off for the pilot (ADR-03, `features.clientApp`); customers confirm by link. */
@Feature('clientApp')
@Controller('client-portal')
@Roles(UserRole.CLIENT)
export class ClientPortalController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get('orders')
  myOrders(@CurrentUser() user: AuthContext) {
    return this.portal.myOrders(user.userId);
  }

  @Get('active')
  active(@CurrentUser() user: AuthContext) {
    return this.portal.activeDeliveries(user.userId);
  }

  @Get('orders/:id')
  detail(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.portal.orderDetail(id, user.userId);
  }

  @Post('orders/:id/confirm-delivery')
  @HttpCode(200)
  confirmDelivery(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.portal.confirmDelivery(id, user.userId);
  }

  @Post('orders/:id/confirm-empties')
  @HttpCode(200)
  confirmEmpties(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.portal.confirmEmptiesHandover(id, user.userId);
  }
}
