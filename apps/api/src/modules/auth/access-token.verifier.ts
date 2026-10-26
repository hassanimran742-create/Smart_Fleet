import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../../common/errors/app-error';
import { SessionCheckService } from './session-check.service';
import { lacksRoleProfile, readTokenClaims, type TokenClaims } from './token-claims';

/**
 * Verifies an access token outside the HTTP guard, for the `/drivers` socket (API_CONTRACT §7.14):
 * the same signature and expiry check as JwtStrategy, then the same session check.
 * - no, malformed, forged or expired token: 401 AUTH_TOKEN_INVALID;
 * - a DISTRIBUTOR or DRIVER token without its profile id (§3.2), a user who isn't ACTIVE, a locked
 *   role or an old `tv`: 401 AUTH_SESSION_REVOKED.
 * Returns the token's claims, `exp` included (`toAuthContext` turns them into the caller).
 */
@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: SessionCheckService,
  ) {}

  async verify(token: unknown): Promise<TokenClaims> {
    if (typeof token !== 'string') throw new AppError('AUTH_TOKEN_INVALID');
    const raw = token.trim().replace(/^Bearer\s+/i, '');
    if (!raw) throw new AppError('AUTH_TOKEN_INVALID');
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(raw, {
        secret: this.config.get<string>('jwt.accessSecret') ?? 'change_me_access',
      });
    } catch (cause) {
      throw new AppError('AUTH_TOKEN_INVALID', undefined, { cause });
    }
    const claims = readTokenClaims(payload);
    if (!claims) throw new AppError('AUTH_TOKEN_INVALID');
    if (lacksRoleProfile(claims)) throw new AppError('AUTH_SESSION_REVOKED');
    await this.sessions.assertLive(claims);
    return claims;
  }
}
