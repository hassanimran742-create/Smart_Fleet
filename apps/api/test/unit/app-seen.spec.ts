/**
 * FND-045: the update gate records which app each shop and driver used (API_CONTRACT §8.5 step 10,
 * DATA_MODEL §5.6), so the office's Drivers and Distributors lists can say "App: up to date" or "App: needs
 * update" against `app.minVersion`. AppSeenService with a stubbed database, and the gate
 * (AppVersionInterceptor) with stubbed settings: no database, no HTTP.
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { APP_SEEN_REFRESH_MS, AppSeenService, appSeenView } from '../../src/common/app-seen/app-seen.service';
import { AppError } from '../../src/common/errors/app-error';
import { AppVersionInterceptor, NEW_APP_ONLY_KEY, SKIP_VERSION_GATE_KEY } from '../../src/common/interceptors/app-version.interceptor';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SettingsService } from '../../src/modules/settings/settings.service';
import { JS_RELEASE_VERSION } from '../../../mobile/src/api/release';

const DRIVER_USER = '00000000-0000-4000-8000-0000000000d1';
const SHOP_USER = '00000000-0000-4000-8000-0000000000a1';

/** One recorded write: the parameters of AppSeenService's UPDATE (app, version, user id). */
type Write = { app: unknown; version: unknown; userId: unknown };

/** A PrismaService whose `$executeRaw` keeps the UPDATE's parameters, or fails while `failing` is set. */
function fakePrisma(): { prisma: PrismaService; writes: Write[]; failing: { on: boolean } } {
  const writes: Write[] = [];
  const failing = { on: false };
  const $executeRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (failing.on) throw new Error('connection lost');
    expect(strings.join('?')).toMatch(/UPDATE users SET app_variant = \?, app_version = \?, app_seen_at = \(now\(\) AT TIME ZONE 'UTC'\)\s+WHERE id = \?::uuid/);
    writes.push({ app: values[0], version: values[1], userId: values[2] });
    return 1;
  });
  return { prisma: { $executeRaw } as unknown as PrismaService, writes, failing };
}

function settingsWith(min: { driver: string; distributor: string }): SettingsService {
  return { get: jest.fn(async (key: string) => (key === 'app.minVersion.driver' ? min.driver : min.distributor)) } as unknown as SettingsService;
}

function context(req: { headers: Record<string, string>; user?: { userId?: string; role: string } }, marks: { skip?: boolean; newAppOnly?: boolean } = {}): ExecutionContext {
  const target = () => undefined;
  if (marks.skip) Reflect.defineMetadata(SKIP_VERSION_GATE_KEY, true, target);
  if (marks.newAppOnly) Reflect.defineMetadata(NEW_APP_ONLY_KEY, true, target);
  return {
    getType: () => 'http',
    getHandler: () => target,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of('handled') };

/** What the gate answers: 'handled', or the refusal's code. */
async function answer(gate: AppVersionInterceptor, ctx: ExecutionContext): Promise<string> {
  try {
    return String(await lastValueFrom(gate.intercept(ctx, next)));
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

const NEW_DRIVER = { 'x-app-variant': 'driver', 'x-app-version': JS_RELEASE_VERSION };

describe('FND-045 which app each shop and driver used (API_CONTRACT §8.5 step 10)', () => {
  it('FND-045 a call is written once, again at once when the app or its version changes, and again after 10 minutes', async () => {
    const { prisma, writes } = fakePrisma();
    const seen = new AppSeenService(prisma, settingsWith({ driver: '0.0.0', distributor: '0.0.0' }));
    const t0 = Date.parse('2026-10-25T10:00:00.000Z');
    await seen.record(DRIVER_USER, 'driver', '0.1.1', t0);
    await seen.record(DRIVER_USER, 'driver', '0.1.1', t0 + 60_000);
    expect(writes).toEqual([{ app: 'driver', version: '0.1.1', userId: DRIVER_USER }]);
    await seen.record(DRIVER_USER, 'driver', '0.1.2', t0 + 120_000);
    expect(writes).toHaveLength(2);
    await seen.record(DRIVER_USER, 'driver', '0.1.2', t0 + 120_000 + APP_SEEN_REFRESH_MS - 1);
    expect(writes).toHaveLength(2);
    await seen.record(DRIVER_USER, 'driver', '0.1.2', t0 + 120_000 + APP_SEEN_REFRESH_MS);
    expect(writes.map((w) => w.version)).toEqual(['0.1.1', '0.1.2', '0.1.2']);
    // Each user on their own.
    await seen.record(SHOP_USER, 'distributor', '0.1.0', t0 + 130_000);
    expect(writes[writes.length - 1]).toEqual({ app: 'distributor', version: '0.1.0', userId: SHOP_USER });
    expect(APP_SEEN_REFRESH_MS).toBe(10 * 60_000);
  });

  it('FND-045 a failed write never fails the call; it is logged, and the next call writes again', async () => {
    const { prisma, writes, failing } = fakePrisma();
    const seen = new AppSeenService(prisma, settingsWith({ driver: '0.0.0', distributor: '0.0.0' }));
    const warn = jest.spyOn((seen as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    failing.on = true;
    await expect(seen.record(SHOP_USER, 'distributor', '0.1.1', 1_000)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not record the app of user'));
    failing.on = false;
    await seen.record(SHOP_USER, 'distributor', '0.1.1', 2_000);
    expect(writes).toEqual([{ app: 'distributor', version: '0.1.1', userId: SHOP_USER }]);
  });

  it('FND-045 the office reads NOT_SEEN with no call, NEEDS_UPDATE below app.minVersion and UP_TO_DATE at or above it', async () => {
    const at = new Date('2026-10-25T10:00:00.000Z');
    expect(appSeenView({ appVariant: null, appVersion: null, appSeenAt: null }, '0.1.1')).toEqual({ status: 'NOT_SEEN', version: null, seenAt: null });
    expect(appSeenView({ appVariant: 'distributor', appVersion: '0.1.0', appSeenAt: at }, '0.1.1')).toEqual({
      status: 'NEEDS_UPDATE',
      version: '0.1.0',
      seenAt: '2026-10-25T10:00:00.000Z',
    });
    expect(appSeenView({ appVariant: 'driver', appVersion: '0.1.1', appSeenAt: at }, '0.1.1').status).toBe('UP_TO_DATE');
    expect(appSeenView({ appVariant: 'driver', appVersion: '0.10.0', appSeenAt: at }, '0.9.3').status).toBe('UP_TO_DATE');
    // A pre-release or build suffix is ignored, as the gate ignores it.
    expect(appSeenView({ appVariant: 'driver', appVersion: '0.1.1-beta.2', appSeenAt: at }, '0.1.1').status).toBe('UP_TO_DATE');
    // With the default minimum (0.0.0) every app seen is up to date: the switch-over raises it first (§8.5 step 10).
    expect(appSeenView({ appVariant: 'distributor', appVersion: '0.1.0', appSeenAt: at }, '0.0.0').status).toBe('UP_TO_DATE');
    // One settings read per list, by the list's app.
    const settings = settingsWith({ driver: '0.1.1', distributor: '0.2.0' });
    const seen = new AppSeenService(fakePrisma().prisma, settings);
    const row = { appVariant: 'distributor', appVersion: '0.1.1', appSeenAt: at };
    expect((await seen.viewsOf('distributor', [row, row])).map((v) => v.status)).toEqual(['NEEDS_UPDATE', 'NEEDS_UPDATE']);
    expect((await seen.viewsOf('driver', [{ ...row, appVariant: 'driver' }])).map((v) => v.status)).toEqual(['UP_TO_DATE']);
    expect(settings.get).toHaveBeenCalledTimes(2);
    expect(await seen.viewsOf('driver', [])).toEqual([]);
  });

  it('FND-045 the gate hands every signed-in call of a shop or driver from its own app to the recorder, refused or not', async () => {
    const record = jest.fn(async () => undefined);
    const gate = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.1.1', distributor: '0.1.1' }), { record } as unknown as AppSeenService);
    // The Inc 2/3 driver app: let through, recorded with its release.
    expect(await answer(gate, context({ headers: NEW_DRIVER, user: { userId: DRIVER_USER, role: 'DRIVER' } }))).toBe('handled');
    expect(record).toHaveBeenLastCalledWith(DRIVER_USER, 'driver', JS_RELEASE_VERSION);
    // The installed 0.1.0 JS sends no header: told to restart, and recorded as 0.1.0 (what the gate read).
    expect(await answer(gate, context({ headers: {}, user: { userId: SHOP_USER, role: 'DISTRIBUTOR' } }))).toBe('APP_RESTART_TO_UPDATE');
    expect(record).toHaveBeenLastCalledWith(SHOP_USER, 'distributor', '0.1.0');
    // A route only the Inc 2/3 apps may use refuses the 0.1.0 JS whatever the minimum, and still records it.
    const open = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.0.0', distributor: '0.0.0' }), { record } as unknown as AppSeenService);
    record.mockClear();
    expect(await answer(open, context({ headers: {}, user: { userId: SHOP_USER, role: 'DISTRIBUTOR' } }, { newAppOnly: true }))).toBe('APP_RESTART_TO_UPDATE');
    expect(record).toHaveBeenCalledWith(SHOP_USER, 'distributor', '0.1.0');
    // An invalid version counts as the missing one, as the gate counts it.
    expect(await answer(open, context({ headers: { 'x-app-variant': 'driver', 'x-app-version': 'latest' }, user: { userId: DRIVER_USER, role: 'DRIVER' } }))).toBe('handled');
    expect(record).toHaveBeenLastCalledWith(DRIVER_USER, 'driver', '0.1.0');
  });

  it('FND-045 nothing is recorded for the office, a call without a token, another app than the role\'s, or a route the gate skips', async () => {
    const record = jest.fn(async () => undefined);
    const gate = new AppVersionInterceptor(new Reflector(), settingsWith({ driver: '0.0.0', distributor: '0.0.0' }), { record } as unknown as AppSeenService);
    expect(await answer(gate, context({ headers: { 'x-app-variant': 'admin-web', 'x-app-version': '0.1.0' }, user: { userId: SHOP_USER, role: 'SUPER_ADMIN' } }))).toBe('handled');
    expect(await answer(gate, context({ headers: {}, user: { userId: SHOP_USER, role: 'SUPER_ADMIN' } }))).toBe('handled');
    expect(await answer(gate, context({ headers: NEW_DRIVER }))).toBe('handled');
    expect(await answer(gate, context({ headers: NEW_DRIVER, user: { userId: SHOP_USER, role: 'DISTRIBUTOR' } }))).toBe('handled');
    expect(await answer(gate, context({ headers: NEW_DRIVER, user: { userId: DRIVER_USER, role: 'DRIVER' } }, { skip: true }))).toBe('handled');
    expect(record).not.toHaveBeenCalled();
  });
});
