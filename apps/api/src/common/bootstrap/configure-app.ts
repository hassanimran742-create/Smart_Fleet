import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded, type RequestHandler } from 'express';
import { CONFIRM_PAGE_PREFIX_EXCLUDE } from '../../modules/confirmation/public/page-routes';
import { EXPOSED_HEADERS } from '../http/headers';
import { installBigIntJson } from './bigint-json';

export const GLOBAL_PREFIX = 'api/v1';

/** The customer page's body limit (CUSTOMER_PAGE §5): its own form posts well under 1 KB. [review23 robustness-jobs-09] */
export const PAGE_BODY_LIMIT = '8kb';
/** At most this many fields in a page body (the form has three). */
export const PAGE_BODY_FIELDS = 20;

/**
 * CORS for the apps (API_CONTRACT §3.7): the configured origins (CORS_ORIGINS, comma-separated;
 * required and never '*' in production and staging), exposing the contract's response headers.
 * With no list, as in local development, any origin is allowed, as before.
 */
export function corsOptions(origins: readonly string[]): CorsOptions {
  return {
    origin: origins.length === 0 || origins.includes('*') ? '*' : [...origins],
    exposedHeaders: [...EXPOSED_HEADERS],
  };
}

/**
 * The HTTP set-up shared by main.ts and API tests, so tests see the same routes and headers:
 * the `/api/v1` prefix (from Inc 2 the customer's link page `/c/…` is outside it, CUSTOMER_PAGE §5),
 * CORS, `trust proxy` (the API runs behind Caddy, so `req.ip` is the client's for rate limits and
 * audit rows) and BigInt JSON. The global filter, pipe and interceptors are providers of AppModule
 * and need nothing here.
 *
 *   const app = moduleRef.createNestApplication();
 *   configureApp(app);
 *   await app.init();
 */
export function configureApp(app: INestApplication): INestApplication {
  installBigIntJson();
  const instance = app.getHttpAdapter().getInstance() as {
    set?: (name: string, value: unknown) => void;
    use?: (path: string, ...handlers: RequestHandler[]) => void;
  };
  instance.set?.('trust proxy', 1);
  // The customer's page posts a few hundred bytes (answer, comment, v): its bodies get their own small
  // limit, read before Nest's own parsers (which then skip a parsed body). A refusal is drawn as a page.
  // The parsers are wrapped: Nest skips its own app-wide parsers when it finds a layer named jsonParser or
  // urlencodedParser, so these must not carry those names.
  const pageForm = urlencoded({ extended: true, limit: PAGE_BODY_LIMIT, parameterLimit: PAGE_BODY_FIELDS });
  const pageJson = json({ limit: PAGE_BODY_LIMIT });
  instance.use?.(
    '/c',
    function customerPageForm(req, res, next) {
      pageForm(req, res, next);
    },
    function customerPageJson(req, res, next) {
      pageJson(req, res, next);
    },
  );
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [...CONFIRM_PAGE_PREFIX_EXCLUDE] });
  const origins = app.get(ConfigService).get<string[]>('cors.origins') ?? [];
  app.enableCors(corsOptions(origins));
  return app;
}
