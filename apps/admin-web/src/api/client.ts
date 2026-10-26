import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse } from '@smartfleet/shared-types';
import { currentLanguage } from '../i18n';
import { useAuthStore } from '../store/auth';
import { newUuid } from './ids';

/**
 * The API client (UX_ADMIN §1.7). Every request carries `X-Request-Id`, `X-App-Variant: admin-web`,
 * `Accept-Language` and the access token, and times out after 20 seconds. A 401 triggers one
 * `POST /auth/refresh` (single-flight, and one at a time across tabs), then the request is replayed once.
 * When the refresh is refused the session ends: the sign-in page says "Your session ended. Sign in again."
 *
 * In dev the base URL falls back to '/api/v1', which Vite proxies to localhost:3000.
 * Production builds set VITE_API_BASE_URL=https://api.smartfleetpk.com/api/v1.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const APP_VARIANT = 'admin-web';
export const REQUEST_TIMEOUT_MS = 20_000;

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't try a token refresh when this request gets a 401 (sign-in and refresh themselves). */
    skipAuthRefresh?: boolean;
  }
  interface InternalAxiosRequestConfig {
    /** Set on the one replay after a refresh, so a second 401 is final. */
    sfReplayed?: boolean;
  }
}

/** Requests that must never trigger a refresh: a 401 there is the answer, not an expired token. */
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/otp/'];

function isAuthPath(url: string | undefined): boolean {
  if (!url) return false;
  return AUTH_PATHS.some((path) => url.includes(path));
}

function applyCommonHeaders(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  if (!config.headers.has('X-Request-Id')) config.headers.set('X-Request-Id', newUuid());
  config.headers.set('X-App-Variant', APP_VARIANT);
  config.headers.set('Accept-Language', currentLanguage());
  return config;
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

/** A bare client for the refresh call: no token and no 401 handling, so it can't loop. */
const sessionClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});
sessionClient.interceptors.request.use(applyCommonHeaders);

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token && !config.headers.has('Authorization')) config.headers.set('Authorization', `Bearer ${token}`);
  return applyCommonHeaders(config);
});

type RefreshOutcome =
  | { kind: 'refreshed'; token: string }
  | { kind: 'ended' }
  | { kind: 'unavailable'; error: unknown };

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Runs `fn` while holding a lock shared by every tab of this site, when the browser has Web Locks. */
async function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request('smartfleet.admin.session-refresh', fn);
}

async function rehydrateAuth(): Promise<void> {
  try {
    await useAuthStore.persist.rehydrate();
  } catch {
    // Storage unavailable (private mode): the in-memory state is all there is.
  }
}

async function runRefresh(failedToken: string | null): Promise<RefreshOutcome> {
  return withSessionLock(async () => {
    // Another tab, or an earlier request in this tab, may have refreshed while we waited.
    await rehydrateAuth();
    const before = useAuthStore.getState();
    if (before.token && before.token !== failedToken) return { kind: 'refreshed', token: before.token };
    if (!before.refreshToken) {
      if (before.token) useAuthStore.getState().clear('session-ended');
      return { kind: 'ended' };
    }
    try {
      const { data } = await sessionClient.post<LoginResponse>(
        '/auth/refresh',
        { refreshToken: before.refreshToken },
        { skipAuthRefresh: true },
      );
      useAuthStore.getState().setTokens({ token: data.accessToken, refreshToken: data.refreshToken, role: data.role });
      return { kind: 'refreshed', token: data.accessToken };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
        // Refused. Before ending the session, check that no other tab rotated the token meanwhile.
        await rehydrateAuth();
        const latest = useAuthStore.getState();
        if (latest.token && latest.refreshToken && latest.refreshToken !== before.refreshToken) {
          return { kind: 'refreshed', token: latest.token };
        }
        useAuthStore.getState().clear('session-ended');
        return { kind: 'ended' };
      }
      // Offline, timed out, rate limited or a server error: keep the session and let the caller retry.
      return { kind: 'unavailable', error };
    }
  });
}

/**
 * Gets a fresh access token after a 401: one refresh at a time in this tab (single-flight), and one at
 * a time across tabs (Web Locks). `failedToken` is the token the failed request carried.
 */
export function refreshSession(failedToken: string | null): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = runRefresh(failedToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function bearerOf(config: InternalAxiosRequestConfig): string | null {
  const header = config.headers.get('Authorization');
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error) || !error.config || error.response?.status !== 401) throw error;
  const config = error.config;
  if (config.sfReplayed || config.skipAuthRefresh || isAuthPath(config.url)) throw error;

  const outcome = await refreshSession(bearerOf(config));
  if (outcome.kind === 'ended') throw error;
  if (outcome.kind === 'unavailable') throw outcome.error;

  config.sfReplayed = true;
  config.headers.set('Authorization', `Bearer ${outcome.token}`);
  config.headers.set('X-Request-Id', newUuid());
  return api.request(config);
});

/** Ends the session on this device. There is no server sign-out route; the tokens are dropped here. */
export function signOut(): void {
  useAuthStore.getState().clear('signed-out');
}
