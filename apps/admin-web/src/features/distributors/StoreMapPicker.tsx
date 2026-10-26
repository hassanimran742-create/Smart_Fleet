import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds, type LatLngBounds, type LatLngExpression, type Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CircleAlert, CircleCheck, Crosshair, LoaderCircle } from 'lucide-react';
import type { ZoneListRow } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { Button, cx, Field, SearchSelect } from '../../ui';
import { useAllAreas, useDistributors, useZoneOutlines, type GeoPin } from './api';
import type { PinZone } from './pinZone';
import './distributors.css';

/** Where the map opens when no zone and no pin is known (Islamabad). */
export const DEFAULT_MAP_CENTER: GeoPin = { lat: 33.6844, lng: 73.0479 };
/** Street level: a store's own pin (website spec W20, W22). */
const PIN_ZOOM = 16;
export const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_CREDIT = '&copy; OpenStreetMap contributors';

/** A zone's outline as Leaflet positions (`[lat, lng]`), from its GeoJSON MultiPolygon (`[lng, lat]`). */
function outlineOf(zone: ZoneListRow): LatLngExpression[][][] {
  return (zone.polygon?.coordinates ?? []).map((polygon) =>
    polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LatLngExpression)),
  );
}

/** The zone's centre as `[lat, lng]`, or null. */
function centreOf(zone: ZoneListRow): [number, number] | null {
  const point = zone.centroid?.coordinates;
  return point && point.length >= 2 ? [point[1], point[0]] : null;
}

/** The box around every zone (outlines, else centres), or null when there is no zone. */
export function zonesBounds(zones: readonly ZoneListRow[]): LatLngBounds | null {
  const points: [number, number][] = [];
  for (const zone of zones) {
    for (const polygon of zone.polygon?.coordinates ?? []) {
      for (const ring of polygon) for (const [lng, lat] of ring) points.push([lat, lng]);
    }
    if (!zone.polygon?.coordinates?.length) {
      const centre = centreOf(zone);
      if (centre) points.push(centre);
    }
  }
  return points.length > 0 ? latLngBounds(points) : null;
}

function ClickToPin({ onPick, disabled }: { onPick: (pin: GeoPin) => void; disabled: boolean }) {
  useMapEvents({
    click(event) {
      if (!disabled) onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function FlyTo({ target }: { target: (GeoPin & { key: number }) | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, target]);
  return null;
}

/**
 * Opens the map fitted to the active zones (website spec W19: never on a fixed city), once the zones
 * have loaded, unless a pin already shows where to look.
 */
export function FitToZones({ bounds, enabled }: { bounds: LatLngBounds | null; enabled: boolean }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !enabled || !bounds) return;
    done.current = true;
    map.fitBounds(bounds, { padding: [16, 16] });
  }, [bounds, enabled, map]);
  return null;
}

/** Hands the map out (for "Pin at map centre") and fixes its size once a drawer has slid in. */
function MapHandle({ mapRef }: { mapRef: MutableRefObject<LeafletMap | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    const id = window.setTimeout(() => map.invalidateSize(), 250);
    return () => {
      window.clearTimeout(id);
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

/** The active zones, shaded with their names, so the office sees where a store pin can go. */
export function ZoneLayer({ zones, labels = true }: { zones: readonly ZoneListRow[]; labels?: boolean }) {
  return (
    <>
      {zones.map((zone) => {
        const outline = outlineOf(zone);
        if (outline.length > 0) {
          return (
            <Polygon key={zone.id} positions={outline} pathOptions={{ className: 'sf-map__zone', interactive: false }}>
              {labels ? (
                <Tooltip permanent direction="center" className="sf-map__zone-label">
                  {zone.name}
                </Tooltip>
              ) : null}
            </Polygon>
          );
        }
        // No outline sent: the zone's name at its centre (website spec O4).
        const centre = centreOf(zone);
        return centre && labels ? (
          <CircleMarker key={zone.id} center={centre} radius={3} pathOptions={{ className: 'sf-map__zone-centre', interactive: false }}>
            <Tooltip permanent direction="top" className="sf-map__zone-label">
              {zone.name}
            </Tooltip>
          </CircleMarker>
        ) : null;
      })}
    </>
  );
}

export interface StoreMapPickerProps {
  value: GeoPin | null;
  onChange: (pin: GeoPin) => void;
  zone: PinZone;
  /** An error for the pin (no pin on submit, or `STORE_OUTSIDE_ZONES` from the server). */
  error?: string | null;
  /** The distributor being edited: its own store isn't drawn as one of the "other stores". */
  distributorId?: string;
  /** Draw the stores as grey dots (the store pickers); off for a refill station's pin. */
  showStores?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The store's pin (UX_ADMIN §2.4, website spec W19 and W22): "Find area" (every city's areas in one
 * search box) moves a 280 px map that opens fitted to the active zones, shaded with their names, with
 * the other stores as small grey dots; a click drops the pin. Under the map, the zone line from
 * `GET /zones/locate` ("Zone: North", or the outside-every-zone warning), and "Pin at map centre" for
 * keyboard users, who pan with the arrow keys.
 */
export function StoreMapPicker({
  value,
  onChange,
  zone,
  error,
  distributorId,
  showStores = true,
  disabled = false,
  className,
}: StoreMapPickerProps) {
  const { t } = useTranslation('distributors');
  const { areas, loading: areasLoading } = useAllAreas();
  const zones = useZoneOutlines();
  const distributors = useDistributors();
  const [area, setArea] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<(GeoPin & { key: number }) | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const statusId = useId();
  const [start] = useState(() => value);

  const areaOptions = useMemo(
    () =>
      areas.map((row) => ({
        value: `${row.city}|${row.name}`,
        label: t('map.areaOption', { area: row.name, city: row.city }),
      })),
    [areas, t],
  );
  const bounds = useMemo(() => zonesBounds(zones.data ?? []), [zones.data]);
  const otherStores = useMemo(
    () => (showStores ? (distributors.data ?? []).filter((d) => d.store && d.id !== distributorId).map((d) => d.store!) : []),
    [distributors.data, distributorId, showStores],
  );

  const findArea = (picked: string | null) => {
    setArea(picked);
    const row = areas.find((candidate) => `${candidate.city}|${candidate.name}` === picked);
    if (row) setFlyTarget({ lat: row.lat, lng: row.lng, key: Date.now() });
  };

  const pinCentre = () => {
    const map = mapRef.current;
    if (!map || disabled) return;
    const c = map.getCenter();
    onChange({ lat: c.lat, lng: c.lng });
  };

  let status = null;
  switch (zone.status) {
    case 'none':
      status = error ? (
        <p className="sf-map__status is-error">
          <CircleAlert aria-hidden size={16} />
          {error}
        </p>
      ) : null;
      break;
    case 'loading':
      status = (
        <p className="sf-map__status">
          <LoaderCircle aria-hidden size={16} className="sf-map__spin" />
          {t('map.locating')}
        </p>
      );
      break;
    case 'found':
      status = (
        <p className="sf-map__status is-found">
          <CircleCheck aria-hidden size={16} />
          {t('map.zone', { zone: zone.zone.name })}
        </p>
      );
      break;
    case 'outside':
      status = (
        <p className="sf-map__status is-error">
          <CircleAlert aria-hidden size={16} />
          {t('map.outside')}
        </p>
      );
      break;
    case 'error':
      status = <p className="sf-map__status is-warning">{t('map.locateFailed')}</p>;
      break;
  }

  return (
    <div className={cx('sf-map', className)}>
      <Field label={t('map.jump')} className="sf-map__find">
        <SearchSelect
          options={areaOptions}
          value={area}
          onChange={findArea}
          placeholder={!areasLoading && areaOptions.length === 0 ? t('map.areasNone') : t('map.findPlaceholder')}
          loading={areasLoading}
          disabled={disabled}
        />
      </Field>
      <div className="sf-map__frame" role="region" aria-label={t('map.region')} aria-describedby={statusId}>
        <MapContainer
          center={start ? [start.lat, start.lng] : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]}
          zoom={start ? PIN_ZOOM : 12}
          className="sf-map__canvas"
          scrollWheelZoom
        >
          <TileLayer url={OSM_TILES} attribution={OSM_CREDIT} />
          <ZoneLayer zones={zones.data ?? []} />
          {otherStores.map((store) => (
            <CircleMarker
              key={store.id}
              center={[store.lat, store.lng]}
              radius={4}
              pathOptions={{ className: 'sf-map__store', interactive: false }}
            />
          ))}
          <ClickToPin onPick={onChange} disabled={disabled} />
          <FitToZones bounds={bounds} enabled={!start} />
          <FlyTo target={flyTarget} />
          <MapHandle mapRef={mapRef} />
          {value ? <CircleMarker center={[value.lat, value.lng]} radius={9} pathOptions={{ className: 'sf-map__pin' }} /> : null}
        </MapContainer>
      </div>
      <div className="sf-map__below">
        <div id={statusId} className="sf-map__status-wrap" aria-live="polite">
          {status}
          {error && zone.status !== 'none' && zone.status !== 'outside' ? (
            <p className="sf-map__status is-error">
              <CircleAlert aria-hidden size={16} />
              {error}
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" icon={Crosshair} onClick={pinCentre} disabled={disabled}>
          {t('map.pinCentre')}
        </Button>
      </div>
    </div>
  );
}

export interface StoreThumbnailProps {
  lat: number;
  lng: number;
  /** Read out for the picture, for example "Map of Ali Gas store". */
  label: string;
}

/** A small map of the store's pin at street level, with the zone outline, that doesn't move. */
export function StoreThumbnail({ lat, lng, label }: StoreThumbnailProps) {
  const zones = useZoneOutlines();
  return (
    <div className="sf-dist-card__map" role="img" aria-label={label}>
      <MapContainer
        center={[lat, lng]}
        zoom={PIN_ZOOM}
        className="sf-map__canvas sf-map__canvas--thumb"
        dragging={false}
        zoomControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url={OSM_TILES} attribution={OSM_CREDIT} />
        <ZoneLayer zones={zones.data ?? []} labels={false} />
        <CircleMarker center={[lat, lng]} radius={8} pathOptions={{ className: 'sf-map__pin', interactive: false }} />
      </MapContainer>
    </div>
  );
}
