import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError } from '../errors/app-error';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * A missing, expired or forged token is 401 AUTH_TOKEN_INVALID. An AppError raised while validating
   * the token (for example AUTH_SESSION_REVOKED) is passed through unchanged.
   */
  handleRequest<TUser = unknown>(err: unknown, user: TUser | false | null | undefined): TUser {
    if (err instanceof AppError) throw err;
    if (err || !user) throw new AppError('AUTH_TOKEN_INVALID', undefined, { cause: err });
    return user;
  }
}
