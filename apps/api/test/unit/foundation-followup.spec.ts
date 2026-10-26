/**
 * The API core changes of the 2026-10-22 spec reconciliation (docs/pilot/CHANGELOG.md), each named by
 * its gap: the required Idempotency-Key (G01-01), CUSTOMER audit rows without IP or user agent
 * (G07-03, part of FND-013), setting switches (G07-07, G09-09), the rate-limit peek (G07-25), the CNIC
 * mask (G11-11, G11-12) and the retired OTP setting (G11-15).
 */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { customerActor, systemActor, userActor } from '../../src/common/auth/actor';
import { RequestContext } from '../../src/common/context/request-context';
import { ExactRoles } from '../../src/common/decorators/roles.decorator';
import { AppError } from '../../src/common/errors/app-error';
import { SettingSwitch, SettingSwitchGuard } from '../../src/common/features/feature';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { readIdempotencyKey } from '../../src/common/idempotency/idempotency';
import { RateLimitService, type RateLimitStore } from '../../src/common/rate-limit/rate-limit.service';
import { maskCnic, normalizeCnic } from '../../src/common/security/cnic';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service';
import { isEditableOverApi, SETTINGS } from '../../src/modules/settings/registry';
import type { SettingsService } from '../../src/modules/settings/settings.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

const KEY = '7D3A2C1B-9E8F-4A6B-8C7D-1E2F3A4B5C6D';

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-an-app-error';
  }
}

describe('G01-01 @IdempotencyKey({ required: true })', () => {
  it('reads the header lower-cased, and answers the same 400 for a missing or a malformed key', () => {
    expect(readIdempotencyKey(KEY)).toBe(KEY.toLowerCase());
    expect(readIdempotencyKey([KEY, 'ignored'])).toBe(KEY.toLowerCase());
    expect(readIdempotencyKey(undefined)).toBeUndefined();
    expect(readIdempotencyKey('  ')).toBeUndefined();

    const missing = (() => {
      try {
        readIdempotencyKey(undefined, { required: true });
      } catch (error) {
        return error as AppError<'VALIDATION_FAILED'>;
      }
      return null;
    })();
    expect(missing?.code).toBe('VALIDATION_FAILED');
    expect(missing?.details.fields).toEqual([{ path: 'Idempotency-Key', code: 'REQUIRED', message: 'Fill this in.' }]);
    expect(codeOf(() => readIdempotencyKey('not-a-uuid', { required: true }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => readIdempotencyKey('not-a-uuid'))).toBe('VALIDATION_FAILED');
  });
});

describe('G07-03 a CUSTOMER audit row never stores the IP or the user agent (FND-013 step 4)', () => {
  function service() {
    const create = jest.fn(async (_args: { data: Record<string, unknown> }) => ({}));
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    return { audit: new AuditLogService(prisma), create };
  }

  it('keeps the request id for every actor and the IP and user agent for users and the system only', async () => {
    const { audit, create } = service();
    const context = { requestId: 'req-audit-1', ip: '203.0.113.7', userAgent: 'SmartFleet/0.2.0' };
    const user = userActor({ userId: '11111111-1111-1111-1111-111111111111', role: UserRole.SUPER_ADMIN });
    await RequestContext.run(context, async () => {
      await audit.record({ action: 'setting.update', actor: user, resourceType: 'AppSetting', reason: 'Rehearsal' });
      await audit.record({ action: 'wallet.check', actor: systemActor('job:wallet-check'), resourceType: 'Wallet' });
      await audit.record({ action: 'confirmation.answer', actor: customerActor('link:AG-0001'), resourceType: 'Order' });
    });
    const rows = create.mock.calls.map(([args]) => args.data);
    expect(rows.map((row) => [row.actorKind, row.ip, row.userAgent, row.requestId])).toEqual([
      ['USER', '203.0.113.7', 'SmartFleet/0.2.0', 'req-audit-1'],
      ['SYSTEM', '203.0.113.7', 'SmartFleet/0.2.0', 'req-audit-1'],
      ['CUSTOMER', null, null, 'req-audit-1'],
    ]);
    expect(rows[2]).toMatchObject({ actorUserId: null, actorLabel: 'link:AG-0001' });
  });
});

@ExactRoles(UserRole.SUPER_ADMIN)
@SettingSwitch('dayEnd.enabled', 'dayEnd')
class DayEndLikeController {
  list() {}
  approve() {}
}

class ConfirmationLikeController {
  @SettingSwitch('confirmation.enabled', 'confirmations')
  view() {}

  open() {}
}

function context(controller: new () => object, method: string, req: Record<string, unknown>, res: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('G09-09, G07-07 @SettingSwitch(key, name)', () => {
  function settings(values: Record<string, boolean>): SettingsService {
    return { get: jest.fn(async (key: string) => values[key] ?? false) } as unknown as SettingsService;
  }

  function response() {
    const headers: Record<string, string> = {};
    return { headers, res: { setHeader: (name: string, value: string) => (headers[name] = value) } };
  }

  it('answers every method, reads included, 403 FEATURE_DISABLED with X-Feature-Disabled while the setting is off', async () => {
    const guard = new SettingSwitchGuard(new Reflector(), settings({}));
    for (const method of ['GET', 'POST']) {
      const { headers, res } = response();
      await expect(guard.canActivate(context(DayEndLikeController, 'list', { method }, res))).rejects.toMatchObject({
        code: 'FEATURE_DISABLED',
      });
      expect(headers['X-Feature-Disabled']).toBe('dayEnd');
    }
  });

  it('lets the route run when the setting is on, and leaves unswitched routes alone', async () => {
    const on = settings({ 'confirmation.enabled': true });
    const guard = new SettingSwitchGuard(new Reflector(), on);
    const { res } = response();
    await expect(guard.canActivate(context(ConfirmationLikeController, 'view', { method: 'GET' }, res))).resolves.toBe(true);
    expect(on.get).toHaveBeenCalledWith('confirmation.enabled');
    const off = settings({});
    await expect(
      new SettingSwitchGuard(new Reflector(), off).canActivate(context(ConfirmationLikeController, 'open', { method: 'GET' }, res)),
    ).resolves.toBe(true);
    expect(off.get).not.toHaveBeenCalled();
  });

  it('runs right after sign-in, before the role check: a wrong role still gets FEATURE_DISABLED while off', async () => {
    const guard = new RolesGuard(new Reflector(), settings({}));
    const { headers, res } = response();
    const asDriver = { method: 'GET', user: { role: UserRole.DRIVER } };
    await expect(guard.canActivate(context(DayEndLikeController, 'approve', asDriver, res))).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(headers['X-Feature-Disabled']).toBe('dayEnd');
    // Switched on, the role rule applies as before.
    const onGuard = new RolesGuard(new Reflector(), settings({ 'dayEnd.enabled': true }));
    await expect(onGuard.canActivate(context(DayEndLikeController, 'approve', asDriver, res))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      onGuard.canActivate(context(DayEndLikeController, 'approve', { method: 'GET', user: { role: UserRole.SUPER_ADMIN } }, res)),
    ).resolves.toBe(true);
  });
});

describe('G07-25 RateLimitService.peek', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  class MemoryStore implements RateLimitStore {
    counts = new Map<string, number>();
    async eval(script: string, _numKeys: number, key: string | number): Promise<unknown> {
      const k = String(key);
      if (script.includes("'GET'")) return this.counts.get(k) ?? 0;
      const n = (this.counts.get(k) ?? 0) + 1;
      this.counts.set(k, n);
      return n;
    }
  }

  it("reads the current window's count without counting, from the same key as hit", async () => {
    const store = new MemoryStore();
    const limiter = new RateLimitService(new ConfigService({ redis: { keyPrefix: 'sf-test' } })).useStore(store);
    const now = Date.parse('2026-10-21T10:00:30Z');
    expect(await limiter.peek('confirm.ip', '203.0.113.7', 60, now)).toBe(0);
    await limiter.hit('confirm.ip', '203.0.113.7', 10, 60, now);
    await limiter.hit('confirm.ip', '203.0.113.7', 10, 60, now + 1000);
    expect(await limiter.peek('confirm.ip', '203.0.113.7', 60, now + 2000)).toBe(2);
    expect(await limiter.peek('confirm.ip', '203.0.113.7', 60, now + 2000)).toBe(2);
    expect(await limiter.peek('confirm.ip', '203.0.113.7', 60, now + 60_000)).toBe(0);
  });

  it('fails open: 0 when Redis is down or slow', async () => {
    const broken: RateLimitStore = { eval: async () => Promise.reject(new Error('ECONNREFUSED')) };
    const limiter = new RateLimitService(new ConfigService({})).useStore(broken);
    expect(await limiter.peek('confirm.ip', 'x', 60)).toBe(0);
    jest.useFakeTimers();
    try {
      const slow = new RateLimitService(new ConfigService({})).useStore({ eval: () => new Promise(() => undefined) });
      const pending = slow.peek('confirm.ip', 'x', 60);
      jest.advanceTimersByTime(600);
      expect(await pending).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('G11-11, G11-12 CNIC helpers', () => {
  it('reduces a CNIC to its 13 digits and masks it to the last four for office views', () => {
    expect(normalizeCnic('35202-7654321-3')).toBe('3520276543213');
    expect(normalizeCnic(' 35202 7654321 3 ')).toBe('3520276543213');
    expect(normalizeCnic('35202-7654321')).toBeNull();
    expect(normalizeCnic('3520276543213x')).toBeNull();
    expect(maskCnic('3520212345671')).toBe('*****-****567-1');
    expect(maskCnic('35202-7654321-3')).toBe('*****-****321-3');
    expect(maskCnic(null)).toBeNull();
    expect(maskCnic('')).toBeNull();
    // The mask never carries more than four digits.
    expect((maskCnic('3520212345671') ?? '').replace(/\D/g, '')).toHaveLength(4);
  });
});

describe('G11-15 code sign-in is reserved', () => {
  it('keeps auth.otpLogin.enabled off and not editable over the API', () => {
    expect(SETTINGS['auth.otpLogin.enabled']).toMatchObject({ default: false, editable: false, public: false });
    expect(isEditableOverApi('auth.otpLogin.enabled')).toBe(false);
  });
});

describe('FND-025 BigInt money serialises exactly (API_CONTRACT §1.1)', () => {
  it('FND-025 JSON carries a BigInt as its exact digit string, past 2^53 too', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { installBigIntJson } = require('../../src/common/bootstrap/bigint-json') as typeof import('../../src/common/bootstrap/bigint-json');
    installBigIntJson();
    expect(JSON.stringify({ amountPaisa: 9007199254740993n })).toBe('{"amountPaisa":"9007199254740993"}');
    expect(JSON.stringify({ amountPaisa: -25000n, balanceAfterPaisa: 0n })).toBe('{"amountPaisa":"-25000","balanceAfterPaisa":"0"}');
  });
});
