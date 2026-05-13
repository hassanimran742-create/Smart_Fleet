import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth';

export interface DriverLocation {
  driverId: string;
  name?: string;
  lat: number;
  lng: number;
  at: string;
}

export function useDriversSocket() {
  const token = useAuthStore((s) => s.token);
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    const apiHost = window.location.origin.replace(/:\d+$/, ':3000');
    const socket: Socket = io(`${apiHost}/drivers`, {
      transports: ['websocket'],
      auth: { token },
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('drivers:snapshot', (rows: any[]) => {
      const next: Record<string, DriverLocation> = {};
      for (const r of rows) {
        next[r.id] = { driverId: r.id, name: r.name, lat: r.lat, lng: r.lng, at: r.updated_at };
      }
      setDrivers(next);
    });

    socket.on('driver:location', (msg: DriverLocation) => {
      setDrivers((d) => ({ ...d, [msg.driverId]: msg }));
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  return { drivers, connected };
}
