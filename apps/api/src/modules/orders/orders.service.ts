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

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          distributorId: input.distributorId,
          clientId: input.clientId,
          deliveryAddressLabel: input.deliveryLabel,
          destZoneId: zone.id,
          status: OrderStatus.PENDING,
          deliveryAddress: undefined as any, // set via raw below
          scheduledWindowStart: input.scheduledWindowStart ? new Date(input.scheduledWindowStart) : null,
          scheduledWindowEnd: input.scheduledWindowEnd ? new Date(input.scheduledWindowEnd) : null,
          lines: { create: input.lines },
        },
      });
      await tx.$executeRaw`
        UPDATE orders
        SET delivery_address = ST_SetSRID(ST_MakePoint(${input.deliveryLocation.lng}, ${input.deliveryLocation.lat}), 4326)
        WHERE id = ${created.id}::uuid
      `;
      return created;
    });

    await this.dispatchQueue.add('dispatch-order', { orderId: order.id });
    return order;
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
