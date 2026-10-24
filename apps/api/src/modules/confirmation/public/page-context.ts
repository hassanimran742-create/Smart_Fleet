/**
 * What a `/c/` request has learnt so far (its token, the link it found, the answer it posted), kept on
 * the request so the error filter can draw the right page for whatever went wrong: the expired page
 * needs the shop and the lifetime, the Other page its cleaned note, the 500 page the answer to post
 * again (CUSTOMER_PAGE §5).
 */
import type { Request } from 'express';
import type { PageLink, StepPage } from '../page/pages';
import type { PageFrame } from '../page/templates';

export interface PageContext {
  /** The client IP (`trust proxy` is set), for the limits. */
  ip: string;
  /** The normalised token once its format passed; null before (and for a bad format). */
  token: string | null;
  /** The second-step page asked for, or null for the main page. */
  step: StepPage | null;
  /** The link, once its token was found. */
  link: PageLink | null;
  /** The posted answer and its cleaned note, for the Other page's error and the 500 page's Try again. */
  form: { answer: string; comment: string | null } | null;
  /** `support.phone`, for the not-found page. */
  supportPhone: string | null;
  frame: PageFrame;
  /** Seconds until a refused request may try again (the 429 page and `Retry-After`). */
  retryAfterSeconds?: number;
}

const PAGE_CONTEXT = Symbol('confirmPageContext');
type WithContext = Request & { [PAGE_CONTEXT]?: PageContext };

export function attachPageContext(req: Request, context: PageContext): PageContext {
  (req as WithContext)[PAGE_CONTEXT] = context;
  return context;
}

export function pageContextOf(req: Request | undefined): PageContext | undefined {
  return req ? (req as WithContext)[PAGE_CONTEXT] : undefined;
}

/** The client's IP as the limits count it. */
export function clientIp(req: Pick<Request, 'ip' | 'socket'>): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
