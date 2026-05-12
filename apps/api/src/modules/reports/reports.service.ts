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
}
