import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { from, switchMap, type Observable } from 'rxjs';
import type { AppVariant } from '@smartfleet/shared-types';
import { SettingsService } from '../../modules/settings/settings.service';
import { parseAppVariant, parseAppVersion } from '../context/request-context';
import { AppError } from '../errors/app-error';
import { headerValue, REQUEST_HEADER } from '../http/headers';

export const SKIP_VERSION_GATE_KEY = 'skipVersionGate';

/** Keeps a route reachable by out-of-date apps (`GET /app/config`, which tells them to update). */
export const SkipVersionGate = () => SetMetadata(SKIP_VERSION_GATE_KEY, true);

/** The version assumed when `X-App-Version` is missing: the installed 0.1.0 builds send none. */
export const MISSING_APP_VERSION = '0.1.0';

type GatedVariant = Extract<AppVariant, 'driver' | 'distributor'>;

/** "1.10.0" > "1.9.3". Missing parts count as 0; a pre-release or build suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The app a request comes from: `X-App-Variant` when sent, else the signed-in role (installed 0.1.0
 * builds send no headers, so a DRIVER token means the driver app). The office website is never gated.
 */
export function gatedVariant(headerVariant: AppVariant | undefined, role: string | undefined): GatedVariant | null {
  if (headerVariant) return headerVariant === 'driver' || headerVariant === 'distributor' ? headerVariant : null;
  if (role === UserRole.DRIVER) return 'driver';
  if (role === UserRole.DISTRIBUTOR) return 'distributor';
  return null;
}

/**
 * Global update gate (API_CONTRACT §6): a phone app below `app.minVersion.<variant>` gets 426
 * APP_UPDATE_REQUIRED on every route except those marked {@link SkipVersionGate}. A missing
 * `X-App-Version` counts as "0.1.0". Runs after the guards, so a token's role is known.
 */
@Injectable()
export class AppVersionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VERSION_GATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: { role?: string } }>();
    const variant = gatedVariant(parseAppVariant(headerValue(req.headers[REQUEST_HEADER.appVariant])), req.user?.role);
    if (!variant) return next.handle();
    const version = parseAppVersion(headerValue(req.headers[REQUEST_HEADER.appVersion])) ?? MISSING_APP_VERSION;

    return from(this.settings.get(`app.minVersion.${variant}`)).pipe(
      switchMap((minVersion) => {
        if (compareVersions(version, minVersion) < 0) throw new AppError('APP_UPDATE_REQUIRED');
        return next.handle();
      }),
    );
  }
}
