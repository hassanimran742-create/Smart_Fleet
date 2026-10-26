import type { UserRole } from '@prisma/client';
import type { AuthContext } from '../decorators/current-user.decorator';

/**
 * Who performs a change (API_CONTRACT §5.3). Every money, state, setting and audit call takes one.
 * - USER: a signed-in user, from the access token.
 * - SYSTEM: a job, CLI or migration, named by `label` (`job:wallet-check`, `cli:settings`, `migration:inc1a`).
 * - CUSTOMER: a customer on a confirmation link (Inc 2), `label` like `link:AG-0142`.
 */
export type UserActor = {
  kind: 'USER';
  userId: string;
  role: UserRole;
  distributorId?: string;
  driverId?: string;
};
export type SystemActor = { kind: 'SYSTEM'; label: string };
export type CustomerActor = { kind: 'CUSTOMER'; label: string };
export type Actor = UserActor | SystemActor | CustomerActor;

/** The actor of a signed-in request (`@CurrentUser()` → `userActor(user)`, or `@CurrentActor()`). */
export function userActor(auth: Pick<AuthContext, 'userId' | 'role' | 'distributorId' | 'driverId'>): UserActor {
  return {
    kind: 'USER',
    userId: auth.userId,
    role: auth.role as UserRole,
    ...(auth.distributorId ? { distributorId: auth.distributorId } : {}),
    ...(auth.driverId ? { driverId: auth.driverId } : {}),
  };
}

export function systemActor(label: string): SystemActor {
  return { kind: 'SYSTEM', label };
}

export function customerActor(label: string): CustomerActor {
  return { kind: 'CUSTOMER', label };
}

/** The user id of a USER actor; null for jobs, CLIs and customers (`*_by_user_id` columns). */
export function actorUserId(actor: Actor): string | null {
  return actor.kind === 'USER' ? actor.userId : null;
}
