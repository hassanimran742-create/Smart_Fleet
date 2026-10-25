import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_HTTP, type AnyErrorEnvelope, type ErrorEnvelope } from '@smartfleet/shared-types';
import { normalizeRequestId, RequestContext } from '../context/request-context';
import type { RequestWithId } from '../context/request-context.middleware';
import { toApiError, type MappedError } from '../errors/error-mapping';
import { errorMessage } from '../errors/messages';
import { headerValue, REQUEST_HEADER, RESPONSE_HEADER } from '../http/headers';
import { envelopePath } from '../http/redact';
import { isPublicPagePath, sendPublicPageError } from '../../modules/confirmation/public/public-page.filter';
import { toJsonSafeObject } from '../security/json-safe';
import { captureException } from '../sentry/sentry';

/**
 * Builds the API_CONTRACT §2.1 error body: `{ statusCode, code, message, details, error, requestId,
 * path, timestamp }`. `message` is the catalogue English filled from `details`; `error` repeats the
 * code for old clients; `path` has no query string and `/c/<token>` redacted.
 */
export function buildErrorEnvelope(
  error: Pick<MappedError, 'code' | 'details'>,
  requestId: string,
  originalUrl: string | undefined,
  now: Date = new Date(),
): AnyErrorEnvelope {
  const details = toJsonSafeObject(error.details);
  const envelope: ErrorEnvelope = {
    statusCode: ERROR_HTTP[error.code],
    code: error.code,
    message: errorMessage(error.code, details),
    details: details as ErrorEnvelope['details'],
    error: error.code,
    requestId,
    path: envelopePath(originalUrl),
    timestamp: now.toISOString(),
  };
  return envelope as AnyErrorEnvelope;
}

/**
 * The global exception filter (replaces the old one, which returned raw `Error.message`). Every
 * failure becomes the §2.1 envelope with a stable code (see `toApiError`); server faults are logged
 * with their stack and the request id and sent to Sentry, never to the client.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const mapped = toApiError(exception);

    if (host.getType() !== 'http') {
      this.logFault(mapped, exception, undefined, undefined);
      if (host.getType() === 'ws') {
        // Socket clients get the code and English only (API_CONTRACT §7.14 sends `error {code}`).
        const client = host.switchToWs().getClient<{ emit?: (event: string, body: unknown) => void }>();
        client?.emit?.('exception', { code: mapped.code, message: errorMessage(mapped.code, mapped.details) });
      }
      return;
    }

    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();
    const requestId =
      RequestContext.requestId() ??
      req.requestId ??
      normalizeRequestId(headerValue(req.headers?.[REQUEST_HEADER.requestId]));
    const envelope = buildErrorEnvelope(mapped, requestId, req.originalUrl ?? req.url);

    this.logFault(mapped, exception, requestId, envelope.path, req.method);

    if (res.headersSent) {
      // A stream already started; all we can do is end it.
      res.end();
      return;
    }
    res.setHeader(RESPONSE_HEADER.requestId, requestId);
    // The customer's link page answers every error as a page, never JSON (CUSTOMER_PAGE §5), even one the
    // body parser or the URI decoder raised before the page's own filter could run. [review23 robustness-jobs-09]
    if (isPublicPagePath(req.originalUrl ?? req.url)) {
      sendPublicPageError(res, { code: mapped.code, status: envelope.statusCode });
      return;
    }
    res.status(envelope.statusCode).json(envelope);
  }

  private logFault(
    mapped: MappedError,
    exception: unknown,
    requestId: string | undefined,
    path: string | undefined,
    method?: string,
  ): void {
    const where = [method, path].filter(Boolean).join(' ');
    const line = `${mapped.code} ${mapped.status}${where ? ` ${where}` : ''}${requestId ? ` requestId=${requestId}` : ''}`;
    if (mapped.log === 'error') {
      const stack = exception instanceof Error ? exception.stack ?? exception.message : String(exception);
      this.logger.error(line, stack);
      captureException(exception, { requestId, path });
    } else if (mapped.log === 'warn') {
      // Only the constraint or Prisma code: row values (phone numbers, references) stay out of the logs.
      this.logger.warn(`${line}${mapped.note ? ` (${mapped.note})` : ''}`);
    } else {
      this.logger.debug(line);
    }
  }
}
