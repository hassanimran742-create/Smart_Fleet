import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClientPortalService {
  constructor(private prisma: PrismaService) {}

  // All orders for this client (matched by phone across distributors).
  async myOrders(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user) throw new AppError('NOT_FOUND');
    const clientIds = (await this.prisma.client.findMany({
      where: { phone: user.phone },
      select: { id: true },
    })).map((c) => c.id);
    if (clientIds.length === 0) return [];

    return this.prisma.order.findMany({
      where: { clientId: { in: clientIds } },
      include: {
        lines: { include: { cylinderType: true } },
        distributor: { select: { businessName: true } },
        trip: {
          include: {
            driver: { include: { user: { select: { name: true, phone: true } } } },
            vehicle: { select: { plateNo: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // Active deliveries: not yet confirmed by the client.
  async activeDeliveries(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user) throw new AppError('NOT_FOUND');
    const clientIds = (await this.prisma.client.findMany({
      where: { phone: user.phone },
      select: { id: true },
    })).map((c) => c.id);
    if (clientIds.length === 0) return [];

    return this.prisma.order.findMany({
      where: {
        clientId: { in: clientIds },
        status: { in: ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'] },
        clientConfirmedAt: null,
      },
      include: {
        lines: { include: { cylinderType: true } },
        distributor: { select: { businessName: true } },
        trip: {
          include: {
            driver: { include: { user: { select: { name: true, phone: true } } } },
            vehicle: { select: { plateNo: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async orderDetail(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        lines: { include: { cylinderType: true } },
        distributor: { select: { businessName: true } },
        trip: {
          include: {
            driver: { include: { user: { select: { name: true, phone: true } } } },
            vehicle: { select: { plateNo: true } },
          },
        },
      },
    });
    if (!order) throw new AppError('NOT_FOUND');
    await this.assertOwner(order.client.phone, userId);
    return order;
  }

  async confirmDelivery(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { client: true },
    });
    if (!order) throw new AppError('NOT_FOUND');
    await this.assertOwner(order.client.phone, userId);
    if (order.clientConfirmedAt) return alreadyApplied(order);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { clientConfirmedAt: new Date() },
    });
  }

  async confirmEmptiesHandover(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { client: true },
    });
    if (!order) throw new AppError('NOT_FOUND');
    await this.assertOwner(order.client.phone, userId);
    if (order.emptiesHandedOverAt) return alreadyApplied(order);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { emptiesHandedOverAt: new Date() },
    });
  }

  private async assertOwner(clientPhone: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    // Someone else's order doesn't exist for this caller (API_CONTRACT §3.2).
    if (user?.phone !== clientPhone) throw new AppError('NOT_FOUND');
  }
}
