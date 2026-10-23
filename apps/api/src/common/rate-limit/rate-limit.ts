import { Injectable, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { RESPONSE_HEADER } from '../http/headers';
import { RateLimitService } from './rate-limit.service';

/**
 * What a limit counts by: the client IP (`trust proxy` is set), the signed-in user, or a value read
 * from the request (for example the normalised phone of a login). A key function that returns
 * nothing skips that rule for the request.
 */
export type RateLimitBy = 'ip' | 'user' | ((req: Request) => string | null | undefined);

export interface RateLimitRule {
  /** Stable bucket name, such as `auth.login.phone`. */
  name: string;
  limit: number;
  windowSeconds: number;
  by: RateLimitBy;
}

export const RATE_LIMITS_KEY = 'rateLimits';

/**
 * A fixed-window limit on a route (API_CONTRACT §3.6). Stack several for one route; each counts on
 * its own. Over a limit: 429 RATE_LIMITED `{ minutes }` with `Retry-After`. If Redis is down,
 * requests go through.
 *
 *   @RateLimit('auth.login.phone', 5, 600, (req) => normalizePkPhone(req.body?.phone))
 *   @RateLimit('auth.login.ip', 30, 600, 'ip')
 *   @Post('login') login(...) { … }
 */
export function RateLimit(name: string, limit: number, windowSeconds: number, by: RateLimitBy = 'ip'): MethodDecorator {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(`@RateLimit('${name}') needs a positive whole limit and window`);
  }
  return (target, propertyKey, descriptor) => {
    const handler = descriptor.value as object;
    const existing: RateLimitRule[] = Reflect.getMetadata(RATE_LIMITS_KEY, handler) ?? [];
    Reflect.defineMetadata(RATE_LIMITS_KEY, [...existing, { name, limit, windowSeconds, by }], handler);
    // The guard counts every rule of the handler, so it is attached once however many limits stack.
    if (existing.length === 0) UseGuards(RateLimitGuard)(target, propertyKey, descriptor);
    return descriptor;
  };
}

function identityFor(rule: RateLimitRule, req: Request & { user?: { userId?: string } }): string | null {
  if (rule.by === 'ip') return req.ip || req.socket?.remoteAddress || null;
  if (rule.by === 'user') return req.user?.userId ?? null;
  const value = rule.by(req);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const rules = this.reflector.get<RateLimitRule[] | undefined>(RATE_LIMITS_KEY, context.getHandler());
    if (!rules || rules.length === 0) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: { userId?: string } }>();
    let blockedFor = 0;
    for (const rule of rules) {
      const identity = identityFor(rule, req);
      if (!identity) continue;
      const hit = await this.limiter.hit(rule.name, identity, rule.limit, rule.windowSeconds);
      if (!hit.allowed) blockedFor = Math.max(blockedFor, hit.retryAfterSeconds);
    }
    if (blockedFor === 0) return true;

    http.getResponse<Response>().setHeader(RESPONSE_HEADER.retryAfter, String(blockedFor));
    throw new AppError('RATE_LIMITED', { minutes: Math.max(1, Math.ceil(blockedFor / 60)) });
  }
}
