import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api/client';
import { useDriversSocket, DriverLocation } from '../hooks/useDriversSocket';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const truckIcon = L.divIcon({
  className: '',
  html: '<div style="background:#0f6cf0;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 0 0 3px white, 0 4px 10px rgba(15,108,240,.4)">🚚</div>',
  iconSize: [28, 28],
});

const truckIconFocused = L.divIcon({
  className: '',
  html: '<div style="background:#1ea675;color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 0 4px white, 0 6px 14px rgba(30,166,117,.5)">🚚</div>',
  iconSize: [34, 34],
});

// Default to Islamabad city centre (where the demo data lives).
const ISLAMABAD: [number, number] = [33.6844, 73.0479];

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  CONFIRMED: 'pill-primary',
  ASSIGNED: 'pill-primary',
  IN_TRANSIT: 'pill-primary',
  DELIVERED: 'pill-ok',
  CANCELLED: 'pill-neutral',
  FAILED: 'pill-danger',
};

/**
 * Child of MapContainer — uses the useMap hook to pan/zoom the map
 * whenever the parent's `focus` prop changes.
 */
function MapFocuser({ focus }: { focus: { lat: number; lng: number } | null }) {
  const map = useMap();
  if (focus) {
    map.flyTo([focus.lat, focus.lng], 15, { duration: 0.8 });
  }
  return null;
}

export function LiveDeliveriesScreen() {
  const { drivers, connected } = useDriversSocket();
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);

  const trips = useQuery({
    queryKey: ['orders-active'],
    queryFn: async () => {
      const assigned = (await api.get('/orders/all?status=ASSIGNED')).data;
      const inTransit = (await api.get('/orders/all?status=IN_TRANSIT')).data;
      return [...assigned, ...inTransit];
    },
    refetchInterval: 15000,
  });

  const focused = focusedDriverId ? drivers[focusedDriverId] : null;
  const focusPoint = focused ? { lat: focused.lat, lng: focused.lng } : null;

  // Map center: if a driver is focused, point at them; otherwise centre on
  // the first known driver or fall back to Islamabad.
  const mapCenter: [number, number] = focused
    ? [focused.lat, focused.lng]
    : Object.values(drivers)[0]
      ? [Object.values(drivers)[0].lat, Object.values(drivers)[0].lng]
      : ISLAMABAD;

  function focusOnDriver(driverId: string | undefined | null) {
    if (!driverId) return;
    if (!drivers[driverId]) return;
    setFocusedDriverId(driverId);
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginBottom: 0 }}>Live deliveries</h2>
        <div className="flex" style={{ gap: 12 }}>
          <span className="muted">
            Socket: {connected ? '🟢 connected' : '🔴 disconnected'} · drivers tracked: {Object.keys(drivers).length}
          </span>
          {focusedDriverId && (
            <button onClick={() => setFocusedDriverId(null)}>Reset view</button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', height: 480 }}>
        <MapContainer center={mapCenter} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFocuser focus={focusPoint} />
          {Object.values(drivers).map((d: DriverLocation) => {
            const isFocused = d.driverId === focusedDriverId;
            return (
              <Marker
                key={d.driverId}
                position={[d.lat, d.lng]}
                icon={isFocused ? truckIconFocused : truckIcon}
                eventHandlers={{ click: () => setFocusedDriverId(d.driverId) }}
              >
                <Popup>
                  <strong>{d.name ?? d.driverId.slice(0, 8)}</strong>
                  <br />
                  Updated: {new Date(d.at).toLocaleTimeString()}
                  <br />
                  <button onClick={() => setFocusedDriverId(d.driverId)}>Focus on map</button>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <div className="card">
        <h3>Active orders</h3>
        <p className="muted">Click any row to fly the map to that driver.</p>
        <table>
          <thead>
            <tr><th>Order</th><th>Status</th><th>Distributor</th><th>Client</th><th>Driver</th><th></th></tr>
          </thead>
          <tbody>
            {(trips.data ?? []).map((o: any) => {
              const driverId = o.trip?.driverId;
              const driverInMap = driverId ? drivers[driverId] : undefined;
              const isFocused = driverId === focusedDriverId;
              return (
                <tr
                  key={o.id}
                  onClick={() => focusOnDriver(driverId)}
                  style={{
                    cursor: driverInMap ? 'pointer' : 'default',
                    background: isFocused ? 'var(--primary-soft)' : undefined,
                  }}
                >
                  <td><code>{o.id.slice(0, 8)}</code></td>
                  <td><span className={`pill ${STATUS_TONE[o.status] ?? 'pill-neutral'}`}>{o.status}</span></td>
                  <td>{o.distributor?.businessName}</td>
                  <td>{o.client?.name}</td>
                  <td>
                    {driverInMap ? (
                      <span>
                        {driverInMap.name ?? driverId?.slice(0, 8)}
                        {isFocused && <span style={{ marginLeft: 6, color: 'var(--ok)' }}>● focused</span>}
                      </span>
                    ) : (
                      <span className="muted">{driverId ? driverId.slice(0, 8) : '—'} (no live signal)</span>
                    )}
                  </td>
                  <td>
                    {driverInMap && (
                      <button onClick={(e) => { e.stopPropagation(); focusOnDriver(driverId); }}>Focus</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {(trips.data ?? []).length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No active deliveries. Run <code>npm run seed:demo</code> to populate scenarios.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
