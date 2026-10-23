import {
  applyDecorators,
  Injectable,
  SetMetadata,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { of, type Observable } from 'rxjs';
import type { PublicAppConfig, SettingKey, SettingValueMap } from '@smartfleet/shared-types';
import { SettingsService } from '../../modules/settings/settings.service';
import { AppError } from '../errors/app-error';
import { RESPONSE_HEADER } from '../http/headers';

type FeatureOf<K> = K extends `features.${infer N}` ? N : never;
/** A module switch: setting `features.<name>` (API_CONTRACT §3.4, §6). */
export type FeatureName = FeatureOf<SettingKey>;
type FeatureKey = Extract<SettingKey, `features.${string}`>;

export const FEATURE_KEY = 'feature';

const DISABLED_MARK = Symbol('featureDisabled');
type MarkedRequest = Request & { [DISABLED_MARK]?: FeatureName };

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * True for a read of one record: a route with an `:id` path parameter (`GET /transfers/:id`,
 * `/transfers/:id/progress`). Its callers expect an object, so `[]` would break them (the installed
 * driver app's TransferDetailScreen reads `t.lines.length`); lists by another key
 * (`/accessories/stock/store/:storeId`) are lists.
 */
function readsOneRecord(req: Request): boolean {
  const params: unknown = req.params;
  return typeof params === 'object' && params !== null && Object.prototype.hasOwnProperty.call(params, 'id');
}

/**
 * When `features.<name>` is off, writes and single-record reads (a route with an `:id`) get 403
 * FEATURE_DISABLED with `X-Feature-Disabled: <name>`, and list reads are let through to
 * {@link FeatureListInterceptor}, which answers `[]` with the same header. Runs after the global auth
 * guards.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<FeatureName | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!name || context.getType() !== 'http') return true;
    if (await this.settings.get(`features.${name}` as FeatureKey)) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<MarkedRequest>();
    if (!READ_METHODS.has(req.method.toUpperCase()) || readsOneRecord(req)) {
      // The refused write or record read names its module too (SEC-020), as the `[]` list answer does.
      http.getResponse<Response>().setHeader(RESPONSE_HEADER.featureDisabled, name);
      throw new AppError('FEATURE_DISABLED');
    }
    req[DISABLED_MARK] = name;
    return true;
  }
}

/** Answers a list read of a switched-off module with `[]` and `X-Feature-Disabled: <name>`, without running the handler. */
@Injectable()
export class FeatureListInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const name = http.getRequest<MarkedRequest>()[DISABLED_MARK];
    if (!name) return next.handle();
    http.getResponse<Response>().setHeader(RESPONSE_HEADER.featureDisabled, name);
    return of([]);
  }
}

/**
 * Puts a controller or route behind a module switch (`features.transfers`, `.fuelRefills`,
 * `.accessories`, `.support`, `.clientApp`): writes and single-record GETs (an `:id` route) get 403
 * FEATURE_DISABLED and GET lists return `[]`, all with `X-Feature-Disabled: <name>`, so installed apps
 * that poll the lists keep working and a screen that opens one record never gets an array.
 *
 *   @Feature('transfers')
 *   @Controller('transfers')
 *   export class TransfersController { … }
 */
export const Feature = (name: FeatureName) =>
  applyDecorators(SetMetadata(FEATURE_KEY, name), UseGuards(FeatureGuard), UseInterceptors(FeatureListInterceptor));

// ---- Setting switches (API_CONTRACT §3.4) ----

/** Boolean settings outside `features.*` that can switch a whole module off. */
export type SwitchSettingKey = {
  [K in SettingKey]: K extends `features.${string}` ? never : SettingValueMap[K] extends boolean ? K : never;
}[SettingKey];

/** The name a switch reports in `X-Feature-Disabled`: the matching `PublicAppConfig.features` key. */
export type SwitchName = keyof PublicAppConfig['features'];

export const SETTING_SWITCH_KEY = 'settingSwitch';

export interface SettingSwitchRule {
  key: SwitchSettingKey;
  name: SwitchName;
}

/** Reads the switch on a route (handler first, then class). */
export function settingSwitchOf(reflector: Reflector, context: ExecutionContext): SettingSwitchRule | undefined {
  return reflector.getAllAndOverride<SettingSwitchRule | undefined>(SETTING_SWITCH_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

/**
 * Throws 403 FEATURE_DISABLED with `X-Feature-Disabled: <name>` when the route's switch is off; every
 * method, reads included (never `[]`: no installed app calls these routes). The global RolesGuard calls
 * it first, so the switch answers right after sign-in and before role and ownership checks.
 */
export async function assertSettingSwitchOn(
  rule: SettingSwitchRule | undefined,
  context: ExecutionContext,
  settings: SettingsService,
): Promise<void> {
  if (!rule || context.getType() !== 'http') return;
  if (await settings.get(rule.key)) return;
  context.switchToHttp().getResponse<Response>().setHeader(RESPONSE_HEADER.featureDisabled, rule.name);
  throw new AppError('FEATURE_DISABLED');
}

/** The guard behind {@link SettingSwitch}; a second line of defence after RolesGuard's own check. */
@Injectable()
export class SettingSwitchGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await assertSettingSwitchOn(settingSwitchOf(this.reflector, context), context, this.settings);
    return true;
  }
}

/**
 * Puts a controller or route behind a boolean setting outside `features.*` (API_CONTRACT §3.4): while
 * it is false every method gets 403 FEATURE_DISABLED with `X-Feature-Disabled: <name>`.
 *
 *   @SettingSwitch('confirmation.enabled', 'confirmations')   // Inc 2
 *   @SettingSwitch('dayEnd.enabled', 'dayEnd')                 // Inc 3
 */
export const SettingSwitch = (key: SwitchSettingKey, name: SwitchName) =>
  applyDecorators(SetMetadata(SETTING_SWITCH_KEY, { key, name } satisfies SettingSwitchRule), UseGuards(SettingSwitchGuard));
