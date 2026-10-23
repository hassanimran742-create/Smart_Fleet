import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { APP_DISPLAY_NAME, type LoginResponse } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import type { ChangePasswordInput, LoginInput } from '@smartfleet/shared-validation';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SessionCheckService } from './session-check.service';
import { appForRole, lacksRoleProfile, readTokenClaims, type TokenClaims } from './token-claims';

/** API_CONTRACT §7.1: access tokens last 12 hours and refresh tokens 30 days unless env says otherwise. */
const DEFAULT_ACCESS_TTL_SECONDS = 12 * 60 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** What a token is built from: the user, their token version and their profile ids. */
const TOKEN_USER_SELECT = {
  id: true,
  role: true,
  status: true,
  tokenVersion: true,
  distributorProfile: { select: { id: true } },
  driverProfile: { select: { id: true } },
  clientProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

type TokenUser = Prisma.UserGetPayload<{ select: typeof TOKEN_USER_SELECT }>;

/** A DISTRIBUTOR or DRIVER user without its shop or driver row (legacy data): it gets no tokens (§3.2). */
function lacksProfile(user: TokenUser): boolean {
  return lacksRoleProfile({ role: user.role, distributorId: user.distributorProfile?.id, driverId: user.driverProfile?.id });
}

/** The profile a signed-in user reads at `GET /auth/me`. */
const ME_SELECT = { id: true, phone: true, email: true, name: true, role: true, status: true } satisfies Prisma.UserSelect;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Sign-in, refresh and password change (API_CONTRACT §3.3, §7.1). Every refusal is an AppError with
 * a stable code, and no message ever mentions a one-time code: the installed app's sign-in screen
 * jumps to its code screen when one does (§2.1).
 */
@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly settings: SettingsService,
    private readonly sessions: SessionCheckService,
  ) {}

  /** Code (OTP) sign-in isn't built in the pilot (ADR-03): both routes refuse before any lookup or write. */
  otpDisabled(): never {
    throw new AppError('AUTH_OTP_DISABLED');
  }

  /**
   * `POST /auth/login`. After the rate limits and the body check (both before this runs), the first
   * failing rule answers: (3) AUTH_INVALID_CREDENTIALS for a phone that isn't a Pakistani mobile, an
   * unknown phone, a user without a password or a wrong password; (4) AUTH_ROLE_LOCKED; (5)
   * AUTH_ACCOUNT_NOT_ACTIVE, also for a DISTRIBUTOR or DRIVER without its shop or driver row; (6)
   * AUTH_WRONG_APP. Nothing about an account shows without its password.
   */
  async login(body: LoginInput): Promise<LoginResponse> {
    const phone = normalizePkPhone(body.phone);
    const user = phone
      ? await this.prisma.user.findUnique({ where: { phone }, select: { ...TOKEN_USER_SELECT, passwordHash: true } })
      : null;
    // Unknown phones and users without a password still verify a hash, so timing reveals nothing.
    const matches = await this.verifyPassword(user?.passwordHash ?? null, body.password);
    if (!user || !matches) throw new AppError('AUTH_INVALID_CREDENTIALS');

    const lockedRoles = await this.settings.get('auth.lockedRoles');
    if (lockedRoles.includes(user.role)) throw new AppError('AUTH_ROLE_LOCKED');
    // A shop or driver login without its row can't be scoped to anything: it isn't a working account.
    if (user.status !== UserStatus.ACTIVE || lacksProfile(user)) throw new AppError('AUTH_ACCOUNT_NOT_ACTIVE');

    // Installed 0.1.0 apps send no X-App-Variant; then there is no app check.
    const variant = RequestContext.current()?.appVariant;
    const app = appForRole(user.role);
    if (variant && variant !== app) {
      throw new AppError('AUTH_WRONG_APP', { role: user.role, app: APP_DISPLAY_NAME[app] });
    }
    return this.issueTokens(user);
  }

  /**
   * `POST /auth/refresh`: rotates the refresh token, with reuse detection. A malformed, forged,
   * expired, unknown or already-used token is AUTH_REFRESH_INVALID (a reused one also revokes every
   * live refresh token of its user). A valid one whose user isn't ACTIVE, whose role is locked, whose
   * `tv` is old or who is a DISTRIBUTOR or DRIVER without its shop or driver row is
   * AUTH_SESSION_REVOKED, and the token is revoked by the rotation.
   */
  async refresh(rawToken: string): Promise<LoginResponse> {
    const claims = await this.verifyRefreshToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!stored || stored.userId !== claims.sub || stored.expiresAt.getTime() <= Date.now()) {
      throw new AppError('AUTH_REFRESH_INVALID');
    }
    if (stored.revokedAt) {
      await this.revokeAllRefreshTokens(stored.userId);
      throw new AppError('AUTH_REFRESH_INVALID');
    }
    // A guarded rotation: of two refreshes racing with one token, only one wins; the other is a reuse.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) {
      await this.revokeAllRefreshTokens(stored.userId);
      throw new AppError('AUTH_REFRESH_INVALID');
    }

    await this.sessions.assertLiveNow(claims);
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: TOKEN_USER_SELECT });
    if (!user || lacksProfile(user)) throw new AppError('AUTH_SESSION_REVOKED');
    return this.issueTokens(user, stored.id);
  }

  /**
   * `POST /auth/change-password`: checks the current password, stores the new one and bumps `tv`,
   * which ends every other session of the user; returns new tokens for this one. A wrong current
   * password is a field problem (400), not a 401, so the apps don't sign the person out for a typo.
   */
  async changePassword(userId: string, body: ChangePasswordInput): Promise<LoginResponse> {
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    const matches = await this.verifyPassword(current?.passwordHash ?? null, body.currentPassword);
    if (!current || !matches) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'currentPassword', code: 'INVALID_VALUE', message: validationMessage('INVALID_VALUE') }],
      });
    }
    const passwordHash = await argon2.hash(body.newPassword);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: TOKEN_USER_SELECT,
    });
    this.sessions.forget(userId);
    return this.issueTokens(user);
  }

  /** `GET /auth/me`: the signed-in user, without secrets. */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: ME_SELECT });
    if (!user) throw new AppError('AUTH_SESSION_REVOKED');
    return user;
  }

  private async verifyRefreshToken(rawToken: string): Promise<TokenClaims> {
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(rawToken, { secret: this.cfg.get<string>('jwt.refreshSecret') });
    } catch (cause) {
      throw new AppError('AUTH_REFRESH_INVALID', undefined, { cause });
    }
    const claims = readTokenClaims(payload);
    if (!claims) throw new AppError('AUTH_REFRESH_INVALID');
    return claims;
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** True only for a stored hash that matches; with no hash a throwaway one is verified for equal timing. */
  private async verifyPassword(hash: string | null, password: string): Promise<boolean> {
    const target = hash ?? (await this.throwawayHash());
    try {
      const ok = await argon2.verify(target, password);
      return hash !== null && ok;
    } catch {
      // A stored value that isn't an argon2 hash never matches.
      return false;
    }
  }

  private throwawayHash(): Promise<string> {
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }

  private ttl(key: 'jwt.accessTtl' | 'jwt.refreshTtl', fallback: number): number {
    const value = Number(this.cfg.get<number>(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  private async issueTokens(user: TokenUser, parentRefreshId?: string): Promise<LoginResponse> {
    // Login and refresh refuse such a user first; this keeps every other caller from signing one.
    if (lacksProfile(user)) throw new AppError('AUTH_SESSION_REVOKED');
    const claims = {
      sub: user.id,
      role: user.role,
      distributorId: user.distributorProfile?.id,
      driverId: user.driverProfile?.id,
      ...(user.role === UserRole.CLIENT && user.clientProfile ? { clientId: user.clientProfile.id } : {}),
      tv: user.tokenVersion,
    };
    const accessTtl = this.ttl('jwt.accessTtl', DEFAULT_ACCESS_TTL_SECONDS);
    const refreshTtl = this.ttl('jwt.refreshTtl', DEFAULT_REFRESH_TTL_SECONDS);

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.cfg.get<string>('jwt.accessSecret'),
      expiresIn: accessTtl,
    });
    // jti makes every refresh token unique, even two issued to one user in the same second.
    const refreshToken = await this.jwt.signAsync(
      { ...claims, jti: randomUUID() },
      { secret: this.cfg.get<string>('jwt.refreshSecret'), expiresIn: refreshTtl },
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        parentId: parentRefreshId,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    return { accessToken, refreshToken, expiresIn: accessTtl, role: user.role };
  }
}
