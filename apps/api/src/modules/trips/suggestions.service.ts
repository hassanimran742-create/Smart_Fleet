import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SuggestedTask = {
  kind: 'ORDER' | 'FILLING' | 'TRANSFER';
  id: string;
  tripId?: string;
  orderId?: string;
  title: string;
  subtitle: string;
  status: string;
  distanceKm: number;
  onYourRoute: boolean;
  lat: number;
  lng: number;
};

/**
 * Ranks the driver's open tasks (delivery orders, filling orders,
 * transfer cylinders) by proximity to the driver's current location.
 *
 * Algorithm (greedy, v1):
 *   1. Pull every open task assigned to me + its location.
 *   2. Compute great-circle distance from my last known location.
 *   3. Sort ascending.
 *   4. If I'm already on a trip, mark a task as "onYourRoute" when its
 *      bearing from my position is within ±60° of the bearing of my
 *      next planned stop — that means I'd barely deviate to pick it up.
 *   5. Return the top N. The driver app shows the result as
 *      "do this next — it's only 0.8 km out of your way".
 *
 * A real VRP solver (OR-Tools) is the v2 upgrade; this heuristic is
 * good enough for ≤ ~20 simultaneous tasks per driver.
 */
@Injectable()
export class SuggestionsService {
  constructor(private prisma: PrismaService) {}

  async forDriver(driverId: string, limit = 5): Promise<SuggestedTask[]> {
    const driverRows: { lat: number | null; lng: number | null }[] = await this.prisma.$queryRaw`
      SELECT ST_Y(current_location) AS lat, ST_X(current_location) AS lng
      FROM drivers
      WHERE id = ${driverId}::uuid
    `;
    const loc = driverRows[0];
    if (!loc?.lat || !loc?.lng) return [];
    const driverLat = loc.lat, driverLng = loc.lng;

    // 1) Pending / in-progress delivery orders on my active trips
    const orderRows: Array<{
      order_id: string;
      trip_id: string;
      client_name: string;
      address_label: string;
      status: string;
      lat: number;
      lng: number;
    }> = await this.prisma.$queryRaw`
      SELECT o.id AS order_id,
             t.id AS trip_id,
             c.name AS client_name,
             o.delivery_address_label AS address_label,
             o.status::text AS status,
             ST_Y(o.delivery_address) AS lat,
             ST_X(o.delivery_address) AS lng
      FROM orders o
      JOIN trips t ON t.id = o.trip_id
      JOIN clients c ON c.id = o.client_id
      WHERE t.driver_id = ${driverId}::uuid
        AND o.status IN ('PENDING','CONFIRMED','ASSIGNED','IN_TRANSIT')
    `;

    // 2) Filling orders directly assigned to me (pickup at store location)
    const fillingRows: Array<{
      id: string;
      station_name: string | null;
      requested_count: number;
      status: string;
      lat: number | null;
      lng: number | null;
    }> = await this.prisma.$queryRaw`
      SELECT fo.id AS id,
             fs.name AS station_name,
             fo.requested_count AS requested_count,
             fo.status::text AS status,
             ST_Y(s.location) AS lat,
             ST_X(s.location) AS lng
      FROM filling_orders fo
      LEFT JOIN filling_stations fs ON fs.id = fo.filling_station_id
      LEFT JOIN stores s ON s.id = fo.pickup_store_id
      WHERE fo.assigned_driver_id = ${driverId}::uuid
        AND fo.status NOT IN ('COMPLETED','CANCELLED','FAILED')
    `;

    // 3) Transfers assigned to me — use whichever store is the *next* stop
    //    (fromStore if we still need to pick up there; otherwise toStore).
    const transferRows: Array<{
      id: string;
      from_store_id: string;
      to_store_id: string;
      from_name: string;
      to_name: string;
      status: string;
      from_lat: number;
      from_lng: number;
      to_lat: number;
      to_lng: number;
      at_from: number;
      on_vehicle: number;
    }> = await this.prisma.$queryRaw`
      SELECT t.id AS id,
             t.from_store_id, t.to_store_id,
             fs.name AS from_name, ts.name AS to_name,
             t.status::text AS status,
             ST_Y(fs.location) AS from_lat, ST_X(fs.location) AS from_lng,
             ST_Y(ts.location) AS to_lat, ST_X(ts.location) AS to_lng,
             COUNT(*) FILTER (WHERE c.custody_type = 'STORE' AND c.custody_id = t.from_store_id)::int AS at_from,
             COUNT(*) FILTER (WHERE c.custody_type = 'VEHICLE')::int AS on_vehicle
      FROM transfers t
      JOIN stores fs ON fs.id = t.from_store_id
      JOIN stores ts ON ts.id = t.to_store_id
      LEFT JOIN transfer_lines tl ON tl.transfer_id = t.id
      LEFT JOIN cylinders c ON c.id = tl.cylinder_id
      WHERE t.driver_id = ${driverId}::uuid
        AND t.status IN ('REQUESTED','IN_TRANSIT')
      GROUP BY t.id, fs.name, ts.name, fs.location, ts.location
    `;

    // Find next planned stop (for the "on your route" bearing check).
    const nextStopRows: Array<{ lat: number; lng: number }> = await this.prisma.$queryRaw`
      SELECT ST_Y(ts.location) AS lat, ST_X(ts.location) AS lng
      FROM trip_stops ts
      JOIN trips t ON t.id = ts.trip_id
      WHERE t.driver_id = ${driverId}::uuid
        AND t.status = 'IN_PROGRESS'
        AND ts.arrived_at IS NULL
      ORDER BY ts.seq ASC
      LIMIT 1
    `;
    const heading = nextStopRows[0]
      ? bearing(driverLat, driverLng, nextStopRows[0].lat, nextStopRows[0].lng)
      : null;

    const out: SuggestedTask[] = [];

    for (const r of orderRows) {
      const dist = haversineKm(driverLat, driverLng, r.lat, r.lng);
      out.push({
        kind: 'ORDER',
        id: r.order_id,
        tripId: r.trip_id,
        orderId: r.order_id,
        title: r.client_name,
        subtitle: r.address_label,
        status: r.status,
        distanceKm: round(dist),
        onYourRoute: isOnRoute(heading, bearing(driverLat, driverLng, r.lat, r.lng)),
        lat: r.lat, lng: r.lng,
      });
    }
    for (const r of fillingRows) {
      if (r.lat == null || r.lng == null) continue;
      const dist = haversineKm(driverLat, driverLng, r.lat, r.lng);
      out.push({
        kind: 'FILLING',
        id: r.id,
        title: `Refill · ${r.station_name ?? 'station'}`,
        subtitle: `${r.requested_count} cylinder${r.requested_count === 1 ? '' : 's'}`,
        status: r.status,
        distanceKm: round(dist),
        onYourRoute: isOnRoute(heading, bearing(driverLat, driverLng, r.lat, r.lng)),
        lat: r.lat, lng: r.lng,
      });
    }
    for (const r of transferRows) {
      const useFrom = r.at_from > 0;
      const lat = useFrom ? r.from_lat : r.to_lat;
      const lng = useFrom ? r.from_lng : r.to_lng;
      const dist = haversineKm(driverLat, driverLng, lat, lng);
      out.push({
        kind: 'TRANSFER',
        id: r.id,
        title: useFrom ? `Pick up @ ${r.from_name}` : `Drop off @ ${r.to_name}`,
        subtitle: `Transfer ${r.from_name} → ${r.to_name}`,
        status: r.status,
        distanceKm: round(dist),
        onYourRoute: isOnRoute(heading, bearing(driverLat, driverLng, lat, lng)),
        lat, lng,
      });
    }

    // Sort: on-route first, then by distance.
    out.sort((a, b) => {
      if (a.onYourRoute && !b.onYourRoute) return -1;
      if (!a.onYourRoute && b.onYourRoute) return 1;
      return a.distanceKm - b.distanceKm;
    });
    return out.slice(0, limit);
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// "On route" = within ±60° of the heading toward the next planned stop.
// 60° is permissive on purpose — Pakistani city roads rarely run perfectly
// straight, so a strict ±30° rejects too many genuinely-en-route tasks.
function isOnRoute(heading: number | null, taskBearing: number): boolean {
  if (heading == null) return false;
  let diff = Math.abs(heading - taskBearing) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= 60;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
