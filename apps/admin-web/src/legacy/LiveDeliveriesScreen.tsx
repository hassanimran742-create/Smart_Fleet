import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { OrderBoardDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { useDriversSocket, type DriverLocation } from '../hooks/useDriversSocket';
import { formatTime } from '../i18n/format';
import { StatusChip } from '../ui';

/**
 * Legacy Live map, kept inside the shell for Inc 1 (UX_ADMIN §1.2, §2.11): the drivers' last positions
 * from the `/drivers` socket, and the orders in progress (`GET /orders/board?tab=in-progress`, the
 * board's own list). Touched for §2.11: order numbers and stage chips instead of id fragments and raw
 * statuses, no emoji, no developer text, and markers drawn from the design tokens.
 */

// Islamabad city centre, until a driver's position is known.
const ISLAMABAD: [number, number] = [33.6844, 73.0479];

/** Flies the map to the focused driver, once per change (not on every render). */
function MapFocuser({ focus }: { focus: { lat: number; lng: number } | null }) {
  const map = useMap();
  const lat = focus?.lat;
  const lng = focus?.lng;
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.flyTo([lat, lng], 15, { duration: 0.8 });
  }, [lat, lng, map]);
  return null;
}

export function LiveDeliveriesScreen() {
  const { drivers, connected } = useDriversSocket();
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ['orders', 'live-map'],
    queryFn: async () => (await api.get<OrderBoardDto>('/orders/board', { params: { tab: 'in-progress', limit: 100 } })).data.items,
    refetchInterval: 15000,
  });

  const focused = focusedDriverId ? drivers[focusedDriverId] : null;
  const focusPoint = focused ? { lat: focused.lat, lng: focused.lng } : null;
  const driverList = Object.values(drivers);

  // Centre on the focused driver, else the first known driver, else Islamabad.
  const mapCenter: [number, number] = focused
    ? [focused.lat, focused.lng]
    : driverList[0]
      ? [driverList[0].lat, driverList[0].lng]
      : ISLAMABAD;

  function focusOnDriver(driverId: string | undefined | null) {
    if (!driverId || !drivers[driverId]) return;
    setFocusedDriverId(driverId);
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ marginBottom: 0 }}>Live map</h2>
        <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
          <span className="muted" role="status">
            {connected ? 'Live positions on' : 'Live positions off: reconnecting'} · {driverList.length}{' '}
            {driverList.length === 1 ? 'driver' : 'drivers'} on the map
          </span>
          {focusedDriverId && <button onClick={() => setFocusedDriverId(null)}>Show everyone</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', height: 480 }}>
        <MapContainer center={mapCenter} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapFocuser focus={focusPoint} />
          {driverList.map((d: DriverLocation) => {
            const isFocused = d.driverId === focusedDriverId;
            return (
              // Leaflet sets a marker's class only when it is created, so a change of focus makes a new one.
              <CircleMarker
                key={`${d.driverId}-${isFocused ? 'focus' : 'plain'}`}
                center={[d.lat, d.lng]}
                radius={isFocused ? 12 : 9}
                className={isFocused ? 'sf-map__pin sf-map__pin--focus' : 'sf-map__pin'}
                eventHandlers={{ click: () => setFocusedDriverId(d.driverId) }}
              >
                <Popup>
                  <strong>{d.name ?? 'Driver'}</strong>
                  <br />
                  Position at {formatTime(d.at)}
                  <br />
                  <button onClick={() => setFocusedDriverId(d.driverId)}>Show on map</button>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      <div className="card">
        <h3>Orders in progress</h3>
        <p className="muted">Click a row to move the map to that order's driver.</p>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Stage</th>
              <th>Distributor</th>
              <th>Customer</th>
              <th>Driver</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {(orders.data ?? []).map((o) => {
              const driverId = o.trip?.driver.id;
              const driverInMap = driverId ? drivers[driverId] : undefined;
              const isFocused = Boolean(driverId) && driverId === focusedDriverId;
              return (
                <tr
                  key={o.id}
                  onClick={() => focusOnDriver(driverId)}
                  style={{
                    cursor: driverInMap ? 'pointer' : 'default',
                    background: isFocused ? 'var(--primary-soft)' : undefined,
                  }}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{o.shortCode}</td>
                  <td>
                    <StatusChip kind="order" value={o.stage} />
                  </td>
                  <td>{o.distributor?.businessName ?? '—'}</td>
                  <td>{o.client.name}</td>
                  <td>
                    {o.trip ? (
                      <span>
                        {o.trip.driver.name} · {o.trip.vehicle.plateNo}
                        {!driverInMap && <span className="muted"> (no live position)</span>}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {driverInMap && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          focusOnDriver(driverId);
                        }}
                      >
                        Show on map
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.isPending && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  Loading orders…
                </td>
              </tr>
            )}
            {orders.isError && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>
                  <p style={{ color: 'var(--danger-fg)' }}>{messageFor(orders.error)}</p>
                  <button onClick={() => void orders.refetch()}>Try again</button>
                </td>
              </tr>
            )}
            {!orders.isPending && !orders.isError && (orders.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No orders in progress. Orders with a driver show here until they are delivered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
