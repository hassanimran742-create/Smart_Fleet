import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ZonesService } from '../zones/zones.service';
import { PricingService } from '../pricing/pricing.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrderPaymentStatus, OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private zones: ZonesService,
    private pricing: PricingService,
    private ledger: LedgerService,
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
      include: {
        lines: { include: { cylinderType: true } },
        trip: { include: { driver: { include: { user: true } }, vehicle: true } },
        client: true,
        destZone: true,
        originStore: true,
      },
    });
    if (!o) throw new NotFoundException();
    return o;
  }

  async tracking(id: string) {
    // Lightweight tracking payload for distributor "track order" screen.
    const order = await this.byId(id);
    let driverLocation: { lat: number; lng: number } | null = null;
    if (order.trip?.driverId) {
      const rows: { lat: number; lng: number }[] = await this.prisma.$queryRaw`
        SELECT ST_Y(current_location) AS lat, ST_X(current_location) AS lng
        FROM drivers WHERE id = ${order.trip.driverId}::uuid AND current_location IS NOT NULL
      `;
      if (rows[0]) driverLocation = { lat: rows[0].lat, lng: rows[0].lng };
    }
    const deliveryRows: { lat: number; lng: number }[] = await this.prisma.$queryRaw`
      SELECT ST_Y(delivery_address) AS lat, ST_X(delivery_address) AS lng
      FROM orders WHERE id = ${id}::uuid
    `;
    return {
      orderId: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      deliveryFeePaisa: order.deliveryFeePaisa.toString(),
      destination: deliveryRows[0] ?? null,
      driverLocation,
      driver: order.trip?.driver
        ? {
            id: order.trip.driver.id,
            name: order.trip.driver.user.name,
            phone: order.trip.driver.user.phone,
            vehiclePlate: order.trip.vehicle?.plateNo,
          }
        : null,
      tripId: order.tripId,
    };
  }

  listForDistributor(distributorId: string) {
    return this.prisma.order.findMany({
      where: { distributorId },
      include: {
        lines: { include: { cylinderType: true } },
        client: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  listAll(filter: { status?: OrderStatus } = {}) {
    return this.prisma.order.findMany({
      where: { status: filter.status },
      include: { lines: true, client: true, distributor: true, trip: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async updateStatus(id: string, status: OrderStatus, reason?: string) {
    // When moving to DELIVERED, compute the delivery fee from pricing and debit the distributor's ledger.
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { lines: true, originStore: true, destZone: true },
    });
    if (!order) throw new NotFoundException();

    if (status === OrderStatus.DELIVERED && order.paymentStatus === OrderPaymentStatus.UNPAID) {
      if (!order.originStore) {
        throw new BadRequestException(
          'Cannot mark delivered: order has no originStore assigned (dispatch missing).',
        );
      }
      const store = await this.prisma.store.findUnique({
        where: { id: order.originStore.id },
      });
      if (!store) throw new NotFoundException('originStore missing');

      const feePaisa = await this.pricing.computeFeePaisa({
        cityId: await this.cityIdForZone(order.destZoneId),
        originZoneId: store.zoneId,
        destZoneId: order.destZoneId,
        lines: order.lines.map((l) => ({
          cylinderTypeId: l.cylinderTypeId,
          fullCount: l.fullCount,
        })),
      });

      await this.ledger.debitForOrder(order.distributorId, order.id, feePaisa);

      return this.prisma.order.update({
        where: { id },
        data: {
          status,
          deliveryFeePaisa: feePaisa,
          paymentStatus: OrderPaymentStatus.PAID_VIA_LEDGER,
        },
      });
    }

    return this.prisma.order.update({
      where: { id },
      data: { status, cancellationReason: status === OrderStatus.CANCELLED ? reason : undefined },
    });
  }

  private async cityIdForZone(zoneId: string): Promise<string> {
    const z = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!z) throw new NotFoundException('Zone not found');
    return z.cityId;
  }
}
