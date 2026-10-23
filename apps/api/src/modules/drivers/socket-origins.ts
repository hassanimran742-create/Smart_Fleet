import type { IncomingMessage } from 'http';
import { parseCorsOrigins } from '../../config/configuration';

/**
 * Which browser origins may open the `/drivers` socket (API_CONTRACT §3.7): the same CORS_ORIGINS
 * list as the HTTP API. The gateway's options are fixed when the class is decorated, so they read the
 * list through these functions; the gateway sets it from ConfigService when it is created, before the
 * socket server exists.
 */
let allowedOrigins: readonly string[] = parseCorsOrigins(process.env.CORS_ORIGINS);

export function setSocketOrigins(origins: readonly string[]): void {
  allowedOrigins = origins.map((origin) => origin.trim().replace(/\/+$/, '')).filter((origin) => origin.length > 0);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The `host` of an origin such as "https://api.example.pk:8443", or null when it isn't a URL. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when a socket handshake with this `Origin` may go on:
 * - no Origin (a native app or a server);
 * - the API's own origin (React Native's WebSocket sends the URL's own origin);
 * - any origin while no list is configured (local development, as for HTTP);
 * - an origin on the list.
 */
export function isSocketOriginAllowed(origin: string | undefined, requestHost?: string): boolean {
  if (origin === undefined || origin === '') return true;
  const host = hostOf(origin);
  if (host !== null && requestHost !== undefined && host === requestHost.toLowerCase()) return true;
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) return true;
  return allowedOrigins.includes(origin.replace(/\/+$/, ''));
}

/** engine.io `allowRequest`: refuses the handshake (HTTP 403) of a browser origin that isn't allowed. */
export function allowSocketRequest(req: IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void): void {
  const origin = firstHeader(req.headers.origin);
  const host = firstHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim() || firstHeader(req.headers.host);
  const allowed = isSocketOriginAllowed(origin, host);
  callback(allowed ? null : 'origin not allowed', allowed);
}

/**
 * The `cors` package's origin check for the polling transport: an allowed origin is echoed back,
 * any other gets no Access-Control-Allow-Origin. The handshake itself is refused by allowSocketRequest.
 */
export function socketCorsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
  callback(null, isSocketOriginAllowed(origin));
}
