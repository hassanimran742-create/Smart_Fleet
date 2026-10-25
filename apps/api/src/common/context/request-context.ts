import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { APP_VARIANTS, type AppVariant } from '@smartfleet/shared-types';

/** Facts about the current request, readable anywhere below the middleware (audit rows, logs, errors). */
export interface RequestContextData {
  requestId: string;
  ip?: string;
  userAgent?: string;
  /** `X-App-Variant`, when it is one of driver, distributor, admin-web. */
  appVariant?: AppVariant;
  /** `X-App-Version`, when it looks like x.y.z. */
  appVersion?: string;
  /** The list this request reads, for its paging cursors ({@link listKeyOf}). */
  listKey?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,64})?$/;
const MAX_USER_AGENT = 512;

/** A client's `X-Request-Id` when it is a safe token (a UUID in practice); otherwise a new UUID. */
export function normalizeRequestId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && REQUEST_ID.test(trimmed) ? trimmed : randomUUID();
}

export function parseAppVariant(value: string | undefined): AppVariant | undefined {
  const variant = value?.trim().toLowerCase();
  return (APP_VARIANTS as readonly string[]).includes(variant ?? '') ? (variant as AppVariant) : undefined;
}

export function parseAppVersion(value: string | undefined): string | undefined {
  const version = value?.trim();
  return version && VERSION.test(version) ? version : undefined;
}

/**
 * "1.10.0" > "1.9.3". Missing parts count as 0; a pre-release or build suffix is ignored. The update gate
 * (AppVersionInterceptor) and the office's app chips (AppSeenService) compare with it.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function clampUserAgent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_USER_AGENT ? value.slice(0, MAX_USER_AGENT) : value;
}

/**
 * The list a request reads (API_CONTRACT §1.3: a cursor another list made is refused): its path
 * without the query, in lower case and without a trailing slash, plus the `tab` it names. Each tab is
 * its own list (the board's needs-driver tab sorts the other way); other filters are not part of it.
 */
export function listKeyOf(url: string | undefined, tab: unknown): string {
  const path = (url ?? '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  return typeof tab === 'string' && tab.trim() !== '' ? `${path}?tab=${tab.trim().toLowerCase()}` : path;
}

/** The request context of the current async call chain (set by RequestContextMiddleware). */
export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  current(): RequestContextData | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
