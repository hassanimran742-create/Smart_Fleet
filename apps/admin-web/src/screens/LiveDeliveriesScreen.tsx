import { useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api/client';
import { useDriversSocket } from '../hooks/useDriversSocket';

// Default Leaflet icon path fix (works around missing assets in Vite bundles)
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const truckIcon = L.divIcon({
  className: '',
  html: '<div style="background:#0f6cf0;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 0 3px white">🚚</div>',
  iconSize: [24, 24],
});

const LAHORE: [number, number] = [31.5204, 74.3587];

export function LiveDeliveriesScreen() {
  const { drivers, connected } = useDriversSocket();

  const trips = useQuery({
    queryKey: ['trips-active'],
    queryFn: async () =>
      (await api.get('/orders/all?status=ASSIGNED')).data
        .concat((await api.get('/orders/all?status=IN_TRANSIT')).data),
    refetchInterval: 15000,
  });

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Live deliveries</h2>
        <span className="muted">
          Socket: {connected ? '🟢 connected' : '🔴 disconnected'} · drivers tracked: {Object.keys(drivers).length}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', height: 480 }}>
        <MapContainer center={LAHORE} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {Object.values(drivers).map((d) => (
            <Marker key={d.driverId} position={[d.lat, d.lng]} icon={truckIcon}>
              <Popup>
                <strong>{d.name ?? d.driverId.slice(0, 8)}</strong>
                <br />
                Updated: {new Date(d.at).toLocaleTimeString()}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="card">
        <h3>Active orders</h3>
        <table>
          <thead><tr><th>ID</th><th>Status</th><th>Distributor</th><th>Client</th><th>Driver</th></tr></thead>
          <tbody>
            {(trips.data ?? []).map((o: any) => (
              <tr key={o.id}>
                <td>{o.id.slice(0, 8)}</td>
                <td>{o.status}</td>
                <td>{o.distributor?.businessName}</td>
                <td>{o.client?.name}</td>
                <td>{o.trip?.driverId ? o.trip.driverId.slice(0, 8) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
