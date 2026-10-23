import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { headerValue, REQUEST_HEADER, RESPONSE_HEADER } from '../http/headers';
import {
  clampUserAgent,
  listKeyOf,
  normalizeRequestId,
  parseAppVariant,
  parseAppVersion,
  RequestContext,
  type RequestContextData,
} from './request-context';

/** The request id is also kept on the request, for code that runs outside the async context. */
export type RequestWithId = Request & { requestId?: string };

/**
 * Opens the AsyncLocalStorage request context: the request id (the client's `X-Request-Id` or a new
 * UUID, always echoed back), the IP (`trust proxy` is set in configureApp), the user agent, the app
 * variant and version headers, and the list the request reads (for its cursors). Registered for every
 * route in AppModule, after the body parsers, so the context survives into guards, pipes, handlers
 * and the exception filter.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const requestId = normalizeRequestId(headerValue(req.headers[REQUEST_HEADER.requestId]));
    req.requestId = requestId;
    res.setHeader(RESPONSE_HEADER.requestId, requestId);
    const context: RequestContextData = {
      requestId,
      ip: req.ip,
      userAgent: clampUserAgent(headerValue(req.headers[REQUEST_HEADER.userAgent])),
      appVariant: parseAppVariant(headerValue(req.headers[REQUEST_HEADER.appVariant])),
      appVersion: parseAppVersion(headerValue(req.headers[REQUEST_HEADER.appVersion])),
      listKey: listKeyOf(req.originalUrl ?? req.url, (req.query as Record<string, unknown> | undefined)?.tab),
    };
    RequestContext.run(context, () => next());
  }
}
