import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { LoginResponse } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  type ChangePasswordInput,
  type LoginInput,
} from '@smartfleet/shared-validation';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { AuthService } from './auth.service';

/** The phone a sign-in counts against (API_CONTRACT §3.6): normalised; not a Pakistani mobile → none. */
function loginPhoneOf(req: { body?: { phone?: unknown } }): string | null {
  const phone = req.body?.phone;
  return typeof phone === 'string' ? normalizePkPhone(phone) : null;
}

/**
 * The refresh token of a `POST /auth/refresh` body. Any non-empty text goes on to the token check
 * (a malformed token is 401 AUTH_REFRESH_INVALID, §7.1); a missing one is 400 VALIDATION_FAILED.
 */
function refreshTokenOf(body: unknown): string {
  const token = (body as { refreshToken?: unknown } | null | undefined)?.refreshToken;
  if (typeof token === 'string' && token.trim().length > 0) return token.trim();
  return new ZodBody(refreshSchema).transform(body).refreshToken;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Code sign-in is off for the pilot (ADR-03): always 403 AUTH_OTP_DISABLED; no code, no user. */
  @Public()
  @Post('otp/send')
  sendOtp(): never {
    return this.auth.otpDisabled();
  }

  @Public()
  @Post('otp/verify')
  verifyOtp(): never {
    return this.auth.otpDisabled();
  }

  /** Every attempt counts toward both limits, whatever its result (§3.6). */
  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit('auth.login.phone', 5, 600, loginPhoneOf)
  @RateLimit('auth.login.ip', 30, 600, 'ip')
  login(@Body(new ZodBody(loginSchema)) body: LoginInput): Promise<LoginResponse> {
    return this.auth.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit('auth.refresh.ip', 30, 60, 'ip')
  refresh(@Body() body: unknown): Promise<LoginResponse> {
    return this.auth.refresh(refreshTokenOf(body));
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthContext,
    @Body(new ZodBody(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<LoginResponse> {
    return this.auth.changePassword(user.userId, body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user.userId);
  }
}
