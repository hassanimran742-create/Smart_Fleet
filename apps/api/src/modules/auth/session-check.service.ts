import { Injectable } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { TokenClaims } from './token-claims';

/** How long a process trusts its copy of a user's session facts (API_CONTRACT §3.3). */
export const SESSION_CHECK_TTL_MS = 60_000;
/** Bound on the cache; the oldest entry is dropped first. */
const MAX_CACHED_USERS = 5_000;

/** The facts a session depends on. */
export interface SessionUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  tokenVersion: number;
}

interface CachedUser {
  user: SessionUser | null;
  readAt: number;
}

/** Told the user id each time a user's cached session facts are dropped ({@link SessionCheckService.forget}). */
export type ForgetListener = (userId: string) => void;

/**
 * The session check behind every signed-in request and socket (API_CONTRACT §3.3, §7.14): the user is
 * ACTIVE, their role is not in `auth.lockedRoles`, and the token's `tv` claim equals
 * `users.token_version` (and its role the user's role). Otherwise 401 AUTH_SESSION_REVOKED.
 *
 * The user row is cached per process for 60 seconds, so a change made anywhere ends the session
 * within a minute. The cache can only let a revoked token through for that minute, never refuse a
 * good one: a check that fails on a cached row is repeated on a fresh read before it refuses, so a
 * token issued after a version bump (a password change) works at once. Changes made by this lane
 * also call {@link forget}, which ends the old sessions on the next request and tells the
 * {@link onForget} listeners (the `/drivers` socket re-checks that user's open sockets).
 * `auth.lockedRoles` is read from settings on every check, so locking a role applies at once.
 */
@Injectable()
export class SessionCheckService {
  private readonly cache = new Map<string, CachedUser>();
  private readonly listeners = new Set<ForgetListener>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Returns the session's user, or throws 401 AUTH_SESSION_REVOKED. Uses the 60-second cache. */
  async assertLive(claims: Pick<TokenClaims, 'sub' | 'role' | 'tv'>): Promise<SessionUser> {
    const lockedRoles = await this.settings.get('auth.lockedRoles');
    const cached = this.cache.get(claims.sub);
    if (cached && Date.now() - cached.readAt < SESSION_CHECK_TTL_MS && passes(cached.user, claims, lockedRoles)) {
      return cached.user as SessionUser;
    }
    return this.check(claims, lockedRoles);
  }

  /**
   * The same check on a fresh read of the user, for decisions that must not trust the cache (a
   * token refresh, API_CONTRACT §7.1). Refreshes the cached row.
   */
  async assertLiveNow(claims: Pick<TokenClaims, 'sub' | 'role' | 'tv'>): Promise<SessionUser> {
    return this.check(claims, await this.settings.get('auth.lockedRoles'));
  }

  private async check(claims: Pick<TokenClaims, 'sub' | 'role' | 'tv'>, lockedRoles: readonly UserRole[]): Promise<SessionUser> {
    const user = await this.read(claims.sub);
    this.remember(claims.sub, user, Date.now());
    if (!passes(user, claims, lockedRoles)) throw new AppError('AUTH_SESSION_REVOKED');
    return user;
  }

  /**
   * Drops a user's cached row, after a change to their status, role or token version has committed,
   * then tells the listeners. A listener re-checks; it never ends a session by itself, because a
   * reactivation and one's own password change (which issues new tokens) call this too.
   */
  forget(userId: string): void {
    this.cache.delete(userId);
    for (const listener of this.listeners) {
      try {
        listener(userId);
      } catch {
        // A listener never fails the change that called forget.
      }
    }
  }

  /** Calls `listener` after every {@link forget}; returns the function that removes it. */
  onForget(listener: ForgetListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async read(userId: string): Promise<SessionUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, tokenVersion: true },
    });
  }

  private remember(userId: string, user: SessionUser | null, now: number): void {
    this.cache.delete(userId);
    if (this.cache.size >= MAX_CACHED_USERS) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(userId, { user, readAt: now });
  }
}

function passes(
  user: SessionUser | null,
  claims: Pick<TokenClaims, 'role' | 'tv'>,
  lockedRoles: readonly UserRole[],
): user is SessionUser {
  return (
    user !== null &&
    user.status === UserStatus.ACTIVE &&
    user.role === claims.role &&
    user.tokenVersion === claims.tv &&
    !lockedRoles.includes(user.role)
  );
}
