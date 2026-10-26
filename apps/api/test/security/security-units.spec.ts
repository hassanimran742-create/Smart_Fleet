/**
 * Unit checks of the api-security building blocks: token claims, the 60-second session check, the
 * socket's origin rule and update throttle, CNIC storage and the office-user CLI's arguments.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { AppError } from '../../src/common/errors/app-error';
import { SESSION_CHECK_TTL_MS, SessionCheckService, type SessionUser } from '../../src/modules/auth/session-check.service';
import { appForRole, readTokenClaims, toAuthContext } from '../../src/modules/auth/token-claims';
import { UpdateThrottle } from '../../src/modules/drivers/drivers.gateway';
import { isSocketOriginAllowed, setSocketOrigins } from '../../src/modules/drivers/socket-origins';
import { generateOfficePassword, parseCreateOfficeUserArgs } from '../../src/modules/users/cli/create-office-user';
import { CnicVault } from '../../src/modules/users/cnic-vault.service';

const USER_ID = '7b0b8f8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const DRIVER_ID = '8c1c9f9f-2b3c-4d4e-9f0a-1b2c3d4e5f60';

function codeOf(error: unknown): string | null {
  return error instanceof AppError ? error.code : null;
}

describe('token claims', () => {
  it('SEC-001 reads sub, role, profile ids and tv; a token without tv counts as version 0', () => {
    expect(readTokenClaims({ sub: USER_ID, role: 'DRIVER', driverId: DRIVER_ID, tv: 3 })).toEqual({
      sub: USER_ID,
      role: UserRole.DRIVER,
      driverId: DRIVER_ID,
      distributorId: undefined,
      clientId: undefined,
      tv: 3,
    });
    expect(readTokenClaims({ sub: USER_ID, role: 'DISTRIBUTOR' })?.tv).toBe(0);
    expect(toAuthContext({ sub: USER_ID, role: UserRole.DRIVER, driverId: DRIVER_ID, tv: 0 })).toEqual({
      userId: USER_ID,
      role: 'DRIVER',
      driverId: DRIVER_ID,
    });
  });

  it('SEC-009 refuses payloads that are not the documented shape', () => {
    for (const payload of [null, 'x', {}, { sub: 'not-a-uuid', role: 'DRIVER' }, { sub: USER_ID, role: 'OWNER' }, { sub: USER_ID, role: 'DRIVER', tv: -1 }, { sub: USER_ID, role: 'DRIVER', tv: '1' }]) {
      expect(readTokenClaims(payload)).toBeNull();
    }
  });

  it('SEC-006 each role signs in to one app', () => {
    expect(appForRole(UserRole.DISTRIBUTOR)).toBe('distributor');
    expect(appForRole(UserRole.DRIVER)).toBe('driver');
    for (const role of [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER, UserRole.CLIENT]) {
      expect(appForRole(role)).toBe('admin-web');
    }
  });
});

describe('the session check (API_CONTRACT §3.3)', () => {
  function make(initial: SessionUser, locked: UserRole[] = [UserRole.ADMIN]) {
    const row = { current: { ...initial } as SessionUser | null };
    const reads = { count: 0 };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => {
          reads.count += 1;
          return row.current ? { ...row.current } : null;
        }),
      },
    };
    const settings = { get: jest.fn(async () => locked) };
    const service = new SessionCheckService(prisma as never, settings as never);
    return { service, row, reads, locked };
  }
  const user: SessionUser = { id: USER_ID, role: UserRole.DRIVER, status: UserStatus.ACTIVE, tokenVersion: 2 };
  const claims = { sub: USER_ID, role: UserRole.DRIVER, tv: 2 };

  afterEach(() => jest.restoreAllMocks());

  it('SEC-010 trusts a cached user for at most 60 seconds', async () => {
    const { service, row, reads } = make(user);
    await service.assertLive(claims);
    row.current = { ...user, status: UserStatus.SUSPENDED };
    await expect(service.assertLive(claims)).resolves.toMatchObject({ status: UserStatus.ACTIVE });
    expect(reads.count).toBe(1);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + SESSION_CHECK_TTL_MS + 1);
    expect(codeOf(await service.assertLive(claims).catch((e: unknown) => e))).toBe('AUTH_SESSION_REVOKED');
  });

  it('SEC-010 never refuses a good token because of the cache (a newer tv is read fresh)', async () => {
    const { service, row } = make(user);
    await service.assertLive(claims);
    row.current = { ...user, tokenVersion: 3 };
    await expect(service.assertLive({ ...claims, tv: 3 })).resolves.toMatchObject({ tokenVersion: 3 });
    // ...and the old token is now refused.
    expect(codeOf(await service.assertLive(claims).catch((e: unknown) => e))).toBe('AUTH_SESSION_REVOKED');
  });

  it('SEC-010 forget() ends a session on the next request', async () => {
    const { service, row } = make(user);
    await service.assertLive(claims);
    row.current = { ...user, status: UserStatus.SUSPENDED };
    service.forget(USER_ID);
    expect(codeOf(await service.assertLive(claims).catch((e: unknown) => e))).toBe('AUTH_SESSION_REVOKED');
  });

  it('SEC-005 a locked role, another role, an unknown user or a non-active one is revoked', async () => {
    const cases: Array<[SessionUser | null, UserRole[], typeof claims]> = [
      [user, [UserRole.DRIVER], claims],
      [{ ...user, role: UserRole.DISTRIBUTOR }, [], claims],
      [null, [], claims],
      [{ ...user, status: UserStatus.PENDING }, [], claims],
    ];
    for (const [row, locked, c] of cases) {
      const { service, row: holder } = make(user, locked);
      holder.current = row;
      expect(codeOf(await service.assertLive(c).catch((e: unknown) => e))).toBe('AUTH_SESSION_REVOKED');
    }
  });

  it('SEC-005 assertLiveNow always reads the database', async () => {
    const { service, row, reads } = make(user);
    await service.assertLive(claims);
    row.current = { ...user, status: UserStatus.SUSPENDED };
    expect(codeOf(await service.assertLiveNow(claims).catch((e: unknown) => e))).toBe('AUTH_SESSION_REVOKED');
    expect(reads.count).toBe(2);
  });
});

describe('the /drivers socket rules (API_CONTRACT §7.14, §3.7)', () => {
  afterEach(() => setSocketOrigins([]));

  it('SEC-016 a driver updates at most once per 5 seconds', () => {
    let now = 1_000_000;
    const throttle = new UpdateThrottle(5_000, () => now);
    expect(throttle.take('dr1')).toBe(0);
    now += 1_000;
    expect(throttle.take('dr1')).toBe(4_000);
    expect(throttle.take('dr2')).toBe(0);
    now += 4_000;
    expect(throttle.take('dr1')).toBe(0);
  });

  it('SEC-018 the socket accepts the configured origins, the API\'s own origin and apps without one', () => {
    setSocketOrigins(['https://office.test.smartfleet.example/']);
    expect(isSocketOriginAllowed(undefined)).toBe(true);
    expect(isSocketOriginAllowed('https://office.test.smartfleet.example')).toBe(true);
    expect(isSocketOriginAllowed('https://evil.example')).toBe(false);
    expect(isSocketOriginAllowed('null')).toBe(false);
    // React Native sends the API's own origin.
    expect(isSocketOriginAllowed('https://api.smartfleet.example', 'api.smartfleet.example')).toBe(true);
    expect(isSocketOriginAllowed('https://api.smartfleet.example', 'other.example')).toBe(false);
    setSocketOrigins([]);
    expect(isSocketOriginAllowed('https://anything.example')).toBe(true);
  });
});

describe('CNIC storage (API_CONTRACT §3.5, §7.3 rule 4)', () => {
  const keys = { encryption: { key: 'a'.repeat(64), keyOld: '', blindIndexKey: 'b'.repeat(64) } };
  const vault = new CnicVault(new CryptoService(new ConfigService(keys) as never));

  it('OFF-015 one CNIC, with or without dashes, has one index; it is stored encrypted and shown masked', () => {
    const sealed = vault.seal('35202-7654321-3');
    expect(vault.indexOf('3520276543213')).toBe(sealed.cnicIndex);
    expect(sealed.cnicIndex).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.cnicEncrypted.toString('utf8')).not.toContain('7654321');
    expect(vault.maskOf({ cnicEncrypted: sealed.cnicEncrypted })).toBe('*****-****321-3');
    expect(vault.maskOf({ cnic: '35202-1234567-1' })).toBe('*****-****567-1');
    expect(vault.maskOf({})).toBeNull();
    expect(vault.indexOf('12345')).toBeNull();
  });
});

describe('the office-user CLI arguments (API_CONTRACT §8.5 step 8)', () => {
  it('SET-001 needs a name and a phone, and prints a strong password', () => {
    expect(parseCreateOfficeUserArgs(['--name', 'Owner', '--phone', '+923331000001'])).toEqual({ name: 'Owner', phone: '+923331000001' });
    expect(parseCreateOfficeUserArgs(['--name=Ops', '--phone=0333 1000002'])).toEqual({ name: 'Ops', phone: '0333 1000002' });
    for (const argv of [[], ['--name', 'Owner'], ['--phone', '0333 1000001'], ['--name', '', '--phone', '0333'], ['--role', 'ADMIN']]) {
      expect(() => parseCreateOfficeUserArgs(argv)).toThrow();
    }
    const passwords = new Set(Array.from({ length: 50 }, () => generateOfficePassword()));
    expect(passwords.size).toBe(50);
    const group = '[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{4}';
    for (const password of passwords) expect(password).toMatch(new RegExp(`^${group}-${group}-${group}$`));
  });
});

describe('FND-033 housekeeping runs on Pakistan time', () => {
  it('FND-033 the housekeeping job passes the Asia/Karachi time zone and its documented schedule', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/modules/housekeeping/housekeeping.service.ts'), 'utf8');
    expect(source).toContain(
      "@Cron(process.env.HOUSEKEEPING_CRON ?? '0 3 * * *', { name: 'housekeeping-nightly', timeZone: 'Asia/Karachi' })",
    );
  });
});
