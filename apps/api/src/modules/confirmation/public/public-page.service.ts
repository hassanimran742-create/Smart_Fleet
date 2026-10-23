import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfirmationStatus } from '@prisma/client';
import type { AppEnvironment, ConfirmationResponse } from '@smartfleet/shared-types';
import { cleanCustomerComment, customerAnswerSchema, parseRequest } from '@smartfleet/shared-validation';
import type { Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { SettingsService } from '../../settings/settings.service';
import { confirmationPath } from '../confirmation-links';
import { readSnapshot } from '../confirmation-snapshot';
import { normalizeConfirmationToken } from '../confirmation-token';
import { ConfirmationServiceImpl, effectiveStatus, type LinkRow } from '../confirmation.service';
import { renderAlready, renderMain, renderStep, renderThanks, type PageLink, type StepPage } from '../page/pages';
import { attachPageContext, clientIp, type PageContext } from './page-context';
import { PageLimits } from './page-limits';
import { sendPage, sendRedirect } from './page-response';

/** The page's view of a link row: the frozen snapshot plus the row's state. */
export function pageLinkOf(row: LinkRow): PageLink {
  const snapshot = readSnapshot(row.snapshot);
  return {
    shop: snapshot.shop.name,
    shopPhone: snapshot.shop.phoneE164,
    orderNo: snapshot.orderNo,
    deliveredAt: new Date(snapshot.deliveredAt),
    expiresAt: row.expiresAt,
    delivered: snapshot.delivered.map((line) => ({ size: line.size, count: line.count })),
    takenBack: snapshot.takenBack.map((line) => ({ size: line.size, state: line.state, count: line.count, unlabelled: line.unlabelled })),
    response: row.response,
    respondedAt: row.respondedAt,
  };
}

/** The posted answer as typed, and its cleaned note: what the Other page and the 500 page show again. */
function formOf(body: unknown): { answer: string; comment: string | null } {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    answer: typeof record.answer === 'string' ? record.answer : '',
    comment: cleanCustomerComment(record.comment),
  };
}

/**
 * The public link page (CUSTOMER_PAGE §4-§5): the state order, the limits and the pages. Opening a
 * link never records anything; only a POST from the page's buttons does, and only for a PENDING link.
 *
 * State order, for GET and POST: a bad format or unknown token 404 (a known token while
 * `confirmation.enabled` is off 410 "closed"); ANSWERED (GET 200 "Thank you" with `?done=1`, else "You
 * already answered"; a POST of the stored answer 303 to "Thank you", any other 409); CANCELLED 410
 * closed; EXPIRED or past `expiresAt` 410 expired; PENDING the page. Errors are thrown as AppErrors and
 * drawn by PublicPageExceptionFilter from the request's page context.
 */
@Injectable()
export class PublicPageService {
  constructor(
    private readonly confirmations: ConfirmationServiceImpl,
    private readonly settings: SettingsService,
    private readonly limits: PageLimits,
    private readonly config: ConfigService,
  ) {}

  /** GET or HEAD of the main page (`step` null) or a second-step page. */
  async show(req: Request, res: Response, rawToken: string, step: StepPage | null, done: boolean): Promise<void> {
    const context = await this.begin(req);
    context.step = step;
    const token = normalizeConfirmationToken(rawToken);
    if (!token) throw new AppError('CONFIRM_LINK_INVALID');
    context.token = token;
    const row = await this.lookup(token, context);
    const link = context.link as PageLink;

    switch (effectiveStatus(row)) {
      case ConfirmationStatus.ANSWERED:
        return sendPage(
          res,
          200,
          done && !step && row.response ? renderThanks(link, row.response, context.frame) : renderAlready(link, context.frame),
        );
      case ConfirmationStatus.CANCELLED:
        throw new AppError('CONFIRM_LINK_INACTIVE');
      case ConfirmationStatus.EXPIRED:
        throw new AppError('CONFIRM_LINK_EXPIRED');
      default:
        return sendPage(res, 200, step ? renderStep(step, link, token, context.frame) : renderMain(link, token, context.frame));
    }
  }

  /** `POST /c/:token`: records the answer, then 303 to `/c/:token?done=1` (post/redirect/get). */
  async answer(req: Request, res: Response, rawToken: string, body: unknown): Promise<void> {
    const context = await this.begin(req);
    const token = normalizeConfirmationToken(rawToken);
    if (!token) throw new AppError('CONFIRM_LINK_INVALID');
    context.token = token;
    context.form = formOf(body);
    await this.limits.checkToken(token, context);
    const row = await this.lookup(token, context);
    const done = `${confirmationPath(token)}?done=1`;

    switch (effectiveStatus(row)) {
      case ConfirmationStatus.ANSWERED:
        // The same answer again lands on "Thank you"; its note is ignored. Any other answer: 409.
        if (context.form.answer === row.response) return sendRedirect(res, done);
        throw new AppError('CONFIRM_ALREADY_ANSWERED');
      case ConfirmationStatus.CANCELLED:
        throw new AppError('CONFIRM_LINK_INACTIVE');
      case ConfirmationStatus.EXPIRED:
        throw new AppError('CONFIRM_LINK_EXPIRED');
      default:
        break;
    }

    // After the state order: the answer must be exactly one of the four; Other needs a note.
    const parsed = parseRequest(customerAnswerSchema, body);
    if (!parsed.success) {
      if (parsed.fields.some((field) => field.path === 'comment' && field.code === 'NOTE_REQUIRED')) {
        context.step = 'other';
        throw new AppError('CONFIRM_NOTE_REQUIRED');
      }
      throw new AppError('VALIDATION_FAILED', { fields: [] });
    }
    try {
      await this.confirmations.record(token, parsed.data.answer as ConfirmationResponse, parsed.data.comment);
    } catch (error) {
      // Lost a race (another answer, or the link closed meanwhile): draw the page from the link as it is now.
      if (AppError.is(error, 'CONFIRM_ALREADY_ANSWERED', 'CONFIRM_LINK_EXPIRED', 'CONFIRM_LINK_INACTIVE')) {
        const fresh = await this.confirmations.findLink(token).catch(() => null);
        if (fresh) context.link = pageLinkOf(fresh);
      }
      throw error;
    }
    return sendRedirect(res, done);
  }

  /** Any other path or method under `/c/`: the not-found page, with no database lookup. */
  async notFound(req: Request): Promise<never> {
    await this.begin(req);
    throw new AppError('CONFIRM_LINK_INVALID');
  }

  /** Opens the request's page context and applies the per-IP limits (CUSTOMER_PAGE §5 order). */
  private async begin(req: Request): Promise<PageContext> {
    const environment = (this.config.get<AppEnvironment>('app.environment') ?? 'development') as AppEnvironment;
    const context = attachPageContext(req, {
      ip: clientIp(req),
      token: null,
      step: null,
      link: null,
      form: null,
      supportPhone: null,
      frame: { environment },
    });
    await this.limits.checkIp(req.method.toUpperCase(), context);
    await this.limits.checkMisses(context);
    context.supportPhone = await this.settings.get('support.phone');
    return context;
  }

  /** The lookup: an unknown well-formed token is a miss (404); a known one while switched off is 410. */
  private async lookup(token: string, context: PageContext): Promise<LinkRow> {
    const row = await this.confirmations.findLink(token);
    if (!row) {
      await this.limits.countMiss(context);
      throw new AppError('CONFIRM_LINK_INVALID');
    }
    context.link = pageLinkOf(row);
    if (!(await this.settings.get('confirmation.enabled'))) throw new AppError('CONFIRM_LINK_INACTIVE');
    return row;
  }
}
