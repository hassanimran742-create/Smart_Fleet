import type { GeoPoint, UUID } from './common.types';

export interface City {
  id: UUID;
  name: string;
  countryCode: string;
}

export interface Zone {
  id: UUID;
  cityId: UUID;
  name: string;
  centroid: GeoPoint;
  isActive: boolean;
  // polygon is GeoJSON MultiPolygon when serialised over the wire
  polygon?: GeoJSON.MultiPolygon;
}

/**
 * One row of `GET /zones/city/:cityId` (API_CONTRACT §7.2), in name order. The legacy snake_case shape
 * installed apps read. `polygon` (the outline) and `centroid` are GeoJSON with `[lng, lat]` positions, so
 * a map can draw each zone and fit itself to the zones. Every zone the API writes has a centroid; the
 * column allows null for older rows.
 */
export interface ZoneListRow {
  id: UUID;
  city_id: UUID;
  name: string;
  centroid: GeoJSON.Point | null;
  polygon: GeoJSON.MultiPolygon;
  is_active: boolean;
}
