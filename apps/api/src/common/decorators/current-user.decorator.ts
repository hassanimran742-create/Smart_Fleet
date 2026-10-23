import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { userActor, type UserActor } from '../auth/actor';
import { AppError } from '../errors/app-error';

export interface AuthContext {
  userId: string;
  role: string;
  distributorId?: string;
  driverId?: string;
  clientId?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);

/** The signed-in caller as an audit/wallet {@link UserActor}; 401 AUTH_TOKEN_INVALID on a route without one. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserActor => {
  const req = ctx.switchToHttp().getRequest();
  const user = req.user as AuthContext | undefined;
  if (!user?.userId || !user.role) throw new AppError('AUTH_TOKEN_INVALID');
  return userActor(user);
});
