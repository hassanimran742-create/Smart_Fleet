import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { ReconciliationStatus, UserRole } from '@prisma/client';

@Controller('reconciliations')
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  @Roles(UserRole.DRIVER)
  @Post()
  submit(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.recon.submit({ ...body, driverId: user.driverId });
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('pending')
  pending() {
    return this.recon.pending();
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Post(':id/verify')
  verify(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { status: ReconciliationStatus; note?: string },
  ) {
    return this.recon.verify(id, user.userId, body.status, body.note);
  }
}
