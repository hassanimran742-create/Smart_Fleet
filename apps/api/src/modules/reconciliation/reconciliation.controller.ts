import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { ReconciliationStatus, UserRole } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';

/** The driver's end-of-day cash form (API_CONTRACT §7.2: unchanged; retired in Inc 3). */
@Controller('reconciliations')
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  // The driver's own form: no office bypass, and the driver comes from the token.
  @ExactRoles(UserRole.DRIVER)
  @Post()
  submit(@CurrentUser() user: AuthContext, @Body() body: any) {
    if (!user.driverId) throw new AppError('PERMISSION_DENIED');
    return this.recon.submit({ ...body, driverId: user.driverId });
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('pending')
  pending() {
    return this.recon.pending();
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Post(':id/verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { status: ReconciliationStatus; note?: string },
  ) {
    return this.recon.verify(id, user.userId, body.status, body.note);
  }
}
