import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/auth';

const LOCATION_INTERVAL_MS = 15_000;

/**
 * Drivers-only: requests location permissions, opens a Socket.io
 * connection to the API's /drivers namespace, and emits `location:update`
 * every 15s while the driver is online.
 *
 * Background mode requires expo-task-manager registration; this hook
 * keeps the foreground stream alive (sufficient while the trip screen
 * is open on top).
 */
export function useLiveLocation(driverId: string | null | undefined, enabled: boolean) {
  const socketRef = useRef<Socket | null>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!enabled || !driverId || !token) return;
    const apiBase = (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? '';
    const host = apiBase.replace(/\/api\/v1\/?$/, '');
    if (!host) return;

    let stopped = false;
    let watcher: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || stopped) return;

      const socket = io(`${host}/drivers`, {
        transports: ['websocket'],
        auth: { token },
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('online:set', { driverId, isOnline: true });
      });

      watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_INTERVAL_MS,
          distanceInterval: 25,
        },
        (loc) => {
          socket.emit('location:update', {
            driverId,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        },
      );
    })();

    return () => {
      stopped = true;
      if (watcher) watcher.remove();
      if (socketRef.current) {
        socketRef.current.emit('online:set', { driverId, isOnline: false });
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled, driverId, token]);
}
