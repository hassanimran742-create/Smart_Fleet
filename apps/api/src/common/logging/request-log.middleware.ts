import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { RequestWithId } from '../context/request-context.middleware';
import { envelopePath } from '../http/redact';

type LoggedRequest = RequestWithId & { route?: { path?: unknown }; user?: { userId?: unknown } };

/**
 * The route a request matched, as its pattern (`/api/v1/orders/:id`), so no id, token or query value is
 * logged; an unmatched path without its query, with a confirmation token redacted (`/c/[token]`).
 */
export function routeOf(req: Pick<LoggedRequest, 'route' | 'baseUrl' | 'originalUrl' | 'url'>): string {
  const pattern = req.route?.path;
  if (typeof pattern === 'string' && pattern) return envelopePath(`${req.baseUrl ?? ''}${pattern}`);
  return envelopePath(req.originalUrl ?? req.url);
}

/** One request-log line: method, route, status, duration, request id and the signed-in user; never a body or query. */
export function requestLine(req: LoggedRequest, status: number, ms: number, finished: boolean): string {
  const userId = typeof req.user?.userId === 'string' ? ` userId=${req.user.userId}` : '';
  const requestId = req.requestId ? ` requestId=${req.requestId}` : '';
  return `${req.method} ${routeOf(req)} ${status} ${Math.round(ms)}ms${finished ? '' : ' (client went away)'}${requestId}${userId}`;
}

/**
 * Writes one line per request when its response ends (or its connection closes first), so every
 * request, a successful or a timed-out one included, can be found by the `Reference` (request id) the
 * apps show. Registered after RequestContextMiddleware, so the request id is set.
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    res.once('close', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      this.logger.log(requestLine(req as LoggedRequest, res.statusCode, ms, res.writableFinished));
    });
    next();
  }
}
