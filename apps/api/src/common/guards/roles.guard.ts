import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // SUPER_ADMIN is implicitly granted ANY endpoint, including those
    // tagged explicitly only for SUPER_ADMIN. This keeps the @Roles()
    // decorators readable across the codebase: callers list the
    // operational roles (ADMIN, DISPATCHER, etc.) and SUPER_ADMIN
    // never needs to be enumerated.
    if (user.role === UserRole.SUPER_ADMIN) return true;

    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}
