import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DistributorsService } from './distributors.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('distributors')
export class DistributorsController {
  constructor(private readonly distributors: DistributorsService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  list() {
    return this.distributors.list();
  }

  @Get('me')
  @Roles(UserRole.DISTRIBUTOR)
  me(@CurrentUser() user: AuthContext) {
    return this.distributors.findById(user.distributorId!);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get(':id')
  byId(@Param('id') id: string) {
    return this.distributors.findById(id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post()
  create(@Body() body: any) {
    return this.distributors.create(body);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.distributors.approve(id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  suspend(@Param('id') id: string) {
    return this.distributors.suspend(id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.distributors.update(id, body);
  }
}
