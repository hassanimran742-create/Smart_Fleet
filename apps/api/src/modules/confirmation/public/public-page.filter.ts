import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ErrorCode } from '@smartfleet/shared-types';
import type { Request, Response } from 'express';
import { appEnvironment } from '../../../config/configuration';
import { RequestContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { captureException } from '../../../common/sentry/sentry';
import {
  renderAlready,
  renderError,
  renderExpired,
  renderInactive,
  renderMain,
  renderNotFound,
  renderStep,
  renderTooMany,
} from '../page/pages';
import { pageContextOf, type PageContext } from './page-context';
import { sendPage } from './page-response';

/** The page and status each code of the public link draws (CUSTOMER_PAGE §5; API_CONTRACT §2.3). */
export function pageForError(code: ErrorCode | 'INTERNAL_ERROR', context: PageContext): { status: number; html: string; headers: Record<string, string> } {
  const { frame, link, token } = context;
  switch (code) {
    case 'CONFIRM_LINK_INVALID':
      return { status: 404, html: renderNotFound(context.supportPhone, frame), headers: {} };
    case 'CONFIRM_LINK_INACTIVE':
      return link ? { status: 410, html: renderInactive(link, frame), headers: {} } : { status: 410, html: renderNotFound(context.supportPhone, frame), headers: {} };
    case 'CONFIRM_LINK_EXPIRED':
      return link ? { status: 410, html: renderExpired(link, frame), headers: {} } : { status: 410, html: renderNotFound(context.supportPhone, frame), headers: {} };
    case 'CONFIRM_ALREADY_ANSWERED':
      return link ? { status: 409, html: renderAlready(link, frame), headers: {} } : { status: 409, html: renderNotFound(context.supportPhone, frame), headers: {} };
    case 'CONFIRM_NOTE_REQUIRED':
      if (link && token) {
        return { status: 400, html: renderStep('other', link, token, frame, { noteError: true, comment: context.form?.comment ?? null }), headers: {} };
      }
      break;
    case 'VALIDATION_FAILED':
      if (link && token) return { status: 400, html: renderMain(link, token, frame, { chooseError: true }), headers: {} };
      return { status: 404, html: renderNotFound(context.supportPhone, frame), headers: {} };
    case 'RATE_LIMITED': {
      const seconds = Math.max(1, context.retryAfterSeconds ?? 60);
      return { status: 429, html: renderTooMany(Math.ceil(seconds / 60), frame), headers: { 'Retry-After': String(seconds) } };
    }
    default:
      break;
  }
  return {
    status: 500,
    html: renderError(frame, { token, link, form: context.form, path: context.step ? `/${context.step}` : '' }),
    headers: {},
  };
}

/** True for a path the public link page serves: `/c` and `/c/…` (Express matches it in any letter case). */
export function isPublicPagePath(url: string | undefined): boolean {
  return /^\/c(?:\/|$)/i.test((url ?? '').split(/[?#]/)[0]);
}

/**
 * [review23 robustness-jobs-09] The page for an error that came before the page's own controller ran: the
 * body parser's refusals (broken JSON, an unknown charset, a body over the page's limit, too many fields)
 * and a path the URI decoder can't read. The global filter hands them here, so they too are a page with
 * the §4 headers, never JSON (CUSTOMER_PAGE §5). Nothing about the link is known yet, and nothing of the
 * request is echoed: throttling draws the too-many page, any other client error the not-found page, and a
 * server fault the error page.
 */
export function sendPublicPageError(res: Response, error: { code: ErrorCode; status: number }, retryAfterSeconds?: number): void {
  const context: PageContext = {
    ip: '',
    token: null,
    step: null,
    link: null,
    form: null,
    supportPhone: null,
    frame: { environment: appEnvironment() },
    retryAfterSeconds,
  };
  const drawn: ErrorCode = error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : error.status < 500 ? 'CONFIRM_LINK_INVALID' : 'INTERNAL_ERROR';
  const page = pageForError(drawn, context);
  sendPage(res, page.status, page.html, page.headers);
}

/**
 * The public link page's error filter (CUSTOMER_PAGE §5): every error, throttling included, becomes an
 * HTML page with the code's status, never JSON and never echoing the URL or the token:
 * CONFIRM_LINK_INVALID 404 not found; CONFIRM_LINK_INACTIVE 410 closed; CONFIRM_LINK_EXPIRED 410
 * expired; CONFIRM_ALREADY_ANSWERED 409 already answered; CONFIRM_NOTE_REQUIRED 400 the Other page with
 * its error; VALIDATION_FAILED 400 the main page with "Please tap one answer below."; RATE_LIMITED 429
 * too many tries (with `Retry-After`); anything else 500 "Something went wrong", logged with the
 * request id (the path redacted) and sent to Sentry.
 */
@Catch()
export class PublicPageExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PublicPage');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const context: PageContext = pageContextOf(req) ?? {
      ip: '',
      token: null,
      step: null,
      link: null,
      form: null,
      supportPhone: null,
      frame: { environment: appEnvironment() },
    };

    let code: ErrorCode | 'INTERNAL_ERROR' = 'INTERNAL_ERROR';
    if (exception instanceof AppError) code = exception.code;
    else if (exception instanceof HttpException && exception.getStatus() === 404) code = 'CONFIRM_LINK_INVALID';

    const page = pageForError(code, context);
    if (page.status === 500) {
      const requestId = RequestContext.requestId();
      const where = `${req?.method ?? ''} /c/[token]${context.step ? `/${context.step}` : ''}`;
      const stack = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      // The token never reaches a log: the path is written redacted, and the stack carries no request data.
      this.logger.error(`${where} 500${requestId ? ` requestId=${requestId}` : ''}`, context.token ? stack.split(context.token).join('[token]') : stack);
      captureException(exception, { requestId, path: '/c/[token]' });
    }
    sendPage(res, page.status, page.html, page.headers);
  }
}
