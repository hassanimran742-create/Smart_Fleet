/**
 * REVIEW23 contract-compat-02 (the mobile part): the over-the-air JS names its own release in
 * `X-App-Version`, so `app.minVersion.*` can stop the 0.1.0 JS it replaces on the same 0.1.0 APK.
 *
 * The Inc 2/3 screens ship over the air onto the 0.1.0 APK. Over-the-air updates keep the native version
 * (app.config.ts `version`, which `runtimeVersion` follows), so the JS used to send "0.1.0": the same
 * version the server's gate assumes for the old JS, which sends no header at all. No minimum told them
 * apart. Now the JS sends `JS_RELEASE_VERSION` (apps/mobile/src/api/release.ts), and the phone's own
 * update gate (RootNavigator) reads the same value, so a minimum set to this release never locks this
 * JS out.
 *
 * The phone's API client runs here with its native modules stubbed (as in mobile-api-client.spec.ts),
 * and its headers go through the server's real update gate (AppVersionInterceptor), so the two sides
 * are checked together. Whatever the server counts a header-less call as ("0.1.0" or "0.0.0"), it is
 * below this release.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import { lastValueFrom, of } from 'rxjs';
import { AppVersionInterceptor, compareVersions as serverCompare } from '../../../src/common/interceptors/app-version.interceptor';
import type { SettingsService } from '../../../src/modules/settings/settings.service';

/** The installed APK: native version 0.1.0 (app.config.ts), the driver build. */
const mockNative = { version: '0.1.0', variant: 'driver' };

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
  I18nManager: { isRTL: false },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return { expoConfig: { version: mockNative.version, extra: { variant: mockNative.variant, apiBaseUrl: 'http://test.local/api/v1' } } };
  },
}));
jest.mock('expo-updates', () => ({ updateId: null, isEnabled: false }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const MOBILE = path.resolve(__dirname, '..', '..', '..', '..', 'mobile');
const MOBILE_SRC = path.join(MOBILE, 'src');

type ReleaseModule = typeof import('../../../../mobile/src/api/release');
type AppInfoModule = typeof import('../../../../mobile/src/api/appInfo');
type ClientModule = typeof import('../../../../mobile/src/api/client');

/** The phone's modules as a build with this native version and variant loads them. */
function loadPhone(native: { version: string; variant: string }): { appInfo: AppInfoModule; client: ClientModule } {
  mockNative.version = native.version;
  mockNative.variant = native.variant;
  let loaded: { appInfo: AppInfoModule; client: ClientModule } | undefined;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    loaded = {
      appInfo: require(path.join(MOBILE_SRC, 'api', 'appInfo.ts')) as AppInfoModule,
      client: require(path.join(MOBILE_SRC, 'api', 'client.ts')) as ClientModule,
    };
    /* eslint-enable @typescript-eslint/no-var-requires */
  });
  if (!loaded) throw new Error('the phone modules did not load');
  return loaded;
}

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const { JS_RELEASE_VERSION } = require(path.join(MOBILE_SRC, 'api', 'release.ts')) as ReleaseModule;

/** The server's update gate with `app.minVersion.*` set as given. */
function gate(min: { driver: string; distributor: string }): AppVersionInterceptor {
  const settings = {
    get: jest.fn(async (key: string) => (key === 'app.minVersion.driver' ? min.driver : min.distributor)),
  } as unknown as SettingsService;
  return new AppVersionInterceptor(new Reflector(), settings);
}

/** What the gate answers a request with these headers (Express lower-cases them) and this signed-in role. */
async function gateAnswer(interceptor: AppVersionInterceptor, headers: Record<string, string>, role?: string): Promise<'handled' | number> {
  const req = { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), user: role ? { role } : undefined };
  const target = () => undefined;
  const context = {
    getType: () => 'http',
    getHandler: () => target,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of('handled') };
  try {
    return (await lastValueFrom(interceptor.intercept(context, next))) as 'handled';
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? -1;
  }
}

/** The X-App-* headers the phone's API client puts on a real request (captured by an axios adapter). */
async function headersOnTheWire(client: ClientModule): Promise<Record<string, string>> {
  let seen: Record<string, string> = {};
  const adapter: AxiosAdapter = async (config) => {
    seen = {
      'X-App-Variant': String(config.headers.get('X-App-Variant') ?? ''),
      'X-App-Version': String(config.headers.get('X-App-Version') ?? ''),
    };
    return { status: 200, statusText: 'OK', data: {}, headers: {}, config, request: {} } as AxiosResponse;
  };
  client.api.defaults.adapter = adapter;
  await client.api.get('/app/config', { skipAuth: true });
  return seen;
}

describe('REV23 contract-compat-02 The over-the-air JS sends its own release in X-App-Version', () => {
  it('REV23 contract-compat-02 the release is a plain x.y.z above 0.1.0, the version the installed APK and its JS report', () => {
    expect(JS_RELEASE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(serverCompare(JS_RELEASE_VERSION, '0.1.0')).toBe(1);
    // Never below the APK this JS is built for (app.config.ts `version`, which runtimeVersion follows).
    const config = fs.readFileSync(path.join(MOBILE, 'app.config.ts'), 'utf8');
    const native = /\bversion:\s*'(\d+\.\d+\.\d+)'/.exec(config)?.[1];
    expect(native).toBe('0.1.0');
    expect(serverCompare(JS_RELEASE_VERSION, native ?? '9.9.9')).toBeGreaterThanOrEqual(0);
    // The release file imports nothing, so other tests (and tools) can read it on its own.
    expect(fs.readFileSync(path.join(MOBILE_SRC, 'api', 'release.ts'), 'utf8')).not.toMatch(/^\s*import\s/m);
  });

  it.each(['driver', 'distributor'])(
    'REV23 contract-compat-02 on the 0.1.0 APK the %s build sends X-App-Variant and the JS release, not the native 0.1.0',
    async (variant) => {
      const { appInfo, client } = loadPhone({ version: '0.1.0', variant });
      expect(appInfo.NATIVE_VERSION).toBe('0.1.0');
      expect(appInfo.APP_VERSION).toBe(JS_RELEASE_VERSION);
      expect(client.appHeaders()).toMatchObject({ 'X-App-Variant': variant, 'X-App-Version': JS_RELEASE_VERSION });
      expect(await headersOnTheWire(client)).toEqual({ 'X-App-Variant': variant, 'X-App-Version': JS_RELEASE_VERSION });
    },
  );

  it.each([
    ['driver', 'DRIVER'],
    ['distributor', 'DISTRIBUTOR'],
  ])(
    'REV23 contract-compat-02 app.minVersion.%s at this release stops the 0.1.0 JS and the Inc 1 JS, and lets this JS through',
    async (variant, role) => {
      const { client } = loadPhone({ version: '0.1.0', variant });
      const interceptor = gate({ driver: JS_RELEASE_VERSION, distributor: JS_RELEASE_VERSION });
      // The af889bf JS on the 0.1.0 APK: the token and JSON only, no X-App-* header.
      expect(await gateAnswer(interceptor, {}, role)).toBe(426);
      // JS that sent the native version (the Inc 1 build over the air): variant and "0.1.0".
      expect(await gateAnswer(interceptor, { 'X-App-Variant': variant, 'X-App-Version': '0.1.0' }, role)).toBe(426);
      // This JS, with the headers its client really sends.
      expect(await gateAnswer(interceptor, client.appHeaders(), role)).toBe('handled');
      // And with the minimum still at the default, nobody is stopped.
      const open = gate({ driver: '0.0.0', distributor: '0.0.0' });
      expect(await gateAnswer(open, client.appHeaders(), role)).toBe('handled');
    },
  );

  it("REV23 contract-compat-02 the phone's own update gate reads the same version, so this minimum never shows it Update required", () => {
    const { appInfo } = loadPhone({ version: '0.1.0', variant: 'driver' });
    expect(appInfo.isVersionBelow(appInfo.APP_VERSION, JS_RELEASE_VERSION)).toBe(false);
    expect(appInfo.isVersionBelow(appInfo.APP_VERSION, '0.1.0')).toBe(false);
    // A later release's minimum does stop it.
    const [major, minor, patch] = JS_RELEASE_VERSION.split('.').map(Number);
    expect(appInfo.isVersionBelow(appInfo.APP_VERSION, `${major}.${minor}.${patch + 1}`)).toBe(true);
    // RootNavigator compares APP_VERSION (the header's value), not the native version.
    const root = fs.readFileSync(path.join(MOBILE_SRC, 'navigation', 'RootNavigator.tsx'), 'utf8');
    expect(root).toMatch(/isVersionBelow\(APP_VERSION,\s*config\.minVersion\[variant\]\)/);
    expect(root).toMatch(/import \{[^}]*\bAPP_VERSION\b[^}]*\} from '\.\.\/api\/appInfo'/);
    expect(root).not.toMatch(/NATIVE_VERSION/);
  });

  it('REV23 contract-compat-02 a newer APK carrying this JS never reports less than its own native version', () => {
    const { appInfo, client } = loadPhone({ version: '0.2.0', variant: 'distributor' });
    expect(appInfo.APP_VERSION).toBe(serverCompare('0.2.0', JS_RELEASE_VERSION) >= 0 ? '0.2.0' : JS_RELEASE_VERSION);
    expect(client.appHeaders()['X-App-Version']).toBe(appInfo.APP_VERSION);
    expect(appInfo.laterVersion('0.1.1', '0.1.0')).toBe('0.1.1');
    expect(appInfo.laterVersion('0.1.1', '0.2.0')).toBe('0.2.0');
    expect(appInfo.laterVersion('0.10.0', '0.9.3')).toBe('0.10.0');
  });

  it('REV23 contract-compat-02 Help shows the version the gate reads (the manual check before raising the minimum)', () => {
    for (const file of ['screens/distributor/HelpScreen.tsx', 'screens/driver/HelpScreen.tsx']) {
      const source = fs.readFileSync(path.join(MOBILE_SRC, file), 'utf8');
      expect(source).toMatch(/import \{[^}]*\bAPP_VERSION\b[^}]*\} from '\.\.\/\.\.\/api\/appInfo'/);
      expect(source).not.toMatch(/expoConfig\??\.version/);
    }
  });
});


describe('REV23 contract-compat-02 a restart answer that reaches this JS opens its update gate too', () => {
  // APP_RESTART_TO_UPDATE is for the 0.1.0 JS (a call with no X-App-* header). This JS always sends its
  // headers, but if a proxy ever dropped them it must not be stranded on a bare message: it is handled
  // exactly like APP_UPDATE_REQUIRED (the update gate, "Update the app").
  it('REV23 contract-compat-02 both 426 codes are update refusals with the update action', () => {
    let errors: typeof import('../../../../mobile/src/api/errors') | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      errors = require(path.join(MOBILE_SRC, 'api', 'errors.ts'));
    });
    if (!errors) throw new Error('errors.ts did not load');
    expect(errors.isUpdateRefusal({ code: 'APP_UPDATE_REQUIRED' })).toBe(true);
    expect(errors.isUpdateRefusal({ code: 'APP_RESTART_TO_UPDATE' })).toBe(true);
    expect(errors.isUpdateRefusal({ code: 'SERVICE_UNAVAILABLE' })).toBe(false);
    expect(errors.errorAction('APP_RESTART_TO_UPDATE')).toBe('UPDATE_APP');
    expect(errors.errorAction('APP_UPDATE_REQUIRED')).toBe('UPDATE_APP');
    const restart = errors.apiErrorFromHttp(426, { code: 'APP_RESTART_TO_UPDATE', message: 'Close the app and open it again to update.' });
    expect(errors.isUpdateRefusal(restart)).toBe(true);
    // The client marks the app as needing an update on either code (RootNavigator then shows the gate).
    const client = fs.readFileSync(path.join(MOBILE_SRC, 'api', 'client.ts'), 'utf8');
    expect(client).toMatch(/if \(isUpdateRefusal\(error\)\) status\.markUpdateRequired\(\);/);
  });
});
