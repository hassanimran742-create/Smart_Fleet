import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AccessoriesService } from './accessories.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('accessories')
export class AccessoriesController {
  constructor(private readonly accessories: AccessoriesService) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.accessories.list({ includeInactive: includeInactive === 'true' });
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.accessories.byId(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: any) {
    return this.accessories.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.accessories.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.accessories.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.accessories.reactivate(id);
  }

  // Stock + movements
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get('stock/store/:storeId')
  stockForStore(@Param('storeId') storeId: string) {
    return this.accessories.stockForStore(storeId);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get('movements/store/:storeId')
  movementsForStore(@Param('storeId') storeId: string) {
    return this.accessories.movementsForStore(storeId);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Post('stock/adjust')
  adjustStock(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.accessories.adjustStock({ ...body, actorUserId: user.userId });
  }
}
