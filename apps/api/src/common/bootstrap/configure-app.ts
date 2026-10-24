import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { CONFIRM_PAGE_PREFIX_EXCLUDE } from '../../modules/confirmation/public/page-routes';
import { EXPOSED_HEADERS } from '../http/headers';
import { installBigIntJson } from './bigint-json';

export const GLOBAL_PREFIX = 'api/v1';

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
  const instance = app.getHttpAdapter().getInstance() as { set?: (name: string, value: unknown) => void };
  instance.set?.('trust proxy', 1);
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [...CONFIRM_PAGE_PREFIX_EXCLUDE] });
  const origins = app.get(ConfigService).get<string[]>('cors.origins') ?? [];
  app.enableCors(corsOptions(origins));
  return app;
}
