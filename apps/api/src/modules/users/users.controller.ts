import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  resetUserPasswordSchema,
  setUserRoleSchema,
  setUserStatusSchema,
  usersQuerySchema,
  type ResetUserPasswordInput,
  type SetUserRoleInput,
  type SetUserStatusInput,
  type UsersQuery,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { AuthContext, CurrentActor, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Any signed-in user's own profile, secrets stripped (the apps' side menus and profile screens). */
  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.users.profile(user.userId);
  }

  /** Name and email only; phone, CNIC and business name are office-only (403 USER_FIELD_OFFICE_ONLY). */
  @Patch('me')
  updateMe(@CurrentUser() user: AuthContext, @Body() body: unknown) {
    return this.users.updateMe(user.userId, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get()
  list(@Query(new ZodQuery(usersQuerySchema)) query: UsersQuery) {
    return this.users.list(query.role);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get(':id')
  byId(@Param('id') id: string) {
    return this.users.profile(id);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  setStatus(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(setUserStatusSchema)) body: SetUserStatusInput,
  ) {
    return this.users.setStatus(actor, id, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/role')
  setRole(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(setUserRoleSchema)) body: SetUserRoleInput,
  ) {
    return this.users.setRole(actor, id, body);
  }

  /** The office types an app password for a distributor or driver login (API_CONTRACT §7.2). */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post(':id/password')
  @HttpCode(200)
  resetPassword(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(resetUserPasswordSchema)) body: ResetUserPasswordInput,
  ) {
    return this.users.resetPassword(actor, id, body.password);
  }
}
