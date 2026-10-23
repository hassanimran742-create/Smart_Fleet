/**
 * Regression tests for review finding robustness-ops-15: the redacting pino logger is Nest's logger (so
 * LOG_LEVEL and Better Stack apply), every line inside a request carries its requestId, and the
 * request log names the route pattern, never a query string, a body or a confirmation token.
 */
import { Writable } from 'stream';
import pino from 'pino';
import { RequestContext } from '../../src/common/context/request-context';
import { logLevelOf, PinoLoggerService } from '../../src/common/logging/logger';
import { requestLine, routeOf } from '../../src/common/logging/request-log.middleware';

function capture(): { logger: PinoLoggerService; lines: () => Array<Record<string, unknown>> } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const logger = new PinoLoggerService(pino({ level: 'debug', redact: { paths: ['*.password'], censor: '[REDACTED]' } }, stream));
  return { logger, lines: () => chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('REV robustness-ops-15 logging', () => {
  it('REV robustness-ops-15 Nest log calls become JSON lines with their context, level and the request id', () => {
    const { logger, lines } = capture();
    logger.log('Smart_Fleet API listening on :3000', 'Bootstrap');
    RequestContext.run({ requestId: 'req-1234-abcd' }, () => {
      logger.warn('auto-dispatch could not be queued', 'OrdersService');
      logger.error('INTERNAL_ERROR 500 POST /api/v1/orders', 'Error: boom\n    at handler (orders.service.ts:10:5)', 'ExceptionFilter');
    });
    logger.debug('a 4xx answer', 'ExceptionFilter');
    expect(lines().map(({ level, msg, context, requestId, stack }) => ({ level, msg, context, requestId, hasStack: typeof stack === 'string' }))).toEqual([
      { level: 30, msg: 'Smart_Fleet API listening on :3000', context: 'Bootstrap', requestId: undefined, hasStack: false },
      { level: 40, msg: 'auto-dispatch could not be queued', context: 'OrdersService', requestId: 'req-1234-abcd', hasStack: false },
      { level: 50, msg: 'INTERNAL_ERROR 500 POST /api/v1/orders', context: 'ExceptionFilter', requestId: 'req-1234-abcd', hasStack: true },
      { level: 20, msg: 'a 4xx answer', context: 'ExceptionFilter', requestId: undefined, hasStack: false },
    ]);
  });

  it('REV robustness-ops-15 LOG_LEVEL decides the level; an unknown value falls back', () => {
    expect(logLevelOf({ NODE_ENV: 'production', LOG_LEVEL: 'warn' })).toBe('warn');
    expect(logLevelOf({ NODE_ENV: 'production', LOG_LEVEL: 'loud' })).toBe('info');
    expect(logLevelOf({ NODE_ENV: 'staging' })).toBe('info');
    expect(logLevelOf({})).toBe('debug');
  });

  it('REV robustness-ops-15 the request line has the route pattern, status, time, request id and user, never the query', () => {
    const matched = {
      method: 'GET',
      route: { path: '/api/v1/orders/:id' },
      baseUrl: '',
      originalUrl: '/api/v1/orders/0f8fad5b-d9cb-469f-a165-70867728950e?phone=03001234567',
      url: '/api/v1/orders/0f8fad5b-d9cb-469f-a165-70867728950e?phone=03001234567',
      requestId: 'req-1',
      user: { userId: 'u-1' },
    };
    expect(requestLine(matched as never, 200, 12.4, true)).toBe('GET /api/v1/orders/:id 200 12ms requestId=req-1 userId=u-1');
    const unmatched = { method: 'GET', originalUrl: '/api/v1/c/k3jSecretToken?answer=yes', url: '/api/v1/c/k3jSecretToken?answer=yes', requestId: 'req-2' };
    expect(routeOf(unmatched as never)).toBe('/api/v1/c/[token]');
    expect(requestLine(unmatched as never, 404, 3, false)).toBe('GET /api/v1/c/[token] 404 3ms (client went away) requestId=req-2');
  });
});
