import { useEffect, useReducer } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { API_BASE_URL } from '../api/appInfo';
import { renewSession } from '../api/client';
import { useAppStatusStore } from '../store/appStatus';
import { useAuthStore } from '../store/auth';

/** How often the phone sends its position while on duty (the server keeps one per 5 seconds). */
export const LOCATION_INTERVAL_MS = 15_000;
/** "Location paused, no connection" shows after this long without a connection (UX_MOBILE §5). */
export const LOCATION_PAUSED_AFTER_MS = 30_000;

/** Socket refusals a fresh access token can fix (API_CONTRACT §7.14). */
const AUTH_CODES: ReadonlySet<string> = new Set(['AUTH_TOKEN_INVALID', 'AUTH_SESSION_REVOKED']);
/** Refresh-and-reconnect attempts in a row before slowing down. */
const MAX_AUTH_RETRIES = 3;
const RECONNECT_DELAY_MS = 5_000;
const SLOW_RETRY_MS = 60_000;
/** A connection that stays up this long without a refusal counts as healthy. */
const HEALTHY_AFTER_MS = 10_000;

/**
 * Whether the phone may share its location: `unknown` until asked, `denied` when the person refused
 * (or blocked) the permission, `unavailable` when the phone's location is switched off.
 */
export type LiveLocationPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';

export interface LiveLocationStatus {
  /** True while sharing is wanted: on duty and signed in. */
  active: boolean;
  permission: LiveLocationPermission;
  /** True while the socket is connected. */
  connected: boolean;
  /** When the socket lost (or hadn't yet got) its connection; null while connected. */
  socketDownSince: number | null;
  /** When the API client first failed with no response in the current outage; null once a request gets through. */
  networkDownSince: number | null;
}

const INACTIVE: Pick<LiveLocationStatus, 'active' | 'connected' | 'socketDownSince' | 'networkDownSince'> = {
  active: false,
  connected: false,
  socketDownSince: null,
  networkDownSince: null,
};

/**
 * The live-location state, shared by every driver screen: the sharing runs in the Home screen (the
 * root of the driver stack, mounted all day), while the "Location paused" banner shows on top of
 * whatever screen is open.
 */
const useLiveLocationStore = create<LiveLocationStatus>(() => ({ ...INACTIVE, permission: 'unknown' }));

/** The live-location state for screens (the duty card on Home). */
export function useLiveLocationStatus(): LiveLocationStatus {
  return useLiveLocationStore();
}

function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * True when sharing is on but nothing has got through for 30 seconds: the socket has been down, or
 * every request has failed with no response, for that long (UX_MOBILE §5). Re-renders by itself when
 * the 30 seconds pass.
 */
export function useLocationPaused(): boolean {
  const active = useLiveLocationStore((s) => s.active);
  const permission = useLiveLocationStore((s) => s.permission);
  const since = useLiveLocationStore((s) => earliest(s.socketDownSince, s.networkDownSince));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const watching = active && permission === 'granted' && since !== null;

  useEffect(() => {
    if (!watching || since === null) return;
    const left = LOCATION_PAUSED_AFTER_MS - (Date.now() - since);
    if (left <= 0) return;
    const timer = setTimeout(rerender, left + 50);
    return () => clearTimeout(timer);
  }, [watching, since]);

  return watching && since !== null && Date.now() - since >= LOCATION_PAUSED_AFTER_MS;
}

/** The refusal code in a socket `error` payload (`{ code }`) or a middleware's `connect_error`. */
function refusalCode(value: unknown): string | null {
  if (typeof value === 'string') return /^[A-Z][A-Z0-9_]+$/.test(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  const record = value as { code?: unknown; message?: unknown; data?: { code?: unknown } | null };
  if (typeof record.code === 'string') return record.code;
  if (record.data && typeof record.data.code === 'string') return record.data.code;
  return typeof record.message === 'string' ? refusalCode(record.message) : null;
}

function bearer(token: string | null): string | null {
  return token ? `Bearer ${token}` : null;
}

/**
 * Drivers only: while `enabled` (on duty) and signed in, shares the phone's position with the office
 * over the `/drivers` socket (API_CONTRACT §7.14).
 *
 * - `online:set { isOnline }` and `location:update { lat, lng }` carry no driver id: the server takes
 *   it from the session, so a phone can only ever move its own driver.
 * - Every (re)connection sends the current access token. When the server refuses an expired session
 *   (`error { code }` then a disconnect, or a refused handshake), the session is renewed with the
 *   API client's single-flight refresh and the socket reconnects. A session that can't be renewed
 *   ends the sign-in, which stops this hook.
 * - Positions are sent as volatile messages, so a backlog never floods the server after a gap.
 *
 * Foreground only: the trip screens stay on top of Home while a trip runs, so sharing continues.
 */
export function useLiveLocation(enabled: boolean): void {
  const signedIn = useAuthStore((s) => s.token !== null);

  useEffect(() => {
    const store = useLiveLocationStore;
    if (!enabled || !signedIn) {
      store.setState(INACTIVE);
      return;
    }

    const host = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    let stopped = false;
    let socket: Socket | null = null;
    let watcher: Location.LocationSubscription | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let healthyTimer: ReturnType<typeof setTimeout> | null = null;
    let authFailures = 0;
    let handshakeToken: string | null = null;
    let lastRefusal: string | null = null;

    store.setState({
      active: true,
      connected: false,
      socketDownSince: Date.now(),
      networkDownSince: useAppStatusStore.getState().lastNetworkErrorAt,
    });

    // The API client's view of the network: an outage starts at its first failed request.
    const unsubscribeNetwork = useAppStatusStore.subscribe((state, previous) => {
      if (state.lastNetworkErrorAt !== null && previous.lastNetworkErrorAt === null) {
        store.setState({ networkDownSince: state.lastNetworkErrorAt });
      } else if (state.lastNetworkErrorAt === null && previous.lastNetworkErrorAt !== null) {
        store.setState({ networkDownSince: null });
      }
    });

    const clearHealthy = () => {
      if (healthyTimer) clearTimeout(healthyTimer);
      healthyTimer = null;
    };

    const markDown = () => {
      clearHealthy();
      const { socketDownSince } = store.getState();
      store.setState({ connected: false, socketDownSince: socketDownSince ?? Date.now() });
    };

    const later = (run: () => void, ms: number) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!stopped) run();
      }, ms);
    };

    const reconnect = () => {
      if (!stopped && socket && !socket.connected) socket.connect();
    };

    const renewAndReconnect = async () => {
      if (authFailures >= MAX_AUTH_RETRIES) {
        later(() => {
          authFailures = 0;
          reconnect();
        }, SLOW_RETRY_MS);
        return;
      }
      authFailures += 1;
      const renewal = await renewSession(bearer(handshakeToken));
      if (stopped) return;
      if (renewal.ok) reconnect();
      else if (renewal.error.retryable) later(reconnect, RECONNECT_DELAY_MS * authFailures);
      // Otherwise the session has ended (the app signs out), and this effect is cleaned up.
    };

    /** The server refused or dropped this socket; socket.io won't reconnect by itself. */
    const onRefused = (code: string | null) => {
      if (code === 'PERMISSION_DENIED') return; // not a driver session: retrying can't help
      if (code !== null && AUTH_CODES.has(code)) {
        void renewAndReconnect();
        return;
      }
      later(reconnect, RECONNECT_DELAY_MS);
    };

    const openSocket = (): Socket => {
      const s = io(`${host}/drivers`, {
        transports: ['websocket'],
        // Read on every (re)connection, so a renewed session is used at once.
        auth: (send) => {
          handshakeToken = useAuthStore.getState().token;
          send({ token: handshakeToken ?? '' });
        },
        reconnectionDelay: 2_000,
        reconnectionDelayMax: 30_000,
      });

      s.on('connect', () => {
        lastRefusal = null;
        store.setState({ connected: true, socketDownSince: null });
        s.emit('online:set', { isOnline: true });
        // A refused session connects first and is then dropped, so only a connection that stays
        // resets the retry count.
        clearHealthy();
        healthyTimer = setTimeout(() => {
          healthyTimer = null;
          authFailures = 0;
        }, HEALTHY_AFTER_MS);
      });
      s.on('error', (payload: unknown) => {
        lastRefusal = refusalCode(payload);
      });
      s.on('disconnect', (reason) => {
        markDown();
        if (reason === 'io server disconnect') onRefused(lastRefusal);
      });
      s.on('connect_error', (error) => {
        markDown();
        // A handshake refused by the server is not retried by socket.io (`active` is false).
        if (!s.active) onRefused(refusalCode(error));
      });
      return s;
    };

    const watchPosition = async () => {
      if (watcher || stopped) return;
      try {
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: LOCATION_INTERVAL_MS, distanceInterval: 25 },
          (position) => {
            if (!socket?.connected) return;
            socket.volatile.emit('location:update', {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
          },
        );
        if (stopped) {
          subscription.remove();
          return;
        }
        watcher = subscription;
        store.setState({ permission: 'granted' });
      } catch {
        // The phone's location is switched off (or the watch failed): Home says so.
        if (!stopped) store.setState({ permission: 'unavailable' });
      }
    };

    let starting = false;
    const start = async () => {
      if (starting || stopped) return;
      starting = true;
      try {
        let permission: Location.LocationPermissionResponse | null = null;
        try {
          permission = await Location.requestForegroundPermissionsAsync();
        } catch {
          permission = null;
        }
        if (stopped) return;
        if (!permission || permission.status !== 'granted') {
          store.setState({ permission: 'denied' });
          return;
        }
        store.setState({ permission: 'granted' });
        if (!socket) socket = openSocket();
        await watchPosition();
      } finally {
        starting = false;
      }
    };
    void start();

    // After "Open settings", the person comes back to the app: try again with the new permission.
    const appState = AppState.addEventListener('change', (status) => {
      if (status !== 'active' || stopped) return;
      const { permission } = store.getState();
      if (permission === 'denied' || permission === 'unavailable') void start();
    });

    return () => {
      stopped = true;
      appState.remove();
      unsubscribeNetwork();
      if (retryTimer) clearTimeout(retryTimer);
      clearHealthy();
      watcher?.remove();
      if (socket) {
        if (socket.connected) socket.emit('online:set', { isOnline: false });
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
      store.setState(INACTIVE);
    };
  }, [enabled, signedIn]);
}
