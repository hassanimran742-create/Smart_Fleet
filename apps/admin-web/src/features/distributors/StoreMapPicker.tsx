import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, LoaderCircle, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cx, Field, InlineAlert, Select } from '../../ui';
import { useCities, useCityAreas, type GeoPin } from './api';
import type { PinZone } from './pinZone';
import './distributors.css';

/** Where the map opens without a pin (Islamabad, as the zones screen does). */
export const DEFAULT_MAP_CENTER: GeoPin = { lat: 33.6844, lng: 73.0479 };
const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_CREDIT = '&copy; OpenStreetMap contributors';

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

/** Hands the map out (for "Put the pin at the centre") and fixes its size once a drawer has slid in. */
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

export interface StoreMapPickerProps {
  value: GeoPin | null;
  onChange: (pin: GeoPin) => void;
  zone: PinZone;
  /** An error for the pin (no pin on submit, or `STORE_OUTSIDE_ZONES` from the server). */
  error?: string | null;
  disabled?: boolean;
  className?: string;
}

/**
 * The store's pin (UX_ADMIN §2.4): a 280 px map where a click drops the pin, "Jump to area" (cities and
 * their reference areas) to move the map, and the read-only zone line from `GET /zones/locate`:
 * "Zone: G-9 (from the pin)", or the outside-every-zone warning. Keyboard users pan with the arrow keys
 * and put the pin at the centre with the button.
 */
export function StoreMapPicker({ value, onChange, zone, error, disabled = false, className }: StoreMapPickerProps) {
  const { t } = useTranslation('distributors');
  const cities = useCities();
  const [cityName, setCityName] = useState<string | null>(null);
  const areas = useCityAreas(cityName);
  const [areaName, setAreaName] = useState('');
  const [flyTarget, setFlyTarget] = useState<(GeoPin & { key: number }) | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const statusId = useId();
  const [center] = useState<GeoPin>(() => value ?? DEFAULT_MAP_CENTER);

  const cityOptions = useMemo(
    () => (cities.data ?? []).map((city) => ({ value: city.name, label: city.name })),
    [cities.data],
  );
  const areaOptions = useMemo(
    () => (areas.data ?? []).map((area) => ({ value: area.name, label: area.name })),
    [areas.data],
  );

  const jumpToArea = (name: string) => {
    setAreaName(name);
    const area = areas.data?.find((row) => row.name === name);
    if (area) setFlyTarget({ lat: area.lat, lng: area.lng, key: Date.now() });
  };

  const pinCentre = () => {
    const map = mapRef.current;
    if (!map || disabled) return;
    const c = map.getCenter();
    onChange({ lat: c.lat, lng: c.lng });
  };

  let status;
  switch (zone.status) {
    case 'none':
      status = <p className={cx('sf-map__status', error && 'is-error')}>{error ?? t('map.noPin')}</p>;
      break;
    case 'loading':
      status = (
        <p className="sf-map__status">
          <LoaderCircle aria-hidden size={14} className="sf-map__spin" />
          {t('map.locating')}
        </p>
      );
      break;
    case 'found':
      status = (
        <p className="sf-map__status is-found">
          <MapPin aria-hidden size={14} />
          {t('map.zone', { zone: zone.zone.name })}
        </p>
      );
      break;
    case 'outside':
      status = <InlineAlert tone="danger">{t('map.outside')}</InlineAlert>;
      break;
    case 'error':
      status = <p className="sf-map__status is-warning">{t('map.locateFailed')}</p>;
      break;
  }

  return (
    <div className={cx('sf-map', className)}>
      <div className="sf-map__jump">
        <span className="sf-map__jump-title">{t('map.jump')}</span>
        <Field label={t('map.city')} labelHidden>
          <Select
            value={cityName ?? ''}
            placeholder={t('map.pickCity')}
            options={cityOptions}
            disabled={disabled}
            onChange={(event) => {
              setCityName(event.target.value || null);
              setAreaName('');
            }}
          />
        </Field>
        <Field label={t('map.area')} labelHidden>
          <Select
            value={areaName}
            placeholder={cityName && areas.data?.length === 0 ? t('map.areasNone') : t('map.pickArea')}
            options={areaOptions}
            disabled={disabled || !cityName || !areas.data?.length}
            onChange={(event) => jumpToArea(event.target.value)}
          />
        </Field>
      </div>
      <div className="sf-map__frame" role="region" aria-label={t('map.region')} aria-describedby={statusId}>
        <MapContainer center={[center.lat, center.lng]} zoom={value ? 15 : 12} className="sf-map__canvas" scrollWheelZoom>
          <TileLayer url={OSM_TILES} attribution={OSM_CREDIT} />
          <ClickToPin onPick={onChange} disabled={disabled} />
          <FlyTo target={flyTarget} />
          <MapHandle mapRef={mapRef} />
          {value ? <CircleMarker center={[value.lat, value.lng]} radius={9} className="sf-map__pin" /> : null}
        </MapContainer>
      </div>
      <div className="sf-map__below">
        <div id={statusId} className="sf-map__status-wrap" aria-live="polite">
          {status}
          {error && zone.status !== 'none' ? <p className="sf-map__status is-error">{error}</p> : null}
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

/** A small map of the store's pin that doesn't move (the distributor page's Store card). */
export function StoreThumbnail({ lat, lng, label }: StoreThumbnailProps) {
  return (
    <div className="sf-dist-card__map" role="img" aria-label={label}>
      <MapContainer
        center={[lat, lng]}
        zoom={15}
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
        <CircleMarker center={[lat, lng]} radius={8} className="sf-map__pin" />
      </MapContainer>
    </div>
  );
}
