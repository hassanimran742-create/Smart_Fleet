import { Controller, Get, Param } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('pending/me')
  pendingMine(@CurrentUser() user: AuthContext) {
    return this.returns.pendingForDistributor(user.distributorId!);
  }

  @Roles(UserRole.STORE_KEEPER, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('store/:id/empties')
  emptiesAtStore(@Param('id') id: string) {
    return this.returns.emptiesAtStoreByDistributor(id);
  }
}
