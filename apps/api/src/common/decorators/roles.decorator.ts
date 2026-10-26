import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const EXACT_ROLES_KEY = 'exactRoles';

/**
 * The roles that may call a route. SUPER_ADMIN (the office) always passes, so office-or-owner routes
 * list only the operational roles and add an ownership policy (API_CONTRACT §3.1).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Exactly these roles, with no SUPER_ADMIN bypass: for actions only the actor may take, such as a
 * distributor placing an order or a driver scanning (API_CONTRACT §3.1). Office-only routes use
 * `@ExactRoles(UserRole.SUPER_ADMIN)`. On a handler it overrides the class's `@Roles`/`@ExactRoles`.
 */
export const ExactRoles = (...roles: UserRole[]) => SetMetadata(EXACT_ROLES_KEY, roles);
