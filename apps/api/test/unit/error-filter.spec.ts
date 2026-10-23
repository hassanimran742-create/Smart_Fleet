import { BadRequestException, HttpException, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import { IsNotEmpty } from 'class-validator';
import { z } from 'zod';
import { RequestContext } from '../../src/common/context/request-context';
import { AppError } from '../../src/common/errors/app-error';
import { toApiError } from '../../src/common/errors/error-mapping';
import { isUniqueViolation } from '../../src/common/errors/prisma-errors';
import { buildErrorEnvelope, GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { createValidationPipe } from '../../src/common/pipes/validation.pipe';

const CLIENT_VERSION = '5.22.0';

function knownError(code: string, meta: Record<string, unknown>, message = 'prisma said something internal'): unknown {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: CLIENT_VERSION, meta });
}

interface FakeResponse {
  headersSent: boolean;
  statusCode?: number;
  body?: Record<string, any>;
  headers: Record<string, string>;
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
  end: jest.Mock;
}

function fakeResponse(): FakeResponse {
  const res = { headersSent: false, headers: {} } as FakeResponse;
  res.setHeader = jest.fn((name: string, value: string) => {
    res.headers[name] = value;
  });
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: Record<string, any>) => {
    res.body = body;
    return res;
  });
  res.end = jest.fn();
  return res;
}

function httpHost(req: Record<string, unknown>, res: FakeResponse): ArgumentsHost {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => undefined }),
  } as unknown as ArgumentsHost;
}

function render(exception: unknown, req: Record<string, unknown> = { url: '/api/v1/orders', originalUrl: '/api/v1/orders', headers: {} }) {
  const res = fakeResponse();
  new GlobalExceptionFilter().catch(exception, httpHost(req, res));
  return res;
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('GlobalExceptionFilter (API_CONTRACT §2.1)', () => {
  it('renders a thrown AppError as the envelope with code, message, details and requestId', () => {
    const res = RequestContext.run({ requestId: 'req-1234-abcd' }, () =>
      render(
        new AppError('WALLET_INSUFFICIENT_BALANCE', {
          requiredPaisa: '33000',
          balancePaisa: '12000',
          shortByPaisa: '21000',
        }),
      ),
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      statusCode: 409,
      code: 'WALLET_INSUFFICIENT_BALANCE',
      message: 'Not enough balance. This needs Rs 330 and you have Rs 120. Add money to continue.',
      details: { requiredPaisa: '33000', balancePaisa: '12000', shortByPaisa: '21000' },
      error: 'WALLET_INSUFFICIENT_BALANCE',
      requestId: 'req-1234-abcd',
      path: '/api/v1/orders',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(res.headers['X-Request-Id']).toBe('req-1234-abcd');
  });

  it('renders a plain Error as 500 INTERNAL_ERROR without its raw message', () => {
    const res = render(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(res.statusCode).toBe(500);
    expect(res.body?.code).toBe('INTERNAL_ERROR');
    expect(res.body?.message).toBe(ERROR_MESSAGE_EN.INTERNAL_ERROR);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|hunter2/);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('never echoes framework or legacy HttpException text', () => {
    const notFound = render(new NotFoundException('Order 9f2c… not found in table orders'));
    expect(notFound.statusCode).toBe(404);
    expect(notFound.body?.code).toBe('NOT_FOUND');
    expect(notFound.body?.message).toBe(ERROR_MESSAGE_EN.NOT_FOUND);

    const bad = render(new BadRequestException(['phone must be a string', 'password should not be empty']));
    expect(bad.statusCode).toBe(400);
    expect(bad.body?.code).toBe('VALIDATION_FAILED');
    expect(bad.body?.details).toEqual({ fields: [] });
    expect(JSON.stringify(bad.body)).not.toMatch(/must be a string/);
  });

  it('keeps a catalogue code thrown inside an HttpException body', () => {
    const res = render(new HttpException({ code: 'FEATURE_DISABLED', details: {} }, 403));
    expect(res.body?.code).toBe('FEATURE_DISABLED');
  });

  it('turns zod errors into VALIDATION_FAILED with details.fields', () => {
    const schema = z.object({ name: z.string().min(3) });
    const parsed = schema.safeParse({ name: 'ab' });
    if (parsed.success) throw new Error('expected a failure');
    const res = render(parsed.error);
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_FAILED');
    expect(res.body?.details.fields).toEqual([
      { path: 'name', code: 'TOO_SHORT', message: 'Use at least 3 characters.', params: { min: 3 } },
    ]);
  });

  it('serialises BigInt details as digit strings and strips secrets from them', () => {
    const envelope = buildErrorEnvelope(
      {
        code: 'WALLET_ADJUST_EXCEEDS_BALANCE',
        details: { balancePaisa: BigInt(4500), user: { name: 'Ali', passwordHash: 'x', cnic: '35202-1234567-1' } },
      },
      'rid-00000001',
      '/api/v1/admin/distributors/1/wallet/corrections',
    );
    expect(envelope.details).toEqual({ balancePaisa: '4500', user: { name: 'Ali' } });
    expect(envelope.message).toBe("The balance is only Rs 45. You can't take more than that.");
  });

  it('redacts confirmation tokens and drops the query string from path', () => {
    const res = render(new AppError('CONFIRM_LINK_INVALID'), {
      url: '/c/k3jx9q2mz8?l=en',
      originalUrl: '/c/k3jx9q2mz8?l=en',
      headers: {},
    });
    expect(res.body?.path).toBe('/c/[token]');
    expect(
      buildErrorEnvelope({ code: 'NOT_FOUND', details: {} }, 'rid-00000001', '/api/v1/orders?token=abc').path,
    ).toBe('/api/v1/orders');
  });

  it("uses the client's X-Request-Id outside a request context, or makes one", () => {
    const echoed = render(new AppError('NOT_FOUND'), {
      url: '/x',
      originalUrl: '/x',
      headers: { 'x-request-id': '5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10' },
    });
    expect(echoed.body?.requestId).toBe('5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10');
    const generated = render(new AppError('NOT_FOUND'), { url: '/x', originalUrl: '/x', headers: { 'x-request-id': 'bad id!' } });
    expect(generated.body?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.headers['X-Request-Id']).toBe(generated.body?.requestId);
  });

  it('ends a response whose headers were already sent instead of writing twice', () => {
    const res = fakeResponse();
    res.headersSent = true;
    new GlobalExceptionFilter().catch(new Error('stream broke'), httpHost({ url: '/x', headers: {} }, res));
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('sends socket clients the code and English only', () => {
    const emit = jest.fn();
    const host = {
      getType: () => 'ws',
      switchToWs: () => ({ getClient: () => ({ emit }) }),
    } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(new AppError('AUTH_TOKEN_INVALID'), host);
    expect(emit).toHaveBeenCalledWith('exception', { code: 'AUTH_TOKEN_INVALID', message: 'Please sign in again.' });
  });
});

describe('toApiError: Prisma and database constraints (DATA_MODEL §7)', () => {
  it('maps P2002 on payments_bank_reference_key_key to TOPUP_BANK_REFERENCE_USED', () => {
    const mapped = toApiError(knownError('P2002', { modelName: 'Payment', target: ['bank_reference_key'] }));
    expect(mapped).toMatchObject({ status: 409, code: 'TOPUP_BANK_REFERENCE_USED', log: 'warn' });
    const res = render(knownError('P2002', { modelName: 'Payment', target: ['bank_reference_key'] }));
    expect(res.body?.message).not.toMatch(/\{\{/);
  });

  it.each([
    [{ modelName: 'User', target: ['phone'] }, 'USER_PHONE_IN_USE'],
    [{ modelName: 'Distributor', target: ['code'] }, 'DISTRIBUTOR_CODE_IN_USE'],
    [{ modelName: 'Distributor', target: ['home_store_id'] }, 'STORE_IN_USE'],
    [{ modelName: 'ExpenseType', target: ['name_key'] }, 'EXPENSE_TYPE_NAME_TAKEN'],
    [{ modelName: 'DistributorZonePrice', target: ['distributor_id', 'zone_id'] }, 'CONFLICT_STALE_STATE'],
    [{ modelName: 'Order', target: ['distributor_id', 'client_request_id'] }, 'CONFLICT_DUPLICATE'],
    [{ modelName: 'AppSetting', target: ['key', 'scope'] }, 'CONFLICT_DUPLICATE'],
  ])('maps P2002 %j to %s', (meta, code) => {
    expect(toApiError(knownError('P2002', meta)).code).toBe(code);
  });

  it('maps P2025 and malformed ids (P2023) to NOT_FOUND', () => {
    expect(toApiError(knownError('P2025', { modelName: 'User', cause: 'Record to update not found.' }))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(toApiError(knownError('P2023', { modelName: 'User', message: 'Error creating UUID' })).code).toBe('NOT_FOUND');
  });

  it('maps the raw-SQL CHECK distributors_balance_chk (23514) to WALLET_INSUFFICIENT_BALANCE', () => {
    const error = knownError('P2010', {
      code: '23514',
      message:
        'ERROR: new row for relation "distributors" violates check constraint "distributors_balance_chk"\nDETAIL: Failing row contains (…).',
    });
    expect(toApiError(error)).toMatchObject({ status: 409, code: 'WALLET_INSUFFICIENT_BALANCE' });
  });

  it('maps a model-API CHECK failure reported as an unknown error', () => {
    const error = new Prisma.PrismaClientUnknownRequestError(
      'Error occurred during query execution: ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \\"distributors\\" violates check constraint \\"distributors_code_chk\\"", severity: "ERROR" }) })',
      { clientVersion: CLIENT_VERSION },
    );
    expect(toApiError(error)).toMatchObject({ status: 400, code: 'DISTRIBUTOR_CODE_INVALID' });
  });

  it('reads raw unique violations by their key columns', () => {
    const error = knownError('P2010', {
      code: '23505',
      message: 'Key (distributor_id, client_request_id)=(3f1…, 9c2…) already exists.',
    });
    expect(toApiError(error).code).toBe('CONFLICT_DUPLICATE');
    expect(isUniqueViolation(error, 'orders_distributor_id_client_request_id_key')).toBe(true);
    expect(isUniqueViolation(error, 'payments_bank_reference_key_key')).toBe(false);
    expect(
      isUniqueViolation(knownError('P2002', { modelName: 'Order', target: ['distributor_id', 'client_request_id'] }), 'orders_distributor_id_client_request_id_key'),
    ).toBe(true);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
  });

  it('keeps row values out of the log note', () => {
    const mapped = toApiError(knownError('P2010', { code: '23505', message: 'Key (phone)=(+923001234567) already exists.' }));
    expect(mapped.code).toBe('USER_PHONE_IN_USE');
    expect(mapped.note).toBe('unique users_phone_key');
  });

  it('treats unreachable databases and write conflicts as retryable states', () => {
    expect(toApiError(knownError('P1001', {})).code).toBe('SERVICE_UNAVAILABLE');
    expect(toApiError(knownError('P2034', {})).code).toBe('CONFLICT_STALE_STATE');
    expect(toApiError(knownError('P2010', { code: '40P01', message: 'deadlock detected' })).code).toBe(
      'CONFLICT_STALE_STATE',
    );
  });
});

describe('FND-007 The global error filter maps library and database errors to the documented codes', () => {
  const RAW = 'connect ECONNREFUSED 10.0.0.5:5432 user=smartfleet password=secret';

  function envelopeOf(exception: unknown): { status: number | undefined; body: Record<string, any> } {
    const res = render(exception);
    return { status: res.statusCode, body: res.body ?? {} };
  }

  class NamedDto {
    @IsNotEmpty()
    name!: string;
  }

  it('FND-007 zod and class-validator errors are 400 VALIDATION_FAILED with details.fields [{ path, code, message }]', async () => {
    const schema = z.object({ lines: z.array(z.object({ fullCount: z.number().int().min(1) })) });
    const zodError = schema.safeParse({ lines: [{ fullCount: 0 }] });
    if (zodError.success) throw new Error('expected a zod error');
    const zod = envelopeOf(zodError.error);
    expect(zod.status).toBe(400);
    expect(zod.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED', error: 'VALIDATION_FAILED', message: 'Some details need fixing.' });
    expect(zod.body.details.fields).toEqual([expect.objectContaining({ path: 'lines.0.fullCount', code: expect.any(String), message: expect.any(String) })]);

    const classValidator = await createValidationPipe()
      .transform({ name: '' }, { type: 'body', metatype: NamedDto })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const cv = envelopeOf(classValidator);
    expect(cv.status).toBe(400);
    expect(cv.body.code).toBe('VALIDATION_FAILED');
    expect(cv.body.details.fields).toEqual([expect.objectContaining({ path: 'name', code: expect.any(String), message: expect.any(String) })]);
  });

  it('FND-007 P2025 is 404 NOT_FOUND', () => {
    expect(envelopeOf(knownError('P2025', { modelName: 'Order', cause: 'Record to update not found.' }))).toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND' },
    });
  });

  it.each<[string, Record<string, unknown>, number, string]>([
    ['payments_bank_reference_key_key', { modelName: 'Payment', target: ['bank_reference_key'] }, 409, 'TOPUP_BANK_REFERENCE_USED'],
    ['distributors_home_store_id_key', { modelName: 'Distributor', target: ['home_store_id'] }, 409, 'STORE_IN_USE'],
    ['distributors_code_key', { modelName: 'Distributor', target: ['code'] }, 409, 'DISTRIBUTOR_CODE_IN_USE'],
    ['expense_types_name_key_key', { modelName: 'ExpenseType', target: ['name_key'] }, 409, 'EXPENSE_TYPE_NAME_TAKEN'],
    ['clients_distributor_id_phone_key', { modelName: 'Client', target: ['distributor_id', 'phone'] }, 409, 'CLIENT_PHONE_EXISTS'],
    ['users_phone_key', { modelName: 'User', target: ['phone'] }, 409, 'USER_PHONE_IN_USE'],
    ['an unlisted constraint', { modelName: 'Vehicle', target: ['plate_no'] }, 409, 'CONFLICT_DUPLICATE'],
  ])('FND-007 P2002 on %s answers %i %s, with no {{params}} left', (_name, meta, status, code) => {
    const { status: got, body } = envelopeOf(knownError('P2002', meta));
    expect({ status: got, code: body.code }).toEqual({ status, code });
    expect(body.message).not.toMatch(/\{\{|prisma said/);
  });

  it('FND-007 CHECK 23514: distributors_balance_chk is 409 WALLET_INSUFFICIENT_BALANCE, distributors_code_chk 400 DISTRIBUTOR_CODE_INVALID', () => {
    const check = (constraint: string) =>
      knownError('P2010', {
        code: '23514',
        message: `ERROR: new row for relation "distributors" violates check constraint "${constraint}"`,
      });
    expect(envelopeOf(check('distributors_balance_chk'))).toMatchObject({ status: 409, body: { code: 'WALLET_INSUFFICIENT_BALANCE' } });
    expect(envelopeOf(check('distributors_code_chk'))).toMatchObject({ status: 400, body: { code: 'DISTRIBUTOR_CODE_INVALID' } });
  });

  it('FND-007 idempotency-key violations reach the service as "already exists"; the filter only keeps a safety net', () => {
    const order = knownError('P2002', { modelName: 'Order', target: ['distributor_id', 'client_request_id'] });
    const ledger = knownError('P2002', { modelName: 'LedgerEntry', target: ['idempotency_key'] });
    expect(isUniqueViolation(order, 'orders_distributor_id_client_request_id_key')).toBe(true);
    expect(isUniqueViolation(ledger, 'ledger_entries_idempotency_key_key')).toBe(true);
    // The services catch them and return the first record or result; one that slips through is a plain 409.
    expect(toApiError(order).code).toBe('CONFLICT_DUPLICATE');
    expect(toApiError(ledger).code).toBe('CONFLICT_DUPLICATE');
    for (const [model, name] of [
      ['Client', 'clients_distributor_id_client_request_id_key'],
      ['Distributor', 'distributors_client_request_id_key'],
    ] as const) {
      const target = model === 'Client' ? ['distributor_id', 'client_request_id'] : ['client_request_id'];
      const error = knownError('P2002', { modelName: model, target });
      expect(isUniqueViolation(error, name)).toBe(true);
      expect(toApiError(error).code).toBe('CONFLICT_DUPLICATE');
    }
  });

  it('FND-007 a plain Error is 500 INTERNAL_ERROR; an AppError keeps its code, status, details and English', () => {
    const plain = envelopeOf(new Error(RAW));
    expect(plain).toMatchObject({ status: 500, body: { code: 'INTERNAL_ERROR', message: ERROR_MESSAGE_EN.INTERNAL_ERROR } });
    expect(JSON.stringify(plain.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|password|secret/);
    const zoneId = '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b';
    const priced = envelopeOf(new AppError('PRICING_PRICE_NOT_SET', { zoneId, zoneName: 'East' }));
    expect(priced).toMatchObject({
      status: 422,
      body: {
        code: 'PRICING_PRICE_NOT_SET',
        message: 'No delivery price is set for East yet. Ask the office to set it.',
        details: { zoneId, zoneName: 'East' },
      },
    });
  });

  it('FND-007 P1001 and P2024 are 503 SERVICE_UNAVAILABLE, P2034 409 CONFLICT_STALE_STATE, P2023 404 NOT_FOUND, never with raw text', () => {
    const cases: [string, number, string][] = [
      ['P1001', 503, 'SERVICE_UNAVAILABLE'],
      ['P2024', 503, 'SERVICE_UNAVAILABLE'],
      ['P2034', 409, 'CONFLICT_STALE_STATE'],
      ['P2023', 404, 'NOT_FOUND'],
    ];
    for (const [prismaCode, status, code] of cases) {
      const { status: got, body } = envelopeOf(knownError(prismaCode, {}, RAW));
      expect({ prismaCode, status: got, code: body.code }).toEqual({ prismaCode, status, code });
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|password|secret/);
    }
  });
});
