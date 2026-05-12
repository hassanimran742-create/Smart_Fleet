import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ZonesService } from '../zones/zones.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private zones: ZonesService,
    @InjectQueue('dispatch') private dispatchQueue: Queue,
  ) {}

  async create(input: {
    distributorId: string;
    clientId: string;
    deliveryLocation: { lat: number; lng: number };
    deliveryLabel: string;
    lines: { cylinderTypeId: string; fullCount: number; expectedReturnCount: number }[];
    scheduledWindowStart?: string;
    scheduledWindowEnd?: string;
  }) {
    const zone = await this.zones.findContainingPoint(
      input.deliveryLocation.lat,
      input.deliveryLocation.lng,
    );
    if (!zone) throw new BadRequestException('Delivery location is not inside any active zone');

    const result = await this.prisma.$transaction(async (tx) => {
      const rows: { id: string }[] = await tx.$queryRaw`
        INSERT INTO orders (
          id, distributor_id, client_id, delivery_address_label, dest_zone_id,
          status, payment_status, delivery_fee_paisa, delivery_address,
          scheduled_window_start, scheduled_window_end, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(),
          ${input.distributorId}::uuid,
          ${input.clientId}::uuid,
          ${input.deliveryLabel},
          ${zone.id}::uuid,
          'PENDING',
          'UNPAID',
          0,
          ST_SetSRID(ST_MakePoint(${input.deliveryLocation.lng}, ${input.deliveryLocation.lat}), 4326),
          ${input.scheduledWindowStart ? new Date(input.scheduledWindowStart) : null},
          ${input.scheduledWindowEnd ? new Date(input.scheduledWindowEnd) : null},
          NOW(), NOW()
        )
        RETURNING id
      `;
      const orderId = rows[0].id;

      for (const line of input.lines) {
        await tx.orderLine.create({
          data: {
            orderId,
            cylinderTypeId: line.cylinderTypeId,
            fullCount: line.fullCount,
            expectedReturnCount: line.expectedReturnCount,
          },
        });
      }
      return { id: orderId };
    });

    await this.dispatchQueue.add('dispatch-order', { orderId: result.id });
    return this.byId(result.id);
  }

  async byId(id: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true, trip: true, client: true },
    });
    if (!o) throw new NotFoundException();
    return o;
  }

  listForDistributor(distributorId: string) {
    return this.prisma.order.findMany({
      where: { distributorId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  updateStatus(id: string, status: OrderStatus, reason?: string) {
    return this.prisma.order.update({
      where: { id },
      data: { status, cancellationReason: status === OrderStatus.CANCELLED ? reason : undefined },
    });
  }
}
