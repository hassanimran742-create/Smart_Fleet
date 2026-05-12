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
