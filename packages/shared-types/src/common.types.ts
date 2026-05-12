export type UUID = string;
export type ISODateString = string;

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Address {
  label: string;
  location: GeoPoint;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type Paisa = number; // 1 PKR = 100 paisa, integer cents
