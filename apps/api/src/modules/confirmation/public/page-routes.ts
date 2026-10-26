import { RequestMethod } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';

/**
 * The routes the public link page serves outside `/api/v1` (CUSTOMER_PAGE §5). main.ts's set-up
 * (common/bootstrap/configure-app.ts) excludes them from the global prefix:
 *
 *   app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [...CONFIRM_PAGE_PREFIX_EXCLUDE] });
 *
 * so `/c/:token` is the page and `/api/v1/c/:token` is an unknown API path (404 JSON, its token
 * redacted). Two spellings of one rule: Nest matches route paths against `c/(.*)` (path-to-regexp 3),
 * while the app-wide middleware (the request id, the request log) is mounted on Express with each
 * excluded path, and Express 4 reads only `c/*` as "anything under /c/". This file imports nothing but
 * Nest's enums, so the bootstrap can use it without loading the confirmation module.
 */
export const CONFIRM_PAGE_PREFIX_EXCLUDE: readonly RouteInfo[] = [
  { path: 'c/(.*)', method: RequestMethod.ALL },
  { path: 'c/*', method: RequestMethod.ALL },
];
