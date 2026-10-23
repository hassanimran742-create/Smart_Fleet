import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { OrderBoardDto, OrderDto } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { useZoneOutlines } from '../features/distributors/api';
import { DEFAULT_MAP_CENTER, FitToZones, OSM_CREDIT, OSM_TILES, ZoneLayer, zonesBounds } from '../features/distributors/StoreMapPicker';
import { useDriversSocket, type DriverLocation } from '../hooks/useDriversSocket';
import { formatTime } from '../i18n/format';
import { Button, EmptyState, ErrorState, PageHeader, StatusChip, Table, type TableColumn } from '../ui';
import { useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy Live map, kept inside the shell for Inc 1 (UX_ADMIN §1.2, §2.11). Light pass (website spec
 * W42): the map opens fitted to the active zones, outlined with their names; "Orders on the road" sits
 * beside the map from 1280 px and above it below that, so it is never under the fold; one muted line
 * says when no driver has sent a position, and a row without one says "No position". The positions come
 * from the `/drivers` socket and the orders from the board's In progress list.
 */

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
  const lt = useLegacyT();
  const { drivers } = useDriversSocket();
  const zones = useZoneOutlines();
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ['orders', 'live-map'],
    queryFn: async () => (await api.get<OrderBoardDto>('/orders/board', { params: { tab: 'in-progress', limit: 100 } })).data.items,
    refetchInterval: 15000,
  });

  const focused = focusedDriverId ? drivers[focusedDriverId] : null;
  const focusPoint = focused ? { lat: focused.lat, lng: focused.lng } : null;
  const driverList = Object.values(drivers);
  const bounds = useMemo(() => zonesBounds(zones.data ?? []), [zones.data]);
  const anyPosition = (orders.data ?? []).some((order) => order.trip && drivers[order.trip.driver.id]);

  const focusOnDriver = (driverId: string | undefined | null) => {
    if (!driverId || !drivers[driverId]) return;
    setFocusedDriverId(driverId);
  };

  const columns: TableColumn<OrderDto>[] = [
    {
      id: 'order',
      header: lt('live.columns.order'),
      cell: (order) => (
        <span className="sf-legacy__two-line">
          <span className="sf-legacy__chips">
            <span className="sf-record-no">{order.shortCode}</span>
            <StatusChip kind="order" value={order.stage} />
          </span>
          <span className="sf-legacy__muted">{order.client.name}</span>
        </span>
      ),
    },
    {
      id: 'driver',
      header: lt('live.columns.driver'),
      cell: (order) => {
        if (!order.trip) return <span className="sf-legacy__muted">—</span>;
        const located = Boolean(drivers[order.trip.driver.id]);
        return (
          <span className="sf-legacy__two-line">
            <span>{lt('live.driverVan', { driver: order.trip.driver.name, plate: order.trip.vehicle.plateNo })}</span>
            {located ? null : <span className="sf-legacy__muted">{lt('live.noPosition')}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="sf-legacy-page">
      <PageHeader
        title={lt('live.title')}
        secondaryActions={
          focusedDriverId ? (
            <Button variant="ghost" onClick={() => setFocusedDriverId(null)}>
              {lt('live.showEveryone')}
            </Button>
          ) : null
        }
      />
      {driverList.length === 0 ? <p className="sf-legacy__muted sf-live__status">{lt('live.noPositions')}</p> : null}
      <div className="sf-live">
        <section className="sf-live__list" aria-label={lt('live.listTitle')}>
          <h2 className="sf-live__heading">{lt('live.listTitle')}</h2>
          {anyPosition ? <p className="sf-legacy__muted">{lt('live.hint')}</p> : null}
          <Table<OrderDto>
            caption={lt('live.listTitle')}
            columns={columns}
            rows={orders.data}
            rowKey={(order) => order.id}
            onRowClick={(order) => focusOnDriver(order.trip?.driver.id)}
            canOpenRow={(order) => Boolean(order.trip && drivers[order.trip.driver.id])}
            selectedKey={
              focusedDriverId ? ((orders.data ?? []).find((order) => order.trip?.driver.id === focusedDriverId)?.id ?? null) : null
            }
            state={orders.isPending ? 'loading' : orders.isError && !orders.data ? 'error' : 'ready'}
            skeletonRows={3}
            empty={<EmptyState compact title={lt('live.empty')} />}
            error={
              <ErrorState
                compact
                error={orders.error}
                title={lt('live.loadFailed')}
                onRetry={() => void orders.refetch()}
                retrying={orders.isFetching}
              />
            }
          />
        </section>
        <div className="sf-live__map">
          <MapContainer center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]} zoom={12} className="sf-live__canvas">
            <TileLayer url={OSM_TILES} attribution={OSM_CREDIT} />
            <ZoneLayer zones={zones.data ?? []} />
            <FitToZones bounds={bounds} enabled />
            <MapFocuser focus={focusPoint} />
            {driverList.map((d: DriverLocation) => {
              const isFocused = d.driverId === focusedDriverId;
              return (
                // Leaflet sets a marker's class only when it is created, so a change of focus makes a new one.
                <CircleMarker
                  key={`${d.driverId}-${isFocused ? 'focus' : 'plain'}`}
                  center={[d.lat, d.lng]}
                  radius={isFocused ? 12 : 9}
                  pathOptions={{ className: isFocused ? 'sf-map__pin sf-map__pin--focus' : 'sf-map__pin' }}
                  eventHandlers={{ click: () => setFocusedDriverId(d.driverId) }}
                >
                  <Popup>
                    <strong>{d.name ?? lt('live.driver')}</strong>
                    <br />
                    {lt('live.positionAt', { time: formatTime(d.at) })}
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
