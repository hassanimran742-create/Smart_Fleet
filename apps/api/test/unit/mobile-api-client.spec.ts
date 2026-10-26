/**
 * UXQ-015: the phone's API client (apps/mobile/src/api/client.ts) turns failures into stable codes and
 * renews an expired session once, single-flight (UX_MOBILE §3.1, §3.2). The app has no test runner of
 * its own, so the client runs here with an axios adapter standing in for the network and the native
 * modules stubbed (secure store, app constants, React Native's AppState).
 */
import * as path from 'path';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.2.0', extra: { variant: 'distributor', apiBaseUrl: 'http://test.local/api/v1' } } },
}));
jest.mock('expo-updates', () => ({ updateId: null, isEnabled: false }));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => (store.has(key) ? store.get(key) : null),
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(key);
    },
  };
});

const MOBILE = path.resolve(__dirname, '..', '..', '..', 'mobile', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const { api, REQUEST_TIMEOUT_MS } = require(path.join(MOBILE, 'api', 'client.ts')) as typeof import('../../../mobile/src/api/client');
const { toUserMessage, isApiError } = require(path.join(MOBILE, 'api', 'errors.ts')) as typeof import('../../../mobile/src/api/errors');
const { useAuthStore, getRefreshToken } = require(path.join(MOBILE, 'store', 'auth.ts')) as typeof import('../../../mobile/src/store/auth');
const { useToastStore } = require(path.join(MOBILE, 'store', 'toast.ts')) as typeof import('../../../mobile/src/store/toast');
const { AxiosError } = require('axios') as typeof import('axios');
/* eslint-enable @typescript-eslint/no-var-requires */

/** A JWT-shaped token: the auth store reads the role and ids from its claims. */
function token(n: number): string {
  const claims = { sub: 'user-1', role: 'DISTRIBUTOR', distributorId: 'dist-1', n };
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

interface Script {
  /** The access token the "server" accepts now. */
  valid: string;
  refreshCalls: number;
  refreshOutcome: 'ok' | 'refused';
  calls: { url: string; authorization: string | null; timeout: number | undefined }[];
}

const script: Script = { valid: '', refreshCalls: 0, refreshOutcome: 'ok', calls: [] };

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  const response = { status, statusText: '', data, headers: {}, config, request: {} } as AxiosResponse;
  if (status >= 400) throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, {}, response);
  return response;
}

const adapter: AxiosAdapter = async (config) => {
  const authorization = (config.headers.get('Authorization') as string | undefined) ?? null;
  script.calls.push({ url: config.url ?? '', authorization, timeout: config.timeout });
  await new Promise((resolve) => setTimeout(resolve, 5));
  switch (config.url) {
    case '/slow':
      // What axios's own adapter throws when `timeout` passes.
      throw new AxiosError(`timeout of ${config.timeout}ms exceeded`, 'ECONNABORTED', config);
    case '/no-network':
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    case '/busy':
      return reply(config, 503, { statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'The service is busy. Please try again in a minute.' });
    case '/crash':
      return reply(config, 500, '');
    case '/odd-conflict':
      return reply(config, 409, { statusCode: 409, message: 'raw framework text' });
    case '/auth/refresh': {
      script.refreshCalls += 1;
      if (script.refreshOutcome === 'refused') {
        return reply(config, 401, { statusCode: 401, code: 'AUTH_REFRESH_INVALID', message: 'Please sign in again.' });
      }
      script.valid = token(100 + script.refreshCalls);
      return reply(config, 200, { accessToken: script.valid, refreshToken: `refresh-${script.refreshCalls}`, expiresIn: 43200, role: 'DISTRIBUTOR' });
    }
    default:
      if (authorization !== `Bearer ${script.valid}`) {
        return reply(config, 401, { statusCode: 401, code: 'AUTH_TOKEN_INVALID', message: 'Please sign in again.' });
      }
      return reply(config, 200, { ok: true, url: config.url });
  }
};

api.defaults.adapter = adapter;

async function failure(promise: Promise<unknown>): Promise<import('../../../mobile/src/api/errors').ApiError> {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

async function signIn(): Promise<void> {
  await useAuthStore.getState().set({ accessToken: token(1), refreshToken: 'refresh-0', role: 'DISTRIBUTOR' });
}

describe('UXQ-015 The phone API client turns failures into stable codes and refreshes an expired session once', () => {
  beforeEach(async () => {
    script.calls = [];
    script.refreshCalls = 0;
    script.refreshOutcome = 'ok';
    useToastStore.setState({ current: null });
    await signIn();
    script.valid = token(1);
  });

  it('UXQ-015 a timeout and a lost connection are NETWORK_TIMEOUT and NETWORK_OFFLINE, both retryable', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
    const timeout = await failure(api.get('/slow'));
    expect(script.calls[0].timeout).toBe(15_000);
    expect(timeout).toMatchObject({ code: 'NETWORK_TIMEOUT', retryable: true });
    expect(toUserMessage(timeout)).toBe('This is taking too long. Check your signal and try again.');
    const offline = await failure(api.get('/no-network'));
    expect(offline).toMatchObject({ code: 'NETWORK_OFFLINE', retryable: true });
    expect(toUserMessage(offline)).toBe('No connection. Try again.');
  });

  it('UXQ-015 server faults keep their code and never show raw text or an HTTP number', async () => {
    const busy = await failure(api.get('/busy'));
    expect(busy).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
    expect(toUserMessage(busy)).toBe('The service is busy. Please try again in a minute.');
    const crash = await failure(api.get('/crash'));
    expect(crash).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true });
    expect(toUserMessage(crash)).toBe('Something went wrong on our side. Please try again.');
    const odd = await failure(api.get('/odd-conflict'));
    expect(odd.code).toBe('UNKNOWN');
    for (const error of [busy, crash, odd]) {
      expect(toUserMessage(error)).not.toMatch(/\b(409|500|503)\b|raw framework text/);
    }
    expect(toUserMessage(odd)).toMatch(/^(raw framework text|Something went wrong\. Please try again\.)$/);
  });

  it('UXQ-015 three calls that all get 401 share one refresh, store the new refresh token and each retry once', async () => {
    script.valid = 'expired-on-the-server';
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(script.refreshCalls).toBe(1);
    expect(await getRefreshToken()).toBe('refresh-1');
    for (const url of ['/a', '/b', '/c']) {
      expect(script.calls.filter((call) => call.url === url)).toHaveLength(2);
    }
  });

  it('UXQ-015 a refused refresh clears the session and shows "Please sign in again" once', async () => {
    script.valid = 'expired-on-the-server';
    script.refreshOutcome = 'refused';
    const shown: string[] = [];
    const unsubscribe = useToastStore.subscribe((state) => {
      if (state.current) shown.push(state.current.message);
    });
    const errors = await Promise.all([failure(api.get('/a')), failure(api.get('/b')), failure(api.get('/c'))]);
    unsubscribe();
    expect(script.refreshCalls).toBe(1);
    expect(errors.every((error) => error.status === 401)).toBe(true);
    expect(useAuthStore.getState().token).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/^Please sign in again\.?$/);
  });
});
