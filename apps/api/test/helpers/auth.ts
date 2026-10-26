/**
 * Signed access tokens for API tests, one helper per role.
 *
 * The claims mirror AuthService.issueTokens (sub, role, distributorId, driverId, clientId) plus `tv`,
 * the user's token version (API_CONTRACT §3.3). Tokens are signed with JWT_ACCESS_SECRET, the secret
 * the API verifies with; test/jest.setup.ts gives it a test value when the environment has none.
 *
 *   const shop = await createDistributor();
 *   await request(app.getHttpServer()).get('/api/v1/orders').set(authHeader(shop.actor));
 */
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

export interface TestActor {
  userId: string;
  role: UserRole;
  distributorId?: string;
  driverId?: string;
  clientId?: string;
  /** users.token_version; defaults to 0, the column default. */
  tokenVersion?: number;
}

export interface SignOptions {
  /** Seconds (negative for an already-expired token) or a span such as '15m'. Default 1 hour. */
  expiresIn?: number | string;
  /** Defaults to JWT_ACCESS_SECRET. Pass another value to test a forged token. */
  secret?: string;
}

/** The secret the API verifies access tokens with (same fallback as jwt.strategy.ts). */
export function accessSecret(): string {
  return process.env.JWT_ACCESS_SECRET ?? 'change_me_access';
}

const jwt = new JwtService();

export function signAccessToken(actor: TestActor, opts: SignOptions = {}): string {
  const claims = {
    sub: actor.userId,
    role: actor.role,
    distributorId: actor.distributorId,
    driverId: actor.driverId,
    clientId: actor.clientId,
    tv: actor.tokenVersion ?? 0,
  };
  return jwt.sign(claims, { secret: opts.secret ?? accessSecret(), expiresIn: opts.expiresIn ?? 3600 });
}

/** `{ Authorization: 'Bearer <token>' }` for supertest's `.set(...)`. */
export function authHeader(actor: TestActor, opts?: SignOptions): { Authorization: string } {
  return { Authorization: `Bearer ${signAccessToken(actor, opts)}` };
}

type Ids = { userId: string; tokenVersion?: number };

/** One helper per role. The profile ids are required where the API reads them from the token. */
export const tokenFor = {
  superAdmin: (u: Ids, opts?: SignOptions) => signAccessToken({ ...u, role: UserRole.SUPER_ADMIN }, opts),
  admin: (u: Ids, opts?: SignOptions) => signAccessToken({ ...u, role: UserRole.ADMIN }, opts),
  dispatcher: (u: Ids, opts?: SignOptions) => signAccessToken({ ...u, role: UserRole.DISPATCHER }, opts),
  storeKeeper: (u: Ids, opts?: SignOptions) => signAccessToken({ ...u, role: UserRole.STORE_KEEPER }, opts),
  distributor: (u: Ids & { distributorId: string }, opts?: SignOptions) =>
    signAccessToken({ ...u, role: UserRole.DISTRIBUTOR }, opts),
  driver: (u: Ids & { driverId: string }, opts?: SignOptions) => signAccessToken({ ...u, role: UserRole.DRIVER }, opts),
  client: (u: Ids & { clientId: string }, opts?: SignOptions) => signAccessToken({ ...u, role: UserRole.CLIENT }, opts),
};
