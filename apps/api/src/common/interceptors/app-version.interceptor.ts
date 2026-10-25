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
import { catchError, from, switchMap, throwError, type Observable } from 'rxjs';
import type { AppVariant, ErrorCode } from '@smartfleet/shared-types';
import { SettingsService } from '../../modules/settings/settings.service';
import { parseAppVariant, parseAppVersion } from '../context/request-context';
import { AppError } from '../errors/app-error';
import { headerValue, REQUEST_HEADER } from '../http/headers';

export const SKIP_VERSION_GATE_KEY = 'skipVersionGate';
export const NEW_APP_ONLY_KEY = 'newAppOnly';

/** Keeps a route reachable by out-of-date apps (`GET /app/config`, which tells them to update). */
export const SkipVersionGate = () => SetMetadata(SKIP_VERSION_GATE_KEY, true);

/**
 * [review23 contract-compat-01] A route the installed 0.1.0 JS may no longer use now the scan flow is on,
 * because what it starts can't be finished on the 0.1.0 apps (API_CONTRACT Appendix A: "the scan flow is
 * required (update app)"). A shop or driver call with no `X-App-*` header is answered 426
 * APP_RESTART_TO_UPDATE whatever `app.minVersion` says; the over-the-air JS, which sends its headers,
 * is never affected.
 */
export const NewAppOnly = () => SetMetadata(NEW_APP_ONLY_KEY, true);

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
 * True for the installed 0.1.0 JS: a call with neither `X-App-Variant` nor `X-App-Version`. Every later
 * build of the apps sends both (the over-the-air JS its own release version, apps/mobile/src/api/release.ts).
 */
export function isOldAppCall(headers: Request['headers']): boolean {
  return headerValue(headers[REQUEST_HEADER.appVariant]) === undefined && headerValue(headers[REQUEST_HEADER.appVersion]) === undefined;
}

/**
 * The 426 for an app below the minimum. The 0.1.0 JS has no update screen, but its screens show the
 * answer's `message`, and closing and reopening it fetches the over-the-air update: so it is told
 * exactly that (APP_RESTART_TO_UPDATE). A later build gets APP_UPDATE_REQUIRED and shows its update gate.
 */
export function updateRefusal(oldApp: boolean, cause?: unknown): AppError {
  return new AppError(oldApp ? 'APP_RESTART_TO_UPDATE' : 'APP_UPDATE_REQUIRED', {}, cause === undefined ? undefined : { cause });
}

/**
 * [review23 contract-compat-01] The 0.1.0 routes (API_CONTRACT Appendix A) where a refusal can only be
 * resolved by the Inc 2/3 apps, so the 0.1.0 screen can only dead-end on it. "✓ Finish" (PATCH
 * /trips/:id/status COMPLETED, ActiveTripScreen.tsx) refused TRIP_VAN_NOT_EMPTY: the 0.1.0 shop app can't
 * scan the van's cylinders in, and the 0.1.0 Finish can't give the leftover reason (§9.3), so the run would
 * stay open with nothing shown. The 0.1.0 JS is answered APP_RESTART_TO_UPDATE there instead (nothing is
 * written either way), and the updated app finishes the run. Matched by the route the request took, so the
 * Inc 2 routes (POST /trips/:tripId/finish) keep their answers whoever calls them.
 */
export const OLD_APP_DEAD_ENDS: ReadonlyArray<{ method: string; route: string; codes: readonly ErrorCode[] }> = [
  { method: 'PATCH', route: '/trips/:id/status', codes: ['TRIP_VAN_NOT_EMPTY'] },
];

/** The dead-end codes of the 0.1.0 route a request took (none for any other route). */
function deadEndsOf(req: Request): readonly ErrorCode[] {
  const route = (req as Request & { route?: { path?: unknown } }).route?.path;
  if (typeof route !== 'string') return [];
  return OLD_APP_DEAD_ENDS.find((entry) => entry.method === req.method && route.endsWith(entry.route))?.codes ?? [];
}

/**
 * Global update gate (API_CONTRACT §6): a phone app below `app.minVersion.<variant>` gets 426 on every
 * route except those marked {@link SkipVersionGate}: APP_RESTART_TO_UPDATE for the 0.1.0 JS (no `X-App-*`
 * header), APP_UPDATE_REQUIRED for later builds. A missing `X-App-Version` counts as "0.1.0", so a minimum of
 * the over-the-air JS's own version ("0.1.1") retires the 0.1.0 JS and nothing else. Routes marked
 * {@link NewAppOnly} refuse the 0.1.0 JS whatever the minimum, and {@link OLD_APP_DEAD_ENDS} turn the
 * 0.1.0 JS's dead ends into the restart answer. Runs after the guards, so a token's role is known.
 */
@Injectable()
export class AppVersionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_VERSION_GATE_KEY, targets)) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: { role?: string } }>();
    const variant = gatedVariant(parseAppVariant(headerValue(req.headers[REQUEST_HEADER.appVariant])), req.user?.role);
    if (!variant) return next.handle();
    const oldApp = isOldAppCall(req.headers);
    if (oldApp && this.reflector.getAllAndOverride<boolean>(NEW_APP_ONLY_KEY, targets)) throw updateRefusal(true);
    const version = parseAppVersion(headerValue(req.headers[REQUEST_HEADER.appVersion])) ?? MISSING_APP_VERSION;

    const deadEnds = oldApp ? deadEndsOf(req) : [];

    return from(this.settings.get(`app.minVersion.${variant}`)).pipe(
      switchMap((minVersion) => {
        if (compareVersions(version, minVersion) < 0) throw updateRefusal(oldApp);
        if (deadEnds.length === 0) return next.handle();
        // A dead end of this 0.1.0 route becomes the restart answer; any other answer is kept.
        return next
          .handle()
          .pipe(catchError((error: unknown) => throwError(() => (error instanceof AppError && deadEnds.includes(error.code) ? updateRefusal(true, error) : error))));
      }),
    );
  }
}
