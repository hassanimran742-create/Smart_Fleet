import { Controller, Get, Param } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';

/** Returns (API_CONTRACT §7.2: roles unchanged). A distributor's figures always come from its token. */
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('pending/me')
  pendingMine(@CurrentUser() user: AuthContext) {
    // Without a distributor in the token the filter would be dropped (API_CONTRACT §3.2).
    if (!user.distributorId) throw new AppError('PERMISSION_DENIED');
    return this.returns.pendingForDistributor(user.distributorId);
  }

  @Roles(UserRole.STORE_KEEPER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('store/:id/empties')
  emptiesAtStore(@Param('id') id: string) {
    return this.returns.emptiesAtStoreByDistributor(id);
  }
}
