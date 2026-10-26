import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse } from '@smartfleet/shared-types';
import { useAppStatusStore } from '../store/appStatus';
import { getRefreshToken, useAuthStore } from '../store/auth';
import { API_BASE_URL, APP_VARIANT, APP_VERSION } from './appInfo';
import { ApiError, apiErrorFromHttp, isUpdateRefusal, networkError, toApiError } from './errors';
import { newRequestId } from './ids';
import { expireSession } from './session';

export { newRequestId, useIdempotencyKey, withIdempotencyKey } from './ids';
export type { IdempotencyKey } from './ids';

/** 15 seconds by default; 60 for uploads (UX_MOBILE §3.1). */
export const REQUEST_TIMEOUT_MS = 15_000;
export const UPLOAD_TIMEOUT_MS = 60_000;

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Send without the access token (public routes such as `/app/config` and `/auth/*`). */
    skipAuth?: boolean;
    /** Don't renew the session on a 401 (sign-in and refresh calls). */
    skipAuthRefresh?: boolean;
    /** Set on the one retry after a refresh. */
    authRetried?: boolean;
  }
}

/**
 * Headers every request from a new build sends (API_CONTRACT §1.2). `X-App-Version` is this JS
 * release's own version (api/release.ts through `APP_VERSION`), not the APK's, so the update gate can
 * tell this JS from the 0.1.0 JS it replaces over the air.
 */
export function appHeaders(): Record<string, string> {
  return {
    'X-App-Variant': APP_VARIANT,
    'X-App-Version': APP_VERSION,
    'Accept-Language': 'en',
  };
}

/**
 * The API client (v2). Every failure is rejected as an `ApiError` (api/errors.ts). A 401 renews the
 * session once with a single-flight refresh, then retries the request; if the refresh is refused the
 * session ends with "Please sign in again".
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...appHeaders() },
});

function bearer(token: string | null): string | null {
  return token ? `Bearer ${token}` : null;
}

api.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers);
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', newRequestId());
  const auth = config.skipAuth ? null : bearer(useAuthStore.getState().token);
  if (auth) headers.set('Authorization', auth);
  else headers.delete('Authorization');
  config.headers = headers;
  return config;
});

function noteResponse(): void {
  useAppStatusStore.getState().markNetworkOk();
}

function noteFailure(error: ApiError): void {
  const status = useAppStatusStore.getState();
  if (error.code === 'NETWORK_OFFLINE' || error.code === 'NETWORK_TIMEOUT') status.markNetworkError();
  else status.markNetworkOk();
  if (isUpdateRefusal(error)) status.markUpdateRequired();
}

type Renewal = { ok: true } | { ok: false; error: ApiError };

let refreshing: Promise<Renewal> | null = null;

async function runRefresh(): Promise<Renewal> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    await expireSession();
    return { ok: false, error: new ApiError({ status: 401, code: 'AUTH_REFRESH_INVALID' }) };
  }
  try {
    const { data } = await api.post<LoginResponse>(
      '/auth/refresh',
      { refreshToken },
      { skipAuth: true, skipAuthRefresh: true },
    );
    await useAuthStore.getState().set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      role: data.role,
    });
    return { ok: true };
  } catch (thrown) {
    const error = toApiError(thrown);
    // No response or a server fault: keep the session and let the person try again later. An old
    // build keeps it too: the update gate takes over, and the session works again after updating.
    if (error.retryable || isUpdateRefusal(error)) return { ok: false, error };
    await expireSession();
    return { ok: false, error };
  }
}

/**
 * Renews the access token after a 401 (UX_MOBILE §3.1). Refresh tokens rotate with reuse detection,
 * so two refreshes in parallel would sign the person out: one shared promise serves every request
 * that failed meanwhile. `usedAuthorization` is the header the failed request carried; when the
 * session has moved on since, the request is just retried with the new token.
 */
export function renewSession(usedAuthorization: string | null): Promise<Renewal> {
  const current = bearer(useAuthStore.getState().token);
  if (!current) {
    // Signed out already (or never signed in): nothing to renew.
    return Promise.resolve({ ok: false, error: new ApiError({ status: 401, code: 'AUTH_TOKEN_INVALID' }) });
  }
  if (current !== usedAuthorization && !refreshing) {
    // The request went out with an older token (or none): retry it with the current one.
    return Promise.resolve({ ok: true });
  }
  if (!refreshing) {
    refreshing = runRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (response) => {
    noteResponse();
    return response;
  },
  async (thrown: unknown) => {
    if (axios.isCancel(thrown)) throw thrown;
    if (axios.isAxiosError(thrown) && thrown.response?.status === 401 && thrown.config) {
      const config: InternalAxiosRequestConfig = thrown.config;
      if (!config.skipAuthRefresh && !config.authRetried && !config.skipAuth) {
        const used = AxiosHeaders.from(config.headers).get('Authorization');
        const renewal = await renewSession(typeof used === 'string' ? used : null);
        if (renewal.ok) {
          config.authRetried = true;
          const headers = AxiosHeaders.from(config.headers);
          headers.delete('X-Request-Id');
          config.headers = headers;
          return api.request(config);
        }
        noteFailure(renewal.error);
        throw renewal.error;
      }
    }
    const error = toApiError(thrown);
    noteFailure(error);
    throw error;
  },
);

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Posts multipart form data with `fetch`, which handles React Native file parts reliably on Android
 * (axios does not). It gets the same headers, timeout (60 s), 401 renewal and error normalisation
 * as `api`.
 */
export async function postMultipart<T>(
  path: string,
  form: FormData,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const send = async (): Promise<{ response: Response; authorization: string | null; requestId: string }> => {
    const authorization = bearer(useAuthStore.getState().token);
    const requestId = newRequestId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        // No Content-Type: fetch adds the multipart boundary itself.
        headers: {
          Accept: 'application/json',
          ...appHeaders(),
          'X-Request-Id': requestId,
          ...(authorization ? { Authorization: authorization } : {}),
          ...options.headers,
        },
        body: form,
        signal: controller.signal,
      });
      return { response, authorization, requestId };
    } catch {
      const error = networkError(controller.signal.aborted ? 'NETWORK_TIMEOUT' : 'NETWORK_OFFLINE', requestId);
      noteFailure(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  let attempt = await send();
  if (attempt.response.status === 401) {
    const renewal = await renewSession(attempt.authorization);
    if (!renewal.ok) {
      noteFailure(renewal.error);
      throw renewal.error;
    }
    attempt = await send();
  }
  const body = await readBody(attempt.response);
  if (!attempt.response.ok) {
    const error = apiErrorFromHttp(attempt.response.status, body, attempt.response.headers, attempt.requestId);
    noteFailure(error);
    throw error;
  }
  noteResponse();
  return body as T;
}
