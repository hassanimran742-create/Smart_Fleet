import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { AppError } from '../../../common/errors/app-error';
import { SessionCheckService } from '../session-check.service';
import { lacksRoleProfile, readTokenClaims, toAuthContext } from '../token-claims';

/**
 * Bearer access tokens (API_CONTRACT §3.3). passport-jwt checks the signature and expiry; a bad,
 * forged or expired token never reaches `validate` and JwtAuthGuard answers 401 AUTH_TOKEN_INVALID.
 * `validate` then refuses a DISTRIBUTOR or DRIVER token without its profile id (a legacy user with no
 * shop or driver row, §3.2) and runs the session check (ACTIVE, role not locked, `tv` current; cached
 * 60 seconds); both answer 401 AUTH_SESSION_REVOKED, and the guard passes that AppError through.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    cfg: ConfigService,
    private readonly sessions: SessionCheckService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('jwt.accessSecret') ?? 'change_me_access',
    });
  }

  async validate(payload: unknown): Promise<AuthContext> {
    const claims = readTokenClaims(payload);
    if (!claims) throw new AppError('AUTH_TOKEN_INVALID');
    if (lacksRoleProfile(claims)) throw new AppError('AUTH_SESSION_REVOKED');
    await this.sessions.assertLive(claims);
    return toAuthContext(claims);
  }
}
