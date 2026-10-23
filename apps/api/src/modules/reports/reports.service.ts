import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Only the name of a related user is ever loaded for a report (API_CONTRACT §3.5: explicit selects). */
const USER_NAME = { select: { name: true } } as const;

/**
 * Office reports (API_CONTRACT §7.13): kept, office only, hidden on the website. Money comes from the
 * ledger, never from order columns: revenue is the delivery costs taken net of costs returned.
 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Orders by destination zone since `since`, with their revenue: Σ DEBIT_ORDER − Σ CREDIT_ORDER_REVERSAL
   * of those orders' ledger rows (a cancel before delivery started brings the cost back to 0).
   */
  async ordersByZone(cityId: string, since: Date) {
    // Dates bind as timestamptz; the columns are timestamp(3) in UTC, so `since` is compared in UTC.
    return this.prisma.$queryRaw`
      SELECT z.id AS zone_id, z.name,
             COUNT(o.id)::int AS order_count,
             COALESCE(SUM(money.net), 0)::bigint AS revenue_paisa
      FROM zones z
      LEFT JOIN orders o ON o.dest_zone_id = z.id AND o.created_at >= (${since}::timestamptz AT TIME ZONE 'UTC')
      LEFT JOIN (
        SELECT l.order_id, -SUM(l.amount_paisa) AS net
        FROM ledger_entries l
        WHERE l.entry_type IN ('DEBIT_ORDER', 'CREDIT_ORDER_REVERSAL') AND l.order_id IS NOT NULL
        GROUP BY l.order_id
      ) money ON money.order_id = o.id
      WHERE z.city_id = ${cityId}::uuid
      GROUP BY z.id, z.name
      ORDER BY order_count DESC, z.name
    `;
  }

  async driverUtilization(since: Date) {
    return this.prisma.$queryRaw`
      SELECT d.id AS driver_id, u.name,
             COUNT(DISTINCT t.id)::int AS trips_count,
             COUNT(o.id)::int AS orders_delivered
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN trips t ON t.driver_id = d.id AND t.completed_at >= (${since}::timestamptz AT TIME ZONE 'UTC')
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
      include: { driver: { select: { availability: true, user: USER_NAME } } },
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

    const allDrivers = await this.prisma.driver.findMany({
      select: { id: true, availability: true, user: USER_NAME },
    });
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
        distributor: { select: { businessName: true } },
        client: { select: { name: true } },
        destZone: { select: { name: true } },
        originStore: { select: { name: true, zone: { select: { name: true } } } },
        trip: {
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            driver: { select: { user: USER_NAME } },
            vehicle: { select: { plateNo: true } },
          },
        },
        lines: { select: { fullCount: true, cylinderType: { select: { code: true } } } },
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
   * Fuel consumption report: per vehicle, total litres, cost, km
   * derived from the first vs last odometer reading in the window,
   * and the most recent refill driver.
   */
  async fuelConsumption(since: Date) {
    const refills = await this.prisma.fuelRefill.findMany({
      where: { refillAt: { gte: since } },
      include: {
        vehicle: { select: { plateNo: true, capacityUnits: true, currentOdometerKm: true } },
        driver: { select: { user: USER_NAME } },
      },
      orderBy: { refillAt: 'asc' },
    });
    type Bucket = {
      vehicleId: string;
      plateNo: string;
      capacityUnits: number;
      currentOdometerKm: number;
      totalLitres: number;
      totalCostPaisa: bigint;
      firstOdoKm: number;
      lastOdoKm: number;
      refillCount: number;
      lastDriver: string;
      lastRefillAt: string;
      refills: Array<{
        id: string;
        driverName: string;
        litres: number;
        costPaisa: string;
        odometerKm: number;
        fuelStation: string | null;
        refillAt: string;
      }>;
    };
    const byVehicle = new Map<string, Bucket>();
    for (const r of refills) {
      const ex: Bucket = byVehicle.get(r.vehicleId) ?? {
        vehicleId: r.vehicleId,
        plateNo: r.vehicle.plateNo,
        capacityUnits: r.vehicle.capacityUnits,
        currentOdometerKm: r.vehicle.currentOdometerKm,
        totalLitres: 0,
        totalCostPaisa: 0n,
        firstOdoKm: r.odometerKm,
        lastOdoKm: r.odometerKm,
        refillCount: 0,
        lastDriver: r.driver.user.name,
        lastRefillAt: r.refillAt.toISOString(),
        refills: [],
      };
      ex.totalLitres += Number(r.litres);
      ex.totalCostPaisa += r.costPaisa;
      ex.lastOdoKm = r.odometerKm;
      ex.refillCount += 1;
      ex.lastDriver = r.driver.user.name;
      ex.lastRefillAt = r.refillAt.toISOString();
      ex.refills.push({
        id: r.id,
        driverName: r.driver.user.name,
        litres: Number(r.litres),
        costPaisa: r.costPaisa.toString(),
        odometerKm: r.odometerKm,
        fuelStation: r.fuelStation,
        refillAt: r.refillAt.toISOString(),
      });
      byVehicle.set(r.vehicleId, ex);
    }
    return Array.from(byVehicle.values()).map((b) => ({
      vehicleId: b.vehicleId,
      plateNo: b.plateNo,
      currentOdometerKm: b.currentOdometerKm,
      kmInWindow: Math.max(0, b.lastOdoKm - b.firstOdoKm),
      totalLitres: Math.round(b.totalLitres * 100) / 100,
      totalCostPaisa: b.totalCostPaisa.toString(),
      kmPerLitre: b.totalLitres > 0 ? Math.round(((b.lastOdoKm - b.firstOdoKm) / b.totalLitres) * 100) / 100 : null,
      refillCount: b.refillCount,
      lastDriver: b.lastDriver,
      lastRefillAt: b.lastRefillAt,
      refills: b.refills,
    }));
  }

  /**
   * Driver performance: km driven (sum of refills' km deltas), orders delivered (by when they were
   * delivered, `deliveredAt`), filling orders completed, total hours from shifts.
   */
  async driverPerformance(since: Date) {
    const [refills, deliveredOrders, fillingOrders, shifts] = await Promise.all([
      this.prisma.fuelRefill.findMany({
        where: { refillAt: { gte: since } },
        select: { driverId: true, odometerKm: true, litres: true },
        orderBy: { refillAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { status: 'DELIVERED', deliveredAt: { gte: since } },
        select: { trip: { select: { driverId: true } } },
      }),
      this.prisma.fillingOrder.findMany({
        where: { status: 'COMPLETED', completedAt: { gte: since } },
        select: { assignedDriverId: true },
      }),
      this.prisma.driverShift.findMany({
        where: { startedAt: { gte: since } },
        select: { driverId: true, startedAt: true, endedAt: true },
      }),
    ]);

    const drivers = await this.prisma.driver.findMany({
      select: {
        id: true,
        availability: true,
        user: { select: { name: true, phone: true } },
        currentVehicle: { select: { plateNo: true, currentOdometerKm: true } },
      },
    });

    return drivers.map((d) => {
      const myRefills = refills.filter((r) => r.driverId === d.id);
      const firstOdo = myRefills[0]?.odometerKm ?? d.currentVehicle?.currentOdometerKm ?? 0;
      const lastOdo = myRefills[myRefills.length - 1]?.odometerKm ?? firstOdo;
      const myDeliveries = deliveredOrders.filter((o) => o.trip?.driverId === d.id);
      const myFilling = fillingOrders.filter((f) => f.assignedDriverId === d.id);
      const mins = shifts
        .filter((s) => s.driverId === d.id)
        .reduce((sum, s) => sum + ((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 60000, 0);

      return {
        driverId: d.id,
        name: d.user.name,
        phone: d.user.phone,
        availability: d.availability,
        plateNo: d.currentVehicle?.plateNo ?? null,
        kmDriven: Math.max(0, lastOdo - firstOdo),
        currentOdometerKm: d.currentVehicle?.currentOdometerKm ?? null,
        deliveredOrders: myDeliveries.length,
        fillingOrdersCompleted: myFilling.length,
        totalHours: Math.round((mins / 60) * 10) / 10,
        refillCount: myRefills.length,
        fuelLitres: Math.round(myRefills.reduce((s, r) => s + Number(r.litres), 0) * 100) / 100,
      };
    });
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
