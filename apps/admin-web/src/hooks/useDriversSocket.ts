import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { refreshSession } from '../api/client';
import { useAuthStore } from '../store/auth';
import { openDriversSocket, type DriverLocation } from './driversSocketSession';

export type { DriverLocation } from './driversSocketSession';

/**
 * Live driver positions for the office (API_CONTRACT §7.14): one `/drivers` socket per access token.
 * When the server refuses or drops it for an expired token or an ended session, the session gets a fresh
 * token at once; the new token re-runs this effect, which connects again (driversSocketSession.ts).
 */
export function useDriversSocket() {
  const token = useAuthStore((s) => s.token);
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [connected, setConnected] = useState(false);
  const refusals = useRef({ count: 0 });

  useEffect(() => {
    if (!token) return;
    // Prod: VITE_API_ORIGIN=https://api.smartfleetpk.com. Dev: derive localhost:3000.
    const apiHost =
      import.meta.env.VITE_API_ORIGIN ??
      window.location.origin.replace(/:\d+$/, ':3000');
    return openDriversSocket({
      token,
      connect: (auth) => io(`${apiHost}/drivers`, { transports: ['websocket'], auth: { token: auth } }),
      refresh: refreshSession,
      refusals: refusals.current,
      onConnected: setConnected,
      onSnapshot: setDrivers,
      onLocation: (location) => setDrivers((current) => ({ ...current, [location.driverId]: location })),
    });
  }, [token]);

  return { drivers, connected };
}
