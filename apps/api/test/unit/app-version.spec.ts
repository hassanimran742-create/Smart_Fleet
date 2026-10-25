import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AppError } from '../../src/common/errors/app-error';
import { ERROR_HTTP, ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import {
  AppVersionInterceptor,
  compareVersions,
  gatedVariant,
  isOldAppCall,
  NEW_APP_ONLY_KEY,
  SKIP_VERSION_GATE_KEY,
} from '../../src/common/interceptors/app-version.interceptor';
import { JS_RELEASE_VERSION } from '../../../mobile/src/api/release';
import type { AppSeenService } from '../../src/common/app-seen/app-seen.service';
import type { SettingsService } from '../../src/modules/settings/settings.service';

/** The update gate's app recorder, unused by these cases (test/unit/app-seen.spec.ts covers it). */
const appSeen = { record: jest.fn(async () => undefined) } as unknown as AppSeenService;

function settingsWith(min: { driver: string; distributor: string }): SettingsService {
  return {
    get: jest.fn(async (key: string) => (key === 'app.minVersion.driver' ? min.driver : min.distributor)),
  } as unknown as SettingsService;
}

function handler(): () => void {
  return () => undefined;
}

function httpContext(req: { headers: Record<string, string>; user?: { role: string } }, skip = false, newAppOnly = false): ExecutionContext {
  const target = handler();
  if (skip) Reflect.defineMetadata(SKIP_VERSION_GATE_KEY, true, target);
  if (newAppOnly) Reflect.defineMetadata(NEW_APP_ONLY_KEY, true, target);
  return {
    getType: () => 'http',
    getHandler: () => target,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of('handled') };

async function run(interceptor: AppVersionInterceptor, context: ExecutionContext): Promise<unknown> {
  return lastValueFrom(interceptor.intercept(context, next));
}

describe('426 update gate (API_CONTRACT §6)', () => {
  const interceptor = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.2.0', distributor: '0.0.0' }), appSeen);

  it('refuses a driver app below app.minVersion.driver with 426 APP_UPDATE_REQUIRED', async () => {
    const error = await run(interceptor, httpContext({ headers: { 'x-app-variant': 'driver', 'x-app-version': '0.1.9' } })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('APP_UPDATE_REQUIRED');
    expect((error as AppError).getStatus()).toBe(426);
  });

  it('lets an app at or above the minimum through', async () => {
    await expect(run(interceptor, httpContext({ headers: { 'x-app-variant': 'driver', 'x-app-version': '0.2.0' } }))).resolves.toBe(
      'handled',
    );
    await expect(run(interceptor, httpContext({ headers: { 'x-app-variant': 'driver', 'x-app-version': '0.10.1' } }))).resolves.toBe(
      'handled',
    );
  });

  it('counts a missing X-App-Version as 0.1.0', async () => {
    await expect(run(interceptor, httpContext({ headers: { 'x-app-variant': 'driver' } }))).rejects.toMatchObject({
      code: 'APP_UPDATE_REQUIRED',
    });
  });

  it('knows installed builds, which send no headers, by the signed-in role', async () => {
    // The 0.1.0 JS has no update screen: it is told to restart, which fetches the over-the-air update.
    await expect(run(interceptor, httpContext({ headers: {}, user: { role: 'DRIVER' } }))).rejects.toMatchObject({
      code: 'APP_RESTART_TO_UPDATE',
    });
    await expect(run(interceptor, httpContext({ headers: {}, user: { role: 'DISTRIBUTOR' } }))).resolves.toBe('handled');
  });

  it('never gates the office website or anonymous calls without a variant', async () => {
    await expect(run(interceptor, httpContext({ headers: { 'x-app-variant': 'admin-web' }, user: { role: 'DRIVER' } }))).resolves.toBe(
      'handled',
    );
    await expect(run(interceptor, httpContext({ headers: {} }))).resolves.toBe('handled');
  });

  it('keeps GET /app/config reachable for out-of-date apps', async () => {
    await expect(
      run(interceptor, httpContext({ headers: { 'x-app-variant': 'driver', 'x-app-version': '0.0.1' } }, true)),
    ).resolves.toBe('handled');
  });
});

describe('REV23 contract-compat-02 the gate tells the 0.1.0 JS apart from the over-the-air JS', () => {
  const driver = { role: 'DRIVER' };
  const oldJs = { headers: {}, user: driver };
  const otaJs = { headers: { 'x-app-variant': 'driver', 'x-app-version': JS_RELEASE_VERSION }, user: driver };

  it('REV23 contract-compat-02 a minimum of the over-the-air release retires only the 0.1.0 JS', async () => {
    expect(compareVersions(JS_RELEASE_VERSION, '0.1.0')).toBe(1);
    const gate = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: JS_RELEASE_VERSION, distributor: '0.0.0' }), appSeen);
    await expect(run(gate, httpContext(oldJs))).rejects.toMatchObject({ code: 'APP_RESTART_TO_UPDATE' });
    await expect(run(gate, httpContext(otaJs))).resolves.toBe('handled');
    // With no minimum set, both keep working.
    const open = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.0.0', distributor: '0.0.0' }), appSeen);
    await expect(run(open, httpContext(oldJs))).resolves.toBe('handled');
    await expect(run(open, httpContext(otaJs))).resolves.toBe('handled');
  });

  it('REV23 contract-compat-02 the 0.1.0 JS is told to restart, in words its screens show; later builds get their update gate', async () => {
    expect(ERROR_HTTP.APP_RESTART_TO_UPDATE).toBe(426);
    expect(ERROR_MESSAGE_EN.APP_RESTART_TO_UPDATE).toBe('Close the app and open it again to update.');
    const gate = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '9.0.0', distributor: '9.0.0' }), appSeen);
    const refusal = (await run(gate, httpContext(oldJs)).catch((e: unknown) => e)) as AppError;
    expect({ status: refusal.getStatus(), code: refusal.code, message: refusal.message }).toEqual({
      status: 426,
      code: 'APP_RESTART_TO_UPDATE',
      message: 'Close the app and open it again to update.',
    });
    await expect(run(gate, httpContext(otaJs))).rejects.toMatchObject({ code: 'APP_UPDATE_REQUIRED' });
    // Only a call with neither header is the 0.1.0 JS.
    expect(isOldAppCall({})).toBe(true);
    expect(isOldAppCall({ 'x-app-variant': 'driver' })).toBe(false);
    expect(isOldAppCall({ 'x-app-version': '0.1.1' })).toBe(false);
  });

  it('REV23 contract-compat-01 a route marked NewAppOnly refuses the 0.1.0 JS whatever the minimum, and nobody else', async () => {
    const gate = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.0.0', distributor: '0.0.0' }), appSeen);
    const shopOldJs = { headers: {}, user: { role: 'DISTRIBUTOR' } };
    await expect(run(gate, httpContext(shopOldJs, false, true))).rejects.toMatchObject({ code: 'APP_RESTART_TO_UPDATE' });
    await expect(run(gate, httpContext(oldJs, false, true))).rejects.toMatchObject({ code: 'APP_RESTART_TO_UPDATE' });
    await expect(run(gate, httpContext(otaJs, false, true))).resolves.toBe('handled');
    await expect(run(gate, httpContext({ headers: { 'x-app-variant': 'distributor', 'x-app-version': JS_RELEASE_VERSION }, user: { role: 'DISTRIBUTOR' } }, false, true))).resolves.toBe('handled');
    // The office website and anonymous calls are never gated; unmarked routes still serve the 0.1.0 JS.
    await expect(run(gate, httpContext({ headers: { 'x-app-variant': 'admin-web' }, user: { role: 'SUPER_ADMIN' } }, false, true))).resolves.toBe('handled');
    await expect(run(gate, httpContext({ headers: {} }, false, true))).resolves.toBe('handled');
    await expect(run(gate, httpContext(oldJs))).resolves.toBe('handled');
  });
});

describe('REV23 contract-compat-01 a dead end of a 0.1.0 route becomes the restart answer', () => {
  const gate = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.0.0', distributor: '0.0.0' }), appSeen);
  const vanNotEmpty = () => new AppError('TRIP_VAN_NOT_EMPTY', { count: 1, cylinders: [], leftoversAllowed: false });
  const refusing = (error: unknown): CallHandler => ({ handle: () => throwError(() => error) });
  const call = (headers: Record<string, string>, method: string, route: string) =>
    httpContextWith({ headers, user: { role: 'DRIVER' }, method, route: { path: route } });
  const answerOf = async (context: ExecutionContext, error: unknown) =>
    ((await lastValueFrom(gate.intercept(context, refusing(error))).catch((e: unknown) => e)) as AppError).code;

  it('REV23 contract-compat-01 the 0.1.0 Finish refused for cylinders on the van is told to restart', async () => {
    expect(await answerOf(call({}, 'PATCH', '/api/v1/trips/:id/status'), vanNotEmpty())).toBe('APP_RESTART_TO_UPDATE');
  });

  it('REV23 contract-compat-01 the same refusal elsewhere, to later builds, or another refusal, is kept', async () => {
    // The Inc 2 finish route keeps its answer for any caller (tests and the new app alike).
    expect(await answerOf(call({}, 'POST', '/api/v1/trips/:tripId/finish'), vanNotEmpty())).toBe('TRIP_VAN_NOT_EMPTY');
    expect(await answerOf(call({ 'x-app-variant': 'driver', 'x-app-version': JS_RELEASE_VERSION }, 'PATCH', '/api/v1/trips/:id/status'), vanNotEmpty())).toBe('TRIP_VAN_NOT_EMPTY');
    expect(await answerOf(call({}, 'PATCH', '/api/v1/trips/:id/status'), new AppError('TRIP_STOPS_OPEN'))).toBe('TRIP_STOPS_OPEN');
  });
});

function httpContextWith(req: { headers: Record<string, string>; user?: { role: string }; method: string; route: { path: string } }): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler(),
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('version helpers', () => {
  it('compares x.y.z numerically', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
  });

  it('picks the gated variant from the header, else the role', () => {
    expect(gatedVariant('driver', 'DISTRIBUTOR')).toBe('driver');
    expect(gatedVariant('admin-web', 'DRIVER')).toBeNull();
    expect(gatedVariant(undefined, 'DRIVER')).toBe('driver');
    expect(gatedVariant(undefined, 'SUPER_ADMIN')).toBeNull();
  });
});
