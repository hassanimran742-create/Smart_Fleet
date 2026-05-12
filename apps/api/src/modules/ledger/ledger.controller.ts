import { Controller, Get } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('ledger')
@Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthContext) {
    return this.ledger.listForDistributor(user.distributorId!);
  }

  @Get('balance')
  balance(@CurrentUser() user: AuthContext) {
    return this.ledger.balanceOf(user.distributorId!);
  }
}
