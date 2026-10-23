import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { AppError } from '../../src/common/errors/app-error';
import {
  AppVersionInterceptor,
  compareVersions,
  gatedVariant,
  SKIP_VERSION_GATE_KEY,
} from '../../src/common/interceptors/app-version.interceptor';
import type { SettingsService } from '../../src/modules/settings/settings.service';

function settingsWith(min: { driver: string; distributor: string }): SettingsService {
  return {
    get: jest.fn(async (key: string) => (key === 'app.minVersion.driver' ? min.driver : min.distributor)),
  } as unknown as SettingsService;
}

function handler(): () => void {
  return () => undefined;
}

function httpContext(req: { headers: Record<string, string>; user?: { role: string } }, skip = false): ExecutionContext {
  const target = handler();
  if (skip) Reflect.defineMetadata(SKIP_VERSION_GATE_KEY, true, target);
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
  const interceptor = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.2.0', distributor: '0.0.0' }));

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
    await expect(run(interceptor, httpContext({ headers: {}, user: { role: 'DRIVER' } }))).rejects.toMatchObject({
      code: 'APP_UPDATE_REQUIRED',
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
