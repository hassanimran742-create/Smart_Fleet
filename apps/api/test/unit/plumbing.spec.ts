import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of } from 'rxjs';
import { userActor } from '../../src/common/auth/actor';
import { RequestContext } from '../../src/common/context/request-context';
import { RequestContextMiddleware } from '../../src/common/context/request-context.middleware';
import { AppError } from '../../src/common/errors/app-error';
import {
  alreadyApplied,
  assertSameRequest,
  IdempotencyInterceptor,
  IdempotencyKey,
  replayed,
} from '../../src/common/idempotency/idempotency';
import { decodeCursor, encodeCursor, pageLimit, toPage } from '../../src/common/pagination/cursor';
import { corsOptions } from '../../src/common/bootstrap/configure-app';
import { parseCorsOrigins } from '../../src/config/configuration';

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  status: jest.Mock;
  setHeader: jest.Mock;
}

function fakeRes(): FakeRes {
  const res = { statusCode: 201, headers: {} } as FakeRes;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.setHeader = jest.fn((name: string, value: string) => {
    res.headers[name] = value;
  });
  return res;
}

function httpCtx(req: Record<string, unknown>, res: FakeRes): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

/** Runs a param decorator's factory the way Nest does. */
function paramFactory(decorator: () => ParameterDecorator): (data: unknown, ctx: ExecutionContext) => unknown {
  class Target {
    handler(_value: unknown) {}
  }
  decorator()(Target.prototype, 'handler', 0);
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Target, 'handler') as Record<string, { factory: never }>;
  return Object.values(args)[0].factory;
}

describe('idempotency helper (API_CONTRACT §4.2)', () => {
  it('sends a replayed create with 200 and Idempotent-Replay: true', async () => {
    const res = fakeRes();
    const next: CallHandler = { handle: () => of(replayed({ id: 'o-1' })) };
    const body = await lastValueFrom(new IdempotencyInterceptor().intercept(httpCtx({}, res), next));
    expect(body).toEqual({ id: 'o-1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Idempotent-Replay']).toBe('true');
  });

  it('sends a repeated finished action with 200 and X-Already-Applied: true', async () => {
    const res = fakeRes();
    const next: CallHandler = { handle: () => of(alreadyApplied({ id: 'o-1', status: 'DELIVERED' })) };
    await lastValueFrom(new IdempotencyInterceptor().intercept(httpCtx({}, res), next));
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Already-Applied']).toBe('true');
  });

  it('leaves ordinary results alone', async () => {
    const res = fakeRes();
    const body = await lastValueFrom(new IdempotencyInterceptor().intercept(httpCtx({}, res), { handle: () => of([1]) }));
    expect(body).toEqual([1]);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers IDEMPOTENCY_CONFLICT when the same key comes with different details', () => {
    const stored = { clientId: 'c-1', deliveryFeePaisa: BigInt(33000), note: null };
    expect(() =>
      assertSameRequest(stored, { clientId: 'c-1', deliveryFeePaisa: '33000', note: undefined }, ['clientId', 'deliveryFeePaisa', 'note']),
    ).not.toThrow();
    let code: string | undefined;
    try {
      assertSameRequest(stored, { clientId: 'c-2', deliveryFeePaisa: '33000' }, ['clientId', 'deliveryFeePaisa']);
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('reads the Idempotency-Key header: optional, a UUID, lower-cased', () => {
    const factory = paramFactory(IdempotencyKey);
    const ctx = (headers: Record<string, string>) => httpCtx({ headers }, fakeRes());
    expect(factory(undefined, ctx({}))).toBeUndefined();
    expect(factory(undefined, ctx({ 'idempotency-key': '5B0C1C39-8F3E-4D5F-9C43-2F6C7D8E9A10' }))).toBe(
      '5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10',
    );
    expect(() => factory(undefined, ctx({ 'idempotency-key': 'retry-1' }))).toThrow(AppError);
  });
});

describe('cursor pages (API_CONTRACT §1.3)', () => {
  it('round-trips an opaque cursor and refuses a tampered one', () => {
    const cursor = encodeCursor(['2026-10-21T10:00:00.000Z', 'a-1']);
    expect(cursor).not.toContain('2026');
    expect(decodeCursor(cursor, 2)).toEqual(['2026-10-21T10:00:00.000Z', 'a-1']);
    expect(decodeCursor(undefined, 2)).toBeNull();
    expect(() => decodeCursor('not-a-cursor', 2)).toThrow(AppError);
    expect(() => decodeCursor(encodeCursor(['only-one']), 2)).toThrow(AppError);
  });

  it('pages with limit + 1 rows', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = toPage(rows, 2, (row) => [row.id]);
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(decodeCursor(page.nextCursor, 1)).toEqual(['b']);
    expect(toPage(rows, 3, (row) => [row.id]).nextCursor).toBeNull();
    expect(pageLimit(undefined)).toBe(30);
    expect(pageLimit(500)).toBe(100);
    expect(pageLimit('0')).toBe(1);
  });
});

describe('RequestContext middleware', () => {
  it('keeps a valid X-Request-Id, echoes it and exposes the request facts downstream', () => {
    const res = fakeRes();
    const req = {
      headers: {
        'x-request-id': '5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10',
        'x-app-variant': 'Driver',
        'x-app-version': '0.2.1',
        'user-agent': 'okhttp/4.9.2',
      },
      ip: '203.0.113.7',
      originalUrl: '/api/v1/Orders?tab=active&limit=30',
      query: { tab: 'active', limit: '30' },
    };
    let seen: ReturnType<typeof RequestContext.current>;
    new RequestContextMiddleware().use(req as never, res as never, () => {
      seen = RequestContext.current();
    });
    expect(seen!).toEqual({
      requestId: '5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10',
      ip: '203.0.113.7',
      userAgent: 'okhttp/4.9.2',
      appVariant: 'driver',
      appVersion: '0.2.1',
      // The list its cursors belong to (API_CONTRACT §1.3): the path and the tab.
      listKey: '/api/v1/orders?tab=active',
    });
    expect(res.headers['X-Request-Id']).toBe('5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10');
    expect(RequestContext.current()).toBeUndefined();
  });

  it('makes a request id when the client sends none or an unsafe one', () => {
    const res = fakeRes();
    let id: string | undefined;
    new RequestContextMiddleware().use({ headers: { 'x-request-id': 'x\n injected' } } as never, res as never, () => {
      id = RequestContext.requestId();
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['X-Request-Id']).toBe(id);
  });
});

describe('actors and CORS', () => {
  it('builds a USER actor from the token context', () => {
    expect(userActor({ userId: 'u-1', role: 'DISTRIBUTOR', distributorId: 'd-1' })).toEqual({
      kind: 'USER',
      userId: 'u-1',
      role: 'DISTRIBUTOR',
      distributorId: 'd-1',
    });
  });

  it('allows the configured origins and exposes the contract headers', () => {
    expect(parseCorsOrigins(' https://office.smartfleet.pk/ ,https://staging.smartfleet.pk ')).toEqual([
      'https://office.smartfleet.pk',
      'https://staging.smartfleet.pk',
    ]);
    expect(corsOptions(['https://office.smartfleet.pk'])).toEqual({
      origin: ['https://office.smartfleet.pk'],
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replay', 'X-Already-Applied', 'X-Feature-Disabled'],
    });
    expect(corsOptions([]).origin).toBe('*');
  });
});
