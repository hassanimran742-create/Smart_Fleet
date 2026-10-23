/**
 * Regression tests for review findings robustness-ops-06 and robustness-ops-07 (API_CONTRACT §2.2: bad
 * input is a 4xx; only "anything else" is 500 INTERNAL_ERROR, logged as a fault and sent to Sentry).
 * - 06: text with a NUL character and instants outside the years 1–9999 are refused by the shared
 *   schemas; whatever still reaches the database as a data exception (SQLSTATE class 22, or Prisma's
 *   "Could not convert argument value") maps to 400 VALIDATION_FAILED at warn level, not a 500.
 * - 07: the body parser's refusals (aborted, too large, unknown charset or encoding) map to 400
 *   VALIDATION_FAILED at debug level, never a fault.
 */
import { Prisma } from '@prisma/client';
import { isoDateTimeSchema, optionalTextSchema, parseRequest, textSchema } from '@smartfleet/shared-validation';
import { z } from 'zod';
import { toApiError } from '../../src/common/errors/error-mapping';

// http-errors is what body-parser builds its refusals with (a dependency of @nestjs/platform-express).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createError = require('http-errors') as (status: number, message: string, props?: Record<string, unknown>) => Error;

const CLIENT_VERSION = '5.22.0';
const raw = (sqlState: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${sqlState}\`. Message: \`${message}\``, {
    code: 'P2010',
    clientVersion: CLIENT_VERSION,
    meta: { code: sqlState, message: `ERROR: ${message}` },
  });
const engine = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: CLIENT_VERSION });
const outcome = (error: unknown) => {
  const mapped = toApiError(error);
  return { status: mapped.status, code: mapped.code, log: mapped.log };
};

describe('REV robustness-ops-06 values Postgres cannot store', () => {
  it('REV robustness-ops-06 the shared text schemas refuse a NUL character with INVALID_VALUE', () => {
    const body = z.object({ name: textSchema(1, 80), note: optionalTextSchema(200) });
    expect(parseRequest(body, { name: 'Sana\u0000', note: 'Gate\u00002' })).toEqual({
      success: false,
      errorCode: 'VALIDATION_FAILED',
      fields: [
        { path: 'name', code: 'INVALID_VALUE' },
        { path: 'note', code: 'INVALID_VALUE' },
      ],
    });
    expect(parseRequest(body, { name: '  Sana  ', note: '' })).toEqual({ success: true, data: { name: 'Sana', note: undefined } });
  });

  it('REV robustness-ops-06 an instant must be in the years 1 to 9999', () => {
    const codeOf = (value: string) => {
      const result = parseRequest(isoDateTimeSchema, value);
      return result.success ? 'ok' : result.fields.map((field) => field.code);
    };
    expect(codeOf('0000-01-01T00:00:00Z')).toEqual(['INVALID_DATETIME']);
    expect(codeOf('0001-01-01T00:00:00+05:00')).toEqual(['INVALID_DATETIME']); // year 0 in UTC
    expect(codeOf('9999-12-31T23:59:59-05:00')).toEqual(['INVALID_DATETIME']); // year 10000 in UTC
    expect(codeOf('2026-10-21T16:12:00+05:00')).toBe('ok');
    expect(codeOf('0001-01-01T00:00:00Z')).toBe('ok');
  });

  it('REV robustness-ops-06 a data exception that still reaches the database is a 400 at warn level', () => {
    expect(outcome(raw('22021', 'invalid byte sequence for encoding "UTF8": 0x00'))).toEqual({ status: 400, code: 'VALIDATION_FAILED', log: 'warn' });
    expect(outcome(raw('22008', 'date/time field value out of range: "0000-01-01T00:00:00Z"'))).toEqual({ status: 400, code: 'VALIDATION_FAILED', log: 'warn' });
    expect(outcome(raw('22003', 'numeric field overflow'))).toEqual({ status: 400, code: 'VALIDATION_FAILED', log: 'warn' });
    expect(
      outcome(
        engine(
          'Error occurred during query execution: ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "22021", message: "invalid byte sequence for encoding \\"UTF8\\": 0x00", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })',
        ),
      ),
    ).toEqual({ status: 400, code: 'VALIDATION_FAILED', log: 'warn' });
    expect(
      outcome(engine('Could not convert argument value Object {"$type": String("DateTime"), "value": String("-271821-04-20T00:00:00.000Z")} to ArgumentValue.')),
    ).toEqual({ status: 400, code: 'VALIDATION_FAILED', log: 'warn' });
    expect(outcome(new Prisma.PrismaClientKnownRequestError('The provided value for the column is too long', { code: 'P2000', clientVersion: CLIENT_VERSION }))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      log: 'warn',
    });
    // Unchanged: a malformed id is 404, a deadlock 409, anything else a fault.
    expect(outcome(raw('22P02', 'invalid input syntax for type uuid: "x"'))).toEqual({ status: 404, code: 'NOT_FOUND', log: 'debug' });
    expect(outcome(raw('40P01', 'deadlock detected'))).toMatchObject({ status: 409, code: 'CONFLICT_STALE_STATE' });
    expect(outcome(raw('42P01', 'relation "nope" does not exist'))).toEqual({ status: 500, code: 'INTERNAL_ERROR', log: 'error' });
  });
});

describe('REV robustness-ops-07 bodies the body parser refuses', () => {
  it('REV robustness-ops-07 aborted, too large, unknown charset or encoding: 400 at debug level, never a fault', () => {
    const refused = { status: 400, code: 'VALIDATION_FAILED', log: 'debug' };
    expect({
      aborted: outcome(createError(400, 'request aborted', { type: 'request.aborted' })),
      tooLarge: outcome(createError(413, 'request entity too large', { type: 'entity.too.large' })),
      charset: outcome(createError(415, 'unsupported charset "FOO"', { type: 'charset.unsupported' })),
      encoding: outcome(createError(415, 'unsupported content encoding "br"', { type: 'encoding.unsupported' })),
      gzip: outcome(createError(400, new Error('incorrect header check') as unknown as string)),
    }).toEqual({ aborted: refused, tooLarge: refused, charset: refused, encoding: refused, gzip: refused });
    // A server-side failure is still a fault, even when it carries a status.
    expect(outcome(createError(500, 'boom'))).toEqual({ status: 500, code: 'INTERNAL_ERROR', log: 'error' });
    expect(outcome(Object.assign(new Error('not from the parser'), { status: 400 }))).toEqual({ status: 500, code: 'INTERNAL_ERROR', log: 'error' });
  });
});
