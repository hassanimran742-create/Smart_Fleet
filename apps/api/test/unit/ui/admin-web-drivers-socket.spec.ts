/**
 * security-02, the website's part: when the `/drivers` socket is refused or dropped with `error { code }`
 * for an expired token (AUTH_TOKEN_INVALID) or an ended session (AUTH_SESSION_REVOKED), the live map gets
 * a fresh token at once and reconnects, instead of staying dark until some HTTP poll happens to refresh
 * it (API_CONTRACT §7.14). The website has no UI test runner, so its socket session
 * (admin-web/src/hooks/driversSocketSession.ts) runs here: against a fake socket for each rule, and
 * against a real socket.io server that refuses the way drivers.gateway.ts does.
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';

const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const session = require(path.join(ADMIN_SRC, 'hooks', 'driversSocketSession.ts')) as typeof import('../../../../admin-web/src/hooks/driversSocketSession');
/* eslint-enable @typescript-eslint/no-var-requires */
const { openDriversSocket, MAX_SOCKET_REFUSALS, SOCKET_REFRESH_RETRY_MS } = session;
type Outcome = import('../../../../admin-web/src/hooks/driversSocketSession').SocketRefreshOutcome;
type DriverLocation = import('../../../../admin-web/src/hooks/driversSocketSession').DriverLocation;

class FakeSocket extends EventEmitter {
  disconnected = false;
  disconnect(): this {
    this.disconnected = true;
    this.emit('disconnect', 'io client disconnect');
    return this;
  }
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(outcomes: Outcome['kind'][]) {
  const sockets: FakeSocket[] = [];
  const refresh = jest.fn(async (_failedToken: string): Promise<Outcome> => ({ kind: outcomes.shift() ?? 'refreshed' }));
  const state = { connected: false, drivers: {} as Record<string, DriverLocation> };
  const refusals = { count: 0 };
  const open = (token: string) =>
    openDriversSocket({
      token,
      connect: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      refresh,
      refusals,
      onConnected: (connected) => {
        state.connected = connected;
      },
      onSnapshot: (drivers) => {
        state.drivers = drivers;
      },
      onLocation: (location) => {
        state.drivers = { ...state.drivers, [location.driverId]: location };
      },
    });
  return { sockets, refresh, state, refusals, open };
}

describe('REV security-02 the live map renews its token when the socket refuses it', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('REV security-02 AUTH_TOKEN_INVALID (an expired token) asks for a fresh token at once, with the token the socket used', async () => {
    const h = harness(['refreshed']);
    h.open('token-1');
    h.sockets[0].emit('connect');
    h.sockets[0].emit('drivers:snapshot', [{ id: 'd1', name: 'Kashif', lat: 31.51, lng: 74.28, updated_at: '2026-10-23T03:00:00.000Z' }]);
    expect(h.state).toEqual({ connected: true, drivers: { d1: { driverId: 'd1', name: 'Kashif', lat: 31.51, lng: 74.28, at: '2026-10-23T03:00:00.000Z' } } });
    h.sockets[0].emit('error', { code: 'AUTH_TOKEN_INVALID' });
    h.sockets[0].emit('disconnect', 'io server disconnect');
    await flush();
    expect(h.refresh.mock.calls).toEqual([['token-1']]);
    expect(h.state.connected).toBe(false);
  });

  it('REV security-02 AUTH_SESSION_REVOKED (a suspended user) tries the refresh too; a refused refresh ends there', async () => {
    jest.useFakeTimers();
    const h = harness(['ended']);
    h.open('token-1');
    h.sockets[0].emit('error', { code: 'AUTH_SESSION_REVOKED' });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(60_000);
    expect(h.refresh.mock.calls).toEqual([['token-1']]);
    expect(h.sockets).toHaveLength(1);
  });

  it('REV security-02 PERMISSION_DENIED and other errors are final: no refresh', async () => {
    const h = harness([]);
    h.open('token-1');
    h.sockets[0].emit('error', { code: 'PERMISSION_DENIED' });
    h.sockets[0].emit('error', new Error('transport error'));
    h.sockets[0].emit('error', 'AUTH_TOKEN_INVALID');
    await flush();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('REV security-02 a refresh that cannot reach the server is tried again later, and never after the session closed', async () => {
    jest.useFakeTimers();
    const h = harness(['unavailable', 'unavailable', 'refreshed']);
    const close = h.open('token-1');
    h.sockets[0].emit('error', { code: 'AUTH_TOKEN_INVALID' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(SOCKET_REFRESH_RETRY_MS[0]);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(SOCKET_REFRESH_RETRY_MS[1]);
    expect(h.refresh).toHaveBeenCalledTimes(3);
    expect(h.refresh.mock.calls.every(([token]) => token === 'token-1')).toBe(true);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(h.refresh).toHaveBeenCalledTimes(3); // 'refreshed': the new token opens a new session instead

    const h2 = harness(['unavailable']);
    const close2 = h2.open('token-2');
    h2.sockets[0].emit('error', { code: 'AUTH_TOKEN_INVALID' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    close2();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(h2.refresh).toHaveBeenCalledTimes(1);
    expect(h2.sockets[0].disconnected).toBe(true);
    close();
  });

  it(`REV security-02 a token the socket keeps refusing is renewed at most ${MAX_SOCKET_REFUSALS} times in a row; live data resets the count`, async () => {
    const h = harness([]);
    let close = h.open('token-0');
    for (let n = 1; n <= MAX_SOCKET_REFUSALS + 2; n++) {
      h.sockets[h.sockets.length - 1].emit('error', { code: 'AUTH_TOKEN_INVALID' });
      await flush();
      close();
      close = h.open(`token-${n}`);
    }
    expect(h.refresh).toHaveBeenCalledTimes(MAX_SOCKET_REFUSALS);
    // A socket that carries data again starts a fresh count.
    h.sockets[h.sockets.length - 1].emit('driver:location', { driverId: 'd1', lat: 31.5, lng: 74.3, at: '2026-10-23T03:00:00.000Z' });
    h.sockets[h.sockets.length - 1].emit('error', { code: 'AUTH_TOKEN_INVALID' });
    await flush();
    expect(h.refresh).toHaveBeenCalledTimes(MAX_SOCKET_REFUSALS + 1);
    close();
  });

  it('REV security-02 the hook opens one session per token with the API client\'s single-flight refreshSession', () => {
    const hook = fs.readFileSync(path.join(ADMIN_SRC, 'hooks', 'useDriversSocket.ts'), 'utf8');
    expect(hook).toMatch(/import \{ refreshSession \} from '\.\.\/api\/client';/);
    expect(hook).toMatch(/return openDriversSocket\(\{[\s\S]*?refresh: refreshSession,[\s\S]*?\}\);\s*\}, \[token\]\);/);
  });
});

describe('REV security-02 against a real socket.io server that refuses like drivers.gateway.ts', () => {
  let http: HttpServer;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    http = createServer();
    server = new Server(http);
    // Like the gateway: a refused socket gets `connect`, then `error { code }`, then a server disconnect.
    server.of('/drivers').on('connection', (socket) => {
      const token = (socket.handshake.auth as { token?: string }).token;
      if (token !== 'fresh') {
        socket.emit('error', { code: 'AUTH_TOKEN_INVALID' });
        socket.disconnect(true);
        return;
      }
      socket.emit('drivers:snapshot', [{ id: 'd1', name: 'Kashif', lat: 31.512345, lng: 74.281234, updated_at: '2026-10-23T03:00:00.000Z' }]);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it('REV security-02 an expired token is refused, the session refreshes, and the new token gets the drivers back', async () => {
    const state = { connected: false, drivers: {} as Record<string, DriverLocation> };
    const refusals = { count: 0 };
    let close: () => void = () => undefined;
    const snapshot = new Promise<void>((resolve) => {
      // The auth store: a new token re-runs useDriversSocket's effect (close the old session, open a new one).
      const openWith = (token: string): void => {
        close = openDriversSocket({
          token,
          connect: (auth) => io(`${url}/drivers`, { transports: ['websocket'], auth: { token: auth }, reconnection: false, forceNew: true }),
          refresh: async (failedToken) => {
            expect(failedToken).toBe('expired');
            close();
            openWith('fresh');
            return { kind: 'refreshed' };
          },
          refusals,
          onConnected: (connected) => {
            state.connected = connected;
          },
          onSnapshot: (drivers) => {
            state.drivers = drivers;
            resolve();
          },
          onLocation: () => undefined,
        });
      };
      openWith('expired');
    });
    await snapshot;
    expect(state.drivers).toEqual({ d1: { driverId: 'd1', name: 'Kashif', lat: 31.512345, lng: 74.281234, at: '2026-10-23T03:00:00.000Z' } });
    expect(state.connected).toBe(true);
    close();
  }, 20_000);
});
