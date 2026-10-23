import { UserRole } from '@prisma/client';
import type { AppVariant } from '@smartfleet/shared-types';
import type { AuthContext } from '../../common/decorators/current-user.decorator';

/**
 * The claims of an access or refresh token (API_CONTRACT §7.1): `sub`, `role`, `distributorId`,
 * `driverId` and `tv`, the user's token version (§3.3). Tokens issued before `tv` existed carry none;
 * they count as version 0, the column's default, so a bump still ends them.
 */
export interface TokenClaims {
  sub: string;
  role: UserRole;
  distributorId?: string;
  driverId?: string;
  /** Only CLIENT tokens (the switched-off customer app) carry it. */
  clientId?: string;
  tv: number;
  /** Expiry, in seconds since the epoch (the JWT `exp`), when the token has one. */
  exp?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ReadonlySet<string> = new Set(Object.values(UserRole));

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined;
}

/** The claims of a verified token, or null when the payload doesn't have the documented shape. */
export function readTokenClaims(payload: unknown): TokenClaims | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.sub !== 'string' || !UUID.test(p.sub)) return null;
  if (typeof p.role !== 'string' || !ROLES.has(p.role)) return null;
  const tv = p.tv === undefined ? 0 : p.tv;
  if (typeof tv !== 'number' || !Number.isSafeInteger(tv) || tv < 0) return null;
  return {
    sub: p.sub,
    role: p.role as UserRole,
    distributorId: optionalId(p.distributorId),
    driverId: optionalId(p.driverId),
    clientId: optionalId(p.clientId),
    tv,
    exp: typeof p.exp === 'number' && Number.isFinite(p.exp) ? p.exp : undefined,
  };
}

/**
 * True for a DISTRIBUTOR without its shop id or a DRIVER without its driver id: a legacy user with no
 * `distributors` or `drivers` row (API_CONTRACT §3.2). No token is issued for such a user and none is
 * accepted (401 AUTH_SESSION_REVOKED), because every query scoped to the caller would get `undefined`
 * for the id, which Prisma drops from the filter.
 */
export function lacksRoleProfile(claims: Pick<TokenClaims, 'role' | 'distributorId' | 'driverId'>): boolean {
  if (claims.role === UserRole.DISTRIBUTOR) return !claims.distributorId;
  if (claims.role === UserRole.DRIVER) return !claims.driverId;
  return false;
}

/** True once a token with an expiry has passed it. */
export function hasExpired(claims: Pick<TokenClaims, 'exp'>, now: number = Date.now()): boolean {
  return claims.exp !== undefined && claims.exp * 1000 <= now;
}

/** The request's caller (`req.user`), built from verified claims. */
export function toAuthContext(claims: TokenClaims): AuthContext {
  return {
    userId: claims.sub,
    role: claims.role,
    ...(claims.distributorId ? { distributorId: claims.distributorId } : {}),
    ...(claims.driverId ? { driverId: claims.driverId } : {}),
    ...(claims.clientId ? { clientId: claims.clientId } : {}),
  };
}

/**
 * The one app each role signs in to (API_CONTRACT §7.1): DISTRIBUTOR → the shop app, DRIVER → the
 * driver app, every other role → the office website (whose own gate then admits only SUPER_ADMIN).
 */
export function appForRole(role: UserRole): AppVariant {
  if (role === UserRole.DISTRIBUTOR) return 'distributor';
  if (role === UserRole.DRIVER) return 'driver';
  return 'admin-web';
}
