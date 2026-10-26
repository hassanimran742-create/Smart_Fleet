/**
 * The link page's rate limits (CUSTOMER_PAGE §5, API_CONTRACT §3.6): fixed windows in Redis through the
 * shared {@link RateLimitService}, which lets every request through when Redis is down (the 130-bit
 * token is the real protection). Counters are keyed by a hash of the IP or the token, never in clear.
 *
 * | Request | Limit |
 * |---|---|
 * | GET, HEAD | 60 per minute per IP |
 * | POST (and any other method) | 20 per minute per IP, and 6 per 10 minutes per token |
 * | Unknown tokens (well-formed, not found) | 30 per 10 minutes per IP |
 *
 * Order (the page service follows it): the per-IP limit (every request); an IP with 30 misses in its
 * window gets 429 on every `/c/` request, valid links included, without a lookup; the format check (a
 * bad format is 404 with no lookup and is not a miss); for POST the per-token limit (refused 400s count);
 * then the lookup, where a well-formed unknown token adds a miss.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { RateLimitService } from '../../../common/rate-limit/rate-limit.service';
import type { PageContext } from './page-context';

export interface PageLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const PAGE_LIMITS = {
  read: { name: 'confirm.page.read.ip', limit: 60, windowSeconds: 60 },
  write: { name: 'confirm.page.write.ip', limit: 20, windowSeconds: 60 },
  token: { name: 'confirm.page.post.token', limit: 6, windowSeconds: 600 },
  misses: { name: 'confirm.page.miss.ip', limit: 30, windowSeconds: 600 },
} as const satisfies Record<string, PageLimitRule>;

/** Seconds left in the fixed window holding `nowMs` (the same windows RateLimitService counts in). */
export function windowSecondsLeft(windowSeconds: number, nowMs = Date.now()): number {
  const now = Math.floor(nowMs / 1000);
  const start = now - (now % windowSeconds);
  return Math.max(1, start + windowSeconds - now);
}

function refuse(context: PageContext, retryAfterSeconds: number): never {
  context.retryAfterSeconds = retryAfterSeconds;
  throw new AppError('RATE_LIMITED', { minutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)) });
}

@Injectable()
export class PageLimits {
  constructor(private readonly limiter: RateLimitService) {}

  /** The per-IP limit of every request: GET and HEAD read, anything else writes. */
  async checkIp(method: string, context: PageContext): Promise<void> {
    const rule = method === 'GET' || method === 'HEAD' ? PAGE_LIMITS.read : PAGE_LIMITS.write;
    const hit = await this.limiter.hit(rule.name, context.ip, rule.limit, rule.windowSeconds);
    if (!hit.allowed) refuse(context, hit.retryAfterSeconds);
  }

  /** An IP with 30 misses in its window is refused on every `/c/` request, before any lookup. */
  async checkMisses(context: PageContext): Promise<void> {
    const rule = PAGE_LIMITS.misses;
    const misses = await this.limiter.peek(rule.name, context.ip, rule.windowSeconds);
    if (misses >= rule.limit) refuse(context, windowSecondsLeft(rule.windowSeconds));
  }

  /** A well-formed token that matched nothing. */
  async countMiss(context: PageContext): Promise<void> {
    const rule = PAGE_LIMITS.misses;
    await this.limiter.hit(rule.name, context.ip, rule.limit, rule.windowSeconds);
  }

  /** The per-token POST limit: every POST to the token counts, refused ones included. */
  async checkToken(token: string, context: PageContext): Promise<void> {
    const rule = PAGE_LIMITS.token;
    const hit = await this.limiter.hit(rule.name, token, rule.limit, rule.windowSeconds);
    if (!hit.allowed) refuse(context, hit.retryAfterSeconds);
  }
}
