import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { SettingsService } from '../../modules/settings/settings.service';
import { AppError } from '../errors/app-error';
import { EXACT_ROLES_KEY, ROLES_KEY } from '../decorators/roles.decorator';
import { assertSettingSwitchOn, settingSwitchOf } from '../features/feature';

interface RoleRule {
  roles: UserRole[];
  exact: boolean;
}

/**
 * Global (registered by AuthModule after JwtAuthGuard). The nearest rule wins: a handler's
 * `@ExactRoles`/`@Roles`, else the class's.
 * - `@Roles(...)`: those roles, and SUPER_ADMIN always passes (the office may use every such route).
 * - `@ExactRoles(...)`: exactly those roles, no SUPER_ADMIN bypass.
 * A refusal is 403 PERMISSION_DENIED, without naming the roles.
 *
 * A route behind `@SettingSwitch` is checked first: while its setting is off, every caller gets 403
 * FEATURE_DISABLED before the role check (API_CONTRACT §3.4).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const settingSwitch = this.settings ? settingSwitchOf(this.reflector, context) : undefined;
    if (settingSwitch && this.settings) {
      return assertSettingSwitchOn(settingSwitch, context, this.settings).then(() => this.checkRoles(context));
    }
    return this.checkRoles(context);
  }

  private checkRoles(context: ExecutionContext): boolean {
    const rule = this.ruleFor(context.getHandler()) ?? this.ruleFor(context.getClass());
    if (!rule) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (!user?.role) throw new AppError('AUTH_TOKEN_INVALID');

    if (!rule.exact && user.role === UserRole.SUPER_ADMIN) return true;
    if (!rule.roles.includes(user.role as UserRole)) throw new AppError('PERMISSION_DENIED');
    return true;
  }

  private ruleFor(target: object): RoleRule | null {
    const exact = this.reflector.get<UserRole[] | undefined>(EXACT_ROLES_KEY, target as never);
    if (exact && exact.length > 0) return { roles: exact, exact: true };
    const roles = this.reflector.get<UserRole[] | undefined>(ROLES_KEY, target as never);
    if (roles && roles.length > 0) return { roles, exact: false };
    return null;
  }
}
