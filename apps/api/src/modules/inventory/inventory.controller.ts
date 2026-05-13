import { Controller, Get, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get('by-store')
  byStore() {
    return this.inv.byStore();
  }

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('me')
  forMe(@CurrentUser() user: AuthContext) {
    return this.inv.breakdownForDistributor(user.distributorId!);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get('store/:id')
  forStore(@Param('id') id: string) {
    return this.inv.forStore(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('distributor/:id')
  forDistributor(@Param('id') id: string) {
    return this.inv.forDistributor(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get('vehicle/:id')
  forVehicle(@Param('id') id: string) {
    return this.inv.forVehicle(id);
  }
}
