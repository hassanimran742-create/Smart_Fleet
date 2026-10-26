import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { SecretStripInterceptor } from '../../src/common/interceptors/secret-strip.interceptor';
import { toJsonSafe } from '../../src/common/security/json-safe';
import { SECRET_KEYS, stripSecrets } from '../../src/common/security/strip-secrets';

const SECRETS = ['passwordHash', 'cnic', 'cnicEncrypted', 'cnicIndex', 'codeHash', 'tokenHash'];

function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, inner]) => SECRETS.includes(key) || containsSecret(inner));
  }
  return false;
}

function fixture() {
  const createdAt = new Date('2026-10-21T10:00:00.000Z');
  return {
    id: 'o-1',
    deliveryFeePaisa: BigInt(33000),
    createdAt,
    distributor: {
      id: 'd-1',
      businessName: 'Ali Gas',
      user: {
        id: 'u-1',
        name: 'Ali',
        phone: '+923001234567',
        passwordHash: '$argon2id$v=19$…',
        cnic: '35202-1234567-1',
        cnicEncrypted: Buffer.from('cipher'),
        cnicIndex: 'f'.repeat(64),
      },
    },
    trip: {
      driver: {
        user: { id: 'u-2', name: 'Bilal', passwordHash: 'h', refreshTokens: [{ id: 'rt-1', tokenHash: 'abc' }] },
      },
    },
    otp: { codeHash: 'xyz', expiresAt: createdAt },
    lines: [
      { id: 'l-1', fullCount: 2 },
      { id: 'l-2', fullCount: 1, nested: [[{ cnic: 'deep' }]] },
    ],
  };
}

describe('stripSecrets (API_CONTRACT §3.5)', () => {
  it('lists exactly the contract keys', () => {
    expect([...SECRET_KEYS].sort()).toEqual([...SECRETS].sort());
  });

  it('removes passwordHash, cnic, cnicEncrypted, cnicIndex, codeHash and tokenHash at any depth', () => {
    const input = fixture();
    const output = stripSecrets(input);
    expect(containsSecret(output)).toBe(false);
    expect(output.distributor.user).toEqual({ id: 'u-1', name: 'Ali', phone: '+923001234567' });
    expect(output.trip.driver.user.refreshTokens).toEqual([{ id: 'rt-1' }]);
    expect(output.otp).toEqual({ expiresAt: input.otp.expiresAt });
    expect(output.lines[1]).toEqual({ id: 'l-2', fullCount: 1, nested: [[{}]] });
  });

  it('keeps everything else, including BigInt and Date, and never mutates the input', () => {
    const input = fixture();
    const before = JSON.stringify(input, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));
    const output = stripSecrets(input);
    expect(output.deliveryFeePaisa).toBe(BigInt(33000));
    expect(output.createdAt).toBe(input.createdAt);
    expect(output.lines[0]).toBe(input.lines[0]);
    expect(JSON.stringify(input, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v))).toBe(before);
    expect(input.distributor.user.passwordHash).toBeDefined();
  });

  it('returns the same reference when there is nothing to strip', () => {
    const clean = { a: 1, b: [{ c: 'x' }], d: null };
    expect(stripSecrets(clean)).toBe(clean);
    expect(stripSecrets('text')).toBe('text');
    expect(stripSecrets(null)).toBeNull();
  });

  it('walks class instances too', () => {
    class UserRow {
      constructor(
        readonly id: string,
        readonly passwordHash: string,
      ) {}
    }
    expect(stripSecrets({ user: new UserRow('u-9', 'h') })).toEqual({ user: { id: 'u-9' } });
  });

  it('survives cycles', () => {
    const a: Record<string, unknown> = { id: 'a', tokenHash: 't' };
    a.self = a;
    const out = stripSecrets(a) as Record<string, unknown>;
    expect(out.id).toBe('a');
    expect('tokenHash' in out).toBe(false);
  });
});

describe('SecretStripInterceptor', () => {
  const http = { getType: () => 'http' } as unknown as ExecutionContext;

  it('strips every HTTP response body', async () => {
    const next: CallHandler = { handle: () => of([fixture(), fixture()]) };
    const body = await lastValueFrom(new SecretStripInterceptor().intercept(http, next));
    expect(containsSecret(body)).toBe(false);
    expect((body as unknown[]).length).toBe(2);
  });

  it('passes non-HTTP contexts through', async () => {
    const ws = { getType: () => 'ws' } as unknown as ExecutionContext;
    const payload = { passwordHash: 'kept for a gateway to decide' };
    const out = await lastValueFrom(new SecretStripInterceptor().intercept(ws, { handle: () => of(payload) }));
    expect(out).toBe(payload);
  });
});

describe('toJsonSafe (audit diffs and error details)', () => {
  it('turns BigInt into digit strings and Dates into ISO text, without secrets', () => {
    expect(
      toJsonSafe({
        balancePaisa: BigInt(-4500),
        at: new Date('2026-10-21T10:00:00.000Z'),
        user: { name: 'Ali', passwordHash: 'x' },
        skip: undefined,
        fn: () => 1,
        list: [BigInt(1), undefined],
      }),
    ).toEqual({ balancePaisa: '-4500', at: '2026-10-21T10:00:00.000Z', user: { name: 'Ali' }, list: ['1', null] });
  });
});
