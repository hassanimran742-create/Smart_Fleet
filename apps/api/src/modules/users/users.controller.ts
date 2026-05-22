import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole, UserStatus } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Signed-in user reads/updates their own profile. Used by every mobile
  // app to populate the side menu.
  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.users.findById(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.users.updateProfile(user.userId, body);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  list(@Query('role') role?: UserRole) {
    return this.users.list(role);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get(':id')
  byId(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: UserStatus) {
    return this.users.setStatus(id, status);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/role')
  setRole(@Param('id') id: string, @Body('role') role: UserRole) {
    return this.users.setRole(id, role);
  }
}
