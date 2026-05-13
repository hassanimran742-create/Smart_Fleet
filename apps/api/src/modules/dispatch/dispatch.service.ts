import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertSeverity, AlertType, OrderStatus, TripStatus, TripStopType } from '@prisma/client';
import { haversineKm } from '@smartfleet/shared-utils';
import { AlertsService } from '../alerts/alerts.service';

interface Candidate {
  storeId: string;
  storeLocation: { lat: number; lng: number };
  vehicleId: string;
  vehicleCapacity: number;
  driverId: string;
  driverLocation: { lat: number; lng: number };
  driverZoneId: string | null;
  score: number;
}

const W = {
  storeToDriver: 4,
  storeToClient: 3,
  routeDeviation: 5,
  capacityFit: 1.5,
  sameZonePref: 2,
  postpone: 2.5,
};

@Injectable()
export class DispatchService {
  private logger = new Logger(DispatchService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
  ) {}

  async dispatchOrder(orderId: string): Promise<{ tripId: string } | { error: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (!order || order.status !== OrderStatus.PENDING) {
      return { error: 'ORDER_NOT_PENDING' };
    }
    const delivery: any = await this.prisma.$queryRaw`
      SELECT ST_Y(delivery_address) AS lat, ST_X(delivery_address) AS lng
      FROM orders WHERE id = ${orderId}::uuid
    `;
    const dest = { lat: delivery[0].lat, lng: delivery[0].lng };

    const orderUnits = await this.unitsFor(order.lines);

    const candidates: Candidate[] = await this.gatherCandidates(order, dest);
    if (!candidates.length) {
      this.logger.warn(`No eligible candidates for order ${orderId}`);
      await this.alerts.raise({
        alertType: AlertType.DISPATCH_NO_CANDIDATE,
        severity: AlertSeverity.CRITICAL,
        title: 'Order has no eligible driver',
        body: `Order ${orderId.slice(0, 8)} could not be dispatched — no driver with stock + capacity is currently online.`,
        resourceType: 'Order',
        resourceId: orderId,
        dedupeKey: { resourceType: 'Order', resourceId: orderId, alertType: AlertType.DISPATCH_NO_CANDIDATE },
      });
      return { error: 'NO_ELIGIBLE_CANDIDATE' };
    }

    for (const c of candidates) {
      const dStoreToDriver = haversineKm(c.driverLocation, c.storeLocation);
      const dStoreToClient = haversineKm(c.storeLocation, dest);
      const dDriverDirect = haversineKm(c.driverLocation, dest);
      const deviation = Math.max(0, dStoreToDriver + dStoreToClient - dDriverDirect);
      const capacityFit = orderUnits / c.vehicleCapacity;
      const sameZone = c.driverZoneId === order.destZoneId ? 0 : 1;

      c.score =
        W.storeToDriver * dStoreToDriver +
        W.storeToClient * dStoreToClient +
        W.routeDeviation * deviation +
        W.capacityFit * (1 - capacityFit) +
        W.sameZonePref * sameZone;
    }

    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];

    const trip = await this.prisma.$transaction(async (tx) => {
      const t = await tx.trip.create({
        data: {
          driverId: best.driverId,
          vehicleId: best.vehicleId,
          originStoreId: best.storeId,
          status: TripStatus.PLANNED,
        },
      });
      await tx.$executeRaw`
        INSERT INTO trip_stops (id, trip_id, seq, stop_type, location)
        VALUES (
          gen_random_uuid(), ${t.id}::uuid, 0, 'STORE_PICKUP',
          ST_SetSRID(ST_MakePoint(${best.storeLocation.lng}, ${best.storeLocation.lat}), 4326)
        )
      `;
      await tx.$executeRaw`
        INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, location)
        VALUES (
          gen_random_uuid(), ${t.id}::uuid, ${order.id}::uuid, 1, 'DELIVERY',
          ST_SetSRID(ST_MakePoint(${dest.lng}, ${dest.lat}), 4326)
        )
      `;
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.ASSIGNED, tripId: t.id, originStoreId: best.storeId },
      });
      return t;
    });

    return { tripId: trip.id };
  }

  private async unitsFor(
    lines: { cylinderTypeId: string; fullCount: number }[],
  ): Promise<number> {
    const types = await this.prisma.cylinderType.findMany({
      where: { id: { in: lines.map((l) => l.cylinderTypeId) } },
    });
    const tMap = new Map(types.map((t) => [t.id, t.capacityUnits]));
    return lines.reduce((s, l) => s + (tMap.get(l.cylinderTypeId) ?? 1) * l.fullCount, 0);
  }

  private async gatherCandidates(
    order: { distributorId: string; lines: { cylinderTypeId: string; fullCount: number }[] },
    dest: { lat: number; lng: number },
  ): Promise<Candidate[]> {
    // 1) Stores carrying enough stock per distributor + cylinder type
    // For multi-line orders, store must satisfy every line.
    const storesPerLine = await Promise.all(
      order.lines.map((line) =>
        this.prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>`
          SELECT s.id, ST_Y(s.location) AS lat, ST_X(s.location) AS lng
          FROM stores s
          JOIN inventory_lots il
            ON il.holder_type = 'STORE' AND il.holder_id = s.id
           AND il.distributor_id = ${order.distributorId}::uuid
           AND il.cylinder_type_id = ${line.cylinderTypeId}::uuid
           AND il.state = 'FULL'
           AND il.count >= ${line.fullCount}
          WHERE s.is_active = TRUE
        `,
      ),
    );
    // intersect store IDs across lines
    if (!storesPerLine[0]) return [];
    let eligibleStoreIds = new Set(storesPerLine[0].map((s) => s.id));
    for (let i = 1; i < storesPerLine.length; i++) {
      const ids = new Set(storesPerLine[i].map((s) => s.id));
      eligibleStoreIds = new Set([...eligibleStoreIds].filter((x) => ids.has(x)));
    }
    if (eligibleStoreIds.size === 0) return [];

    const storeLocs = new Map(storesPerLine[0].map((s) => [s.id, { lat: s.lat, lng: s.lng }]));

    // 2) Online drivers with assigned vehicles
    const drivers: { driver_id: string; vehicle_id: string; capacity_units: number; zone_id: string | null; lat: number; lng: number }[] =
      await this.prisma.$queryRaw`
        SELECT d.id AS driver_id, v.id AS vehicle_id, v.capacity_units, d.current_zone_id AS zone_id,
               ST_Y(d.current_location) AS lat, ST_X(d.current_location) AS lng
        FROM drivers d
        JOIN vehicles v ON v.id = d.current_vehicle_id AND v.status = 'ACTIVE'
        WHERE d.is_online = TRUE
          AND d.current_location IS NOT NULL
      `;

    const out: Candidate[] = [];
    for (const d of drivers) {
      for (const sid of eligibleStoreIds) {
        const loc = storeLocs.get(sid)!;
        out.push({
          storeId: sid,
          storeLocation: loc,
          vehicleId: d.vehicle_id,
          vehicleCapacity: d.capacity_units,
          driverId: d.driver_id,
          driverLocation: { lat: d.lat, lng: d.lng },
          driverZoneId: d.zone_id,
          score: 0,
        });
      }
    }
    return out;
  }
}
