import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async ordersByZone(cityId: string, since: Date) {
    return this.prisma.$queryRaw`
      SELECT z.id AS zone_id, z.name, COUNT(o.id)::int AS order_count,
             COALESCE(SUM(o.delivery_fee_paisa), 0)::bigint AS revenue_paisa
      FROM zones z
      LEFT JOIN orders o ON o.dest_zone_id = z.id AND o.created_at >= ${since}
      WHERE z.city_id = ${cityId}::uuid
      GROUP BY z.id, z.name
      ORDER BY order_count DESC
    `;
  }

  async driverUtilization(since: Date) {
    return this.prisma.$queryRaw`
      SELECT d.id AS driver_id, u.name,
             COUNT(t.id)::int AS trips_count,
             COUNT(o.id)::int AS orders_delivered
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN trips t ON t.driver_id = d.id AND t.completed_at >= ${since}
      LEFT JOIN orders o ON o.trip_id = t.id AND o.status = 'DELIVERED'
      GROUP BY d.id, u.name
    `;
  }

  /**
   * Compute per-driver attendance over [since, until] by summing shift
   * durations. Open shifts (driver still online) count up to "until"
   * (or "now" if until is in the future).
   */
  async driverAttendance(since: Date, until: Date) {
    const shifts = await this.prisma.driverShift.findMany({
      where: {
        startedAt: { lte: until },
        OR: [{ endedAt: null }, { endedAt: { gte: since } }],
      },
      include: { driver: { include: { user: true } } },
    });

    type Bucket = {
      driverId: string;
      name: string;
      availability: string;
      totalMinutes: number;
      daysWorked: Set<string>;
      lastShiftEndedAt: Date | null;
    };
    const byDriver = new Map<string, Bucket>();
    const cap = until.getTime() < Date.now() ? until : new Date();

    for (const s of shifts) {
      const startMs = Math.max(s.startedAt.getTime(), since.getTime());
      const endMs = Math.min((s.endedAt ?? cap).getTime(), cap.getTime());
      if (endMs <= startMs) continue;
      const minutes = (endMs - startMs) / 60000;
      const day = new Date(startMs).toISOString().slice(0, 10);

      const existing =
        byDriver.get(s.driverId) ??
        ({
          driverId: s.driverId,
          name: s.driver.user.name,
          availability: s.driver.availability,
          totalMinutes: 0,
          daysWorked: new Set<string>(),
          lastShiftEndedAt: null,
        } as Bucket);
      existing.totalMinutes += minutes;
      existing.daysWorked.add(day);
      if (s.endedAt && (!existing.lastShiftEndedAt || s.endedAt > existing.lastShiftEndedAt)) {
        existing.lastShiftEndedAt = s.endedAt;
      }
      byDriver.set(s.driverId, existing);
    }

    const allDrivers = await this.prisma.driver.findMany({ include: { user: true } });
    for (const d of allDrivers) {
      if (!byDriver.has(d.id)) {
        byDriver.set(d.id, {
          driverId: d.id,
          name: d.user.name,
          availability: d.availability,
          totalMinutes: 0,
          daysWorked: new Set<string>(),
          lastShiftEndedAt: null,
        });
      }
    }

    return Array.from(byDriver.values())
      .map((b) => ({
        driverId: b.driverId,
        name: b.name,
        availability: b.availability,
        totalHours: Math.round((b.totalMinutes / 60) * 10) / 10,
        daysWorked: b.daysWorked.size,
        lastShiftEndedAt: b.lastShiftEndedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }

  /**
   * "Algorithm decisions" report — for every completed/active delivery,
   * surface the dispatcher's choices: which driver, which vehicle,
   * which originating store, current status, and fee charged.
   * Used by admin to audit how the assignment algorithm performed.
   */
  async dispatchDecisions(since: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: since },
        tripId: { not: null },
      },
      include: {
        distributor: true,
        client: true,
        destZone: true,
        originStore: { include: { zone: true } },
        trip: { include: { driver: { include: { user: true } }, vehicle: true } },
        lines: { include: { cylinderType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return orders.map((o) => ({
      orderId: o.id,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      distributor: o.distributor.businessName,
      client: o.client.name,
      origin: o.originStore?.name ?? null,
      originZone: o.originStore?.zone?.name ?? null,
      destination: o.deliveryAddressLabel,
      destinationZone: o.destZone.name,
      driver: o.trip?.driver?.user?.name ?? null,
      vehicle: o.trip?.vehicle?.plateNo ?? null,
      tripStatus: o.trip?.status ?? null,
      tripStartedAt: o.trip?.startedAt?.toISOString() ?? null,
      tripCompletedAt: o.trip?.completedAt?.toISOString() ?? null,
      cylinders: o.lines.map((l) => `${l.fullCount}× ${l.cylinderType.code}`).join(' + '),
      feePaisa: o.deliveryFeePaisa.toString(),
      cancellationReason: o.cancellationReason,
    }));
  }

  /**
   * Delivery success / failure / cancel funnel.
   */
  async deliveryFunnel(since: Date) {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const total = rows.reduce((s, r) => s + r._count._all, 0) || 1;
    return {
      since: since.toISOString(),
      total,
      byStatus: rows
        .map((r) => ({
          status: r.status,
          count: r._count._all,
          percent: Math.round((r._count._all / total) * 1000) / 10,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
