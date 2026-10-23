import { Controller, Get, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';

/** Inventory (API_CONTRACT §7.2: roles unchanged). A distributor's figures always come from its token. */
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
    // Without a distributor in the token the filter would be dropped (API_CONTRACT §3.2).
    if (!user.distributorId) throw new AppError('PERMISSION_DENIED');
    return this.inv.breakdownForDistributor(user.distributorId);
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

  // Per-type FULL/EMPTY load for a specific vehicle (admin view).
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get('vehicle/:id/summary')
  vehicleSummary(@Param('id') id: string) {
    return this.inv.vehicleSummary(id);
  }

  // Fleet-wide: every vehicle currently holding cylinders (full/empty by type).
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get('vehicles-summary')
  vehiclesSummary() {
    return this.inv.allVehiclesSummary();
  }

  // The signed-in driver's own vehicle load (full/empty by type).
  @Roles(UserRole.DRIVER)
  @Get('my-vehicle')
  myVehicle(@CurrentUser() user: AuthContext) {
    return this.inv.forMyVehicle(user.userId);
  }
}
