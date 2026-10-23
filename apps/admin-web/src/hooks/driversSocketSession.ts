/**
 * One office connection to the `/drivers` socket (API_CONTRACT §7.14), kept free of React so it can be
 * tested on its own; `useDriversSocket` opens one per access token.
 *
 * The server checks the token at the handshake and may drop the socket later (an expired token, an
 * ended session): it sends `error { code }` and disconnects, and socket.io doesn't reconnect by itself.
 * On AUTH_TOKEN_INVALID or AUTH_SESSION_REVOKED the session asks for a fresh token at once, instead of
 * leaving the live map dark until some other request happens to refresh it:
 * - a new token re-runs the hook, which opens a new session with it;
 * - a refused refresh ends the sign-in (the API client clears it), which closes the session;
 * - a refresh that can't reach the server is tried again, a little later each time.
 * A token the server keeps refusing is renewed at most {@link MAX_SOCKET_REFUSALS} times in a row.
 */

export interface DriverLocation {
  driverId: string;
  name?: string;
  lat: number;
  lng: number;
  at: string;
}

/** The part of a socket.io client socket a session uses. */
export interface DriversSocketLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  disconnect(): unknown;
}

/** What `refreshSession` (api/client.ts) answers; a new token reaches the hook through the auth store. */
export interface SocketRefreshOutcome {
  kind: 'refreshed' | 'ended' | 'unavailable';
}

/** Refusals that a fresh access token can fix (API_CONTRACT §7.14); PERMISSION_DENIED is final. */
export const SOCKET_AUTH_REFUSALS: readonly string[] = ['AUTH_TOKEN_INVALID', 'AUTH_SESSION_REVOKED'];

/** Fresh tokens tried in a row while the socket keeps refusing them and carries no data. */
export const MAX_SOCKET_REFUSALS = 3;

/** Waits before trying an unreachable refresh again. */
export const SOCKET_REFRESH_RETRY_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];

export interface DriversSocketSessionOptions {
  token: string;
  /** Opens the socket with this token (`io(…/drivers, { auth: { token } })`). */
  connect: (token: string) => DriversSocketLike;
  /** `refreshSession` of the API client: one refresh at a time, in this tab and across tabs. */
  refresh: (failedToken: string) => Promise<SocketRefreshOutcome>;
  onConnected: (connected: boolean) => void;
  onSnapshot: (drivers: Record<string, DriverLocation>) => void;
  onLocation: (location: DriverLocation) => void;
  /** Kept by the caller across sessions: refusals since the socket last carried data. */
  refusals: { count: number };
}

/** True for `error { code }` payloads that a fresh token can fix. */
export function isSocketAuthRefusal(payload: unknown): boolean {
  const code = typeof payload === 'object' && payload !== null ? (payload as { code?: unknown }).code : undefined;
  return typeof code === 'string' && SOCKET_AUTH_REFUSALS.includes(code);
}

interface SnapshotRow {
  id: string;
  name?: string;
  lat: number;
  lng: number;
  updated_at: string;
}

/** Opens the session and returns the function that closes it. */
export function openDriversSocket(options: DriversSocketSessionOptions): () => void {
  const { token, refusals } = options;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const socket = options.connect(token);

  const renew = async (attempt: number): Promise<void> => {
    const outcome = await options.refresh(token).catch((): SocketRefreshOutcome => ({ kind: 'unavailable' }));
    if (closed || outcome.kind !== 'unavailable') return;
    const wait = SOCKET_REFRESH_RETRY_MS[Math.min(attempt, SOCKET_REFRESH_RETRY_MS.length - 1)];
    retry = setTimeout(() => void renew(attempt + 1), wait);
  };

  socket.on('connect', () => options.onConnected(true));
  socket.on('disconnect', () => options.onConnected(false));

  socket.on('drivers:snapshot', (rows: SnapshotRow[]) => {
    refusals.count = 0;
    const next: Record<string, DriverLocation> = {};
    for (const row of rows) next[row.id] = { driverId: row.id, name: row.name, lat: row.lat, lng: row.lng, at: row.updated_at };
    options.onSnapshot(next);
  });

  socket.on('driver:location', (location: DriverLocation) => {
    refusals.count = 0;
    options.onLocation(location);
  });

  // A refused or dropped socket: get a fresh token (the server disconnects right after this).
  socket.on('error', (payload: unknown) => {
    if (closed || !isSocketAuthRefusal(payload) || refusals.count >= MAX_SOCKET_REFUSALS) return;
    refusals.count += 1;
    void renew(0);
  });

  return () => {
    closed = true;
    if (retry !== undefined) clearTimeout(retry);
    socket.disconnect();
  };
}
