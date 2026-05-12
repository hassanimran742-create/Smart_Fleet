export interface RouteLeg {
  distanceKm: number;
  durationSec: number;
}

export interface RoutingProvider {
  matrix(
    origins: Array<{ lat: number; lng: number }>,
    destinations: Array<{ lat: number; lng: number }>,
  ): Promise<RouteLeg[][]>;
  route(
    waypoints: Array<{ lat: number; lng: number }>,
  ): Promise<{ distanceKm: number; durationSec: number; polyline?: string }>;
}
